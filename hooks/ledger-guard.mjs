#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — ledger access guard (enforcement teeth).
 *
 * The instruction "mutate the ledger only via the `ledger` CLI, never Read/Edit
 * run.json" lives in CLAUDE.md and the skills — but advisory text is routinely
 * dropped under context pressure (the same reason model: was omitted 30× until a
 * hook enforced it). This hook makes the rule mechanical: it DENIES Read / Edit /
 * MultiEdit of `.groundwork/run.json` and points at the CLI. Denying a Read is
 * what actually saves context — the orchestrator never pulls the ~5 KB ledger in.
 *
 * Scope and safety:
 *  - Read/Edit/MultiEdit are intercepted for ALL callers on ledger paths.
 *  - Write is intercepted for SUBAGENT callers only — the orchestrator's one-shot
 *    init Write (vertical-slice creating the ledger) remains unblocked.
 *  - Seal key (*.seal.key under .groundwork/runs/): Read AND Write/Edit/MultiEdit
 *    are denied for ALL callers — nothing reads the key via tool (stop-gate and
 *    gate-seal use node fs directly).
 *  - The stop-gate and other hooks read the ledger via node `readFileSync`, not
 *    the Read tool, so they are unaffected.
 *  - FAIL-OPEN: any error → emit nothing, exit 0 (let the call proceed).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStdin, passthrough, isEmbeddedAgent } from './lib/hook-io.mjs'

/** Absolute path to the ledger bin wrapper — reliable regardless of session cwd. */
const LEDGER_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/ledger')

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/**
 * Is this file path a run ledger?
 * Matches:
 *   …/.groundwork/run.json          (legacy single-session path)
 *   …/.groundwork/runs/<id>.json    (per-session path)
 */
function isLedgerPath(fp) {
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
function isKeyPath(fp) {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  if (!norm.endsWith('.seal.key')) return false
  if (path.basename(path.dirname(norm)) !== 'runs') return false
  const grandparent = path.basename(path.dirname(path.dirname(norm)))
  return grandparent === '.groundwork'
}

/**
 * Is the caller a delegated subagent (as opposed to the orchestrator)?
 * Mirrors the detection in orchestrator-impl-guard.mjs — self-contained copy.
 */
function isSubagentCall(input) {
  const agentType = input?.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input?.agent_id) return true
  const tp = input?.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

async function main() {
  // Embedded SDK agents have no groundwork ledger — no enforcement needed.
  if (isEmbeddedAgent()) return passthrough()

  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const rawTool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  // Normalize: lowercase + strip leading "fast_" to catch fast_read, fast_edit, fast_multiedit
  const toolNorm = rawTool.toLowerCase().replace(/^fast_/, '')
  const tool = rawTool // keep original for message rendering
  const fp = input?.tool_input?.file_path

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
    if (!isSubagentCall(input)) return passthrough()
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
}

main().catch(() => passthrough())
