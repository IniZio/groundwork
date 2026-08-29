import path from 'node:path'
import type { HookFn, HookResult } from './types.js'

/** Absolute path to the ledger bin wrapper — used in deny message text. */
const LEDGER_BIN = path.resolve(import.meta.dirname, '../../../bin/ledger')

function passthrough(): HookResult {
  return { stdout: '', stderr: '', exit: 0 }
}

function deny(reason: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

function isEmbeddedAgent(env: Record<string, string | undefined>): boolean {
  const ep = env.CLAUDE_CODE_ENTRYPOINT ?? ''
  return ep === 'sdk-py' || ep === 'sdk-js'
}

/**
 * Is this file path a run ledger?
 * Matches:
 *   …/.groundwork/run.json          (legacy single-session path)
 *   …/.groundwork/runs/<id>.json    (per-session path)
 */
function isLedgerPath(fp: unknown): boolean {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  // Legacy: …/.groundwork/run.json
  if (path.basename(norm) === 'run.json' && path.basename(path.dirname(norm)) === '.groundwork') return true
  // Per-session: …/.groundwork/runs/<anything>.json
  if (norm.endsWith('.json') && path.basename(path.dirname(norm)) === 'runs') {
    const grandparent = path.basename(path.dirname(path.dirname(norm)))
    if (grandparent === '.groundwork') return true
  }
  return false
}

/**
 * Is this file path a seal key?
 * Matches: …/.groundwork/runs/<id>.seal.key
 */
function isKeyPath(fp: unknown): boolean {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  if (!norm.endsWith('.seal.key')) return false
  if (path.basename(path.dirname(norm)) !== 'runs') return false
  const grandparent = path.basename(path.dirname(path.dirname(norm)))
  return grandparent === '.groundwork'
}

function isSubagentCall(input: Record<string, unknown>): boolean {
  if (typeof input.agent_type === 'string' && input.agent_type.trim()) return true
  if (input.agent_id) return true
  const tp = input.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

export const run: HookFn = async (input, env): Promise<HookResult> => {
  try {
    // Embedded SDK agents have no groundwork ledger — no enforcement needed.
    if (isEmbeddedAgent(env)) return passthrough()

    const inp = (input ?? {}) as Record<string, unknown>

    const rawTool = typeof inp.tool_name === 'string' ? inp.tool_name : ''
    // Normalize: lowercase + strip leading "fast_" to catch fast_read, fast_edit, fast_multiedit
    const toolNorm = rawTool.toLowerCase().replace(/^fast_/, '')
    const tool = rawTool // keep original for message rendering
    const toolInput = (inp.tool_input ?? {}) as Record<string, unknown>
    const fp = toolInput.file_path

    // --- Seal key: deny Read/Write/Edit/MultiEdit for ALL callers ---
    if (isKeyPath(fp)) {
      if (toolNorm === 'read' || toolNorm === 'write' || toolNorm === 'edit' || toolNorm === 'multiedit') {
        return deny(
          `groundwork: do not ${tool} the seal key directly — the key is read/written only by the gate system via node fs (stop-gate, gate-seal). Direct tool access is denied to protect ledger integrity.`,
        )
      }
    }

    // --- Ledger: deny Read/Edit/MultiEdit for ALL callers; Write only for subagents ---
    if (!isLedgerPath(fp)) return passthrough()
    if (toolNorm === 'write') {
      // Allow the orchestrator's one-shot init Write; block subagent Write.
      if (!isSubagentCall(inp)) return passthrough()
      return deny(
        `groundwork: subagent Write to the run ledger is blocked — use the ledger CLI to mutate state:\n` +
          `  ${LEDGER_BIN} init <file|->           — initialize the ledger from a JSON slice table\n` +
          `  ${LEDGER_BIN} add <id> [--wave N] …   — add a new slice\n` +
          `  ${LEDGER_BIN} set <id> [--status …]   — update a slice field\n` +
          `  ${LEDGER_BIN} complete <id> [<id> …]  — mark slices complete\n` +
          `  ${LEDGER_BIN} gate advisor APPROVE …  — record the advisor verdict\n` +
          `  ${LEDGER_BIN} abandon                 — cancel the run`,
      )
    }
    if (toolNorm !== 'read' && toolNorm !== 'edit' && toolNorm !== 'multiedit') return passthrough()

    return deny(
      `groundwork: do not ${tool} the run ledger directly — it forces the whole ledger into the orchestrator's context and races the stop-gate hook's writes. Use the ledger CLI instead (locked, atomic, one-line output):\n` +
        `  ${LEDGER_BIN} status                 — compact progress view (use this instead of reading the file)\n` +
        `  ${LEDGER_BIN} show <id>              — all fields of one slice\n` +
        `  ${LEDGER_BIN} add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"] [--status …]\n` +
        `  ${LEDGER_BIN} set <id> [--status … | --wave N | --desc … | --blocked-by … | --acceptance …]\n` +
        `  ${LEDGER_BIN} rm <id> [<id> …]       — remove slice(s)\n` +
        `  ${LEDGER_BIN} complete <id> [<id> …] — mark slices complete\n` +
        `  ${LEDGER_BIN} gate advisor APPROVE [--citation … --rubric … --axes-correctness N …]\n` +
        `  ${LEDGER_BIN} abandon                — cancel the run (active:false)\n` +
        `  ${LEDGER_BIN} help [<cmd>]           — full usage`,
    )
  } catch {
    return passthrough()
  }
}
