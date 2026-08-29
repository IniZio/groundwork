import path from 'node:path'
import type { HookFn, HookResult } from './types.js'

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

function isSubagentCall(input: Record<string, unknown>): boolean {
  if (typeof input.agent_type === 'string' && input.agent_type.trim()) return true
  if (input.agent_id) return true
  const tp = input.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

/**
 * Matches any ledger path or seal key path in a command string.
 * Covers:
 *   .groundwork/run.json          (legacy)
 *   .groundwork/runs/<id>.json    (per-session ledger)
 *   .groundwork/runs/<id>.seal.key
 */
const LEDGER_OR_KEY_RE = /\.groundwork\/(?:run\.json|runs\/[^/\s]+\.(?:json|seal\.key))/

/**
 * Matches only seal key paths (for exfiltration detection).
 */
const SEAL_KEY_RE = /\.groundwork\/runs\/[^/\s]+\.seal\.key/

/**
 * Mutating ledger CLI invocations — matches the bin wrapper and direct node invocation.
 * Subcommands: init | set | complete | gate | abandon | autopilot | rm | scope-token
 */
const MUTATING_LEDGER_CMD_RE = /\bledger(?:\.mjs)?\s+(?:init|set|complete|gate|abandon|autopilot|rm|scope-token)\b/

/** Read-only ledger CLI subcommands — these are explicitly allowed. */
const READONLY_LEDGER_CMD_RE = /\bledger(?:\.mjs)?\s+(?:status|view|show|help)\b/

/**
 * Narrow allow: returns true iff the command is ONLY a `ledger complete`
 * invocation carrying a scoped token (`sct_` + lowercase hex), with no shell
 * chaining operators.
 */
function isScopedCompleteOnly(cmd: string): boolean {
  // Reject any shell chaining or redirection that could hide a second command or
  // redirect output/input unexpectedly.
  if (/[;|&\n`<>]|\$\(/.test(cmd)) return false
  // Require specifically the `complete` subcommand (not init/gate/etc.).
  if (!/\bledger(?:\.mjs)?\s+complete\b/.test(cmd)) return false
  // Require a scoped token with the distinguishable `sct_` prefix + hex chars.
  if (!/--token\s+sct_[0-9a-f]+\b/.test(cmd)) return false
  return true
}

/**
 * Mutation verb patterns — only checked when the command also references a ledger/key path.
 * Each entry is [pattern, label] for the deny reason.
 */
const MUTATION_PATTERNS: Array<[RegExp, string]> = [
  // Shell redirection into a path: "> path" or ">> path"
  [/>{1,2}\s*\S*\.groundwork\/(?:run\.json|runs\/)/, 'shell redirection (>/>>)'],
  // tee to ledger/key
  [/\btee\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'tee'],
  // sed -i
  [/\bsed\s+-i\b/, 'sed -i'],
  // mv into .groundwork/runs/
  [/\bmv\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'mv'],
  // cp into .groundwork/runs/
  [/\bcp\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'cp'],
  // rm of ledger or key
  [/\brm\b[^|]*\.groundwork\/(?:run\.json|runs\/[^/\s]+\.(?:json|seal\.key))/, 'rm'],
  // chmod on ledger/key
  [/\bchmod\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'chmod'],
  // jq with redirection into ledger/key
  [/\bjq\b[^|]*>{1,2}[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'jq redirect'],
]

/** Exfiltration patterns — only checked against seal key paths. */
const EXFIL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:cat|less|head|tail|xxd|od)\b[^|]*\.groundwork\/runs\/[^/\s]+\.seal\.key/, 'key read (cat/less/head/tail/xxd/od)'],
  [/\.groundwork\/runs\/[^/\s]+\.seal\.key[^|]*\b(?:cat|less|head|tail|xxd|od)\b/, 'key read (piped)'],
]

export const run: HookFn = async (input, env): Promise<HookResult> => {
  try {
    if (isEmbeddedAgent(env)) return passthrough()

    const inp = (input ?? {}) as Record<string, unknown>

    const rawTool = typeof inp.tool_name === 'string' ? inp.tool_name : ''
    if (rawTool.toLowerCase() !== 'bash') return passthrough()

    // Only enforce for subagent calls — orchestrator retains full ledger-CLI + key access.
    if (!isSubagentCall(inp)) return passthrough()

    const toolInput = (inp.tool_input ?? {}) as Record<string, unknown>
    const cmd = typeof toolInput.command === 'string' ? toolInput.command : ''
    if (!cmd) return passthrough()

    // --- Check 1: filesystem mutation patterns on ledger/key paths ---
    // IMPORTANT: these run BEFORE the narrow-allow block so that a scoped-token
    // `ledger complete` command carrying a shell redirection operator can never
    // short-circuit past them.
    if (LEDGER_OR_KEY_RE.test(cmd)) {
      for (const [pattern, label] of MUTATION_PATTERNS) {
        if (pattern.test(cmd)) {
          return deny(
            `groundwork: subagent Bash blocked — filesystem mutation of run ledger or seal key detected (pattern: ${label}). The ledger is managed exclusively via the 'ledger' CLI; the seal key is managed by the gate system.`,
          )
        }
      }
    }

    // --- Check 2: seal key exfiltration ---
    if (SEAL_KEY_RE.test(cmd)) {
      for (const [pattern, label] of EXFIL_PATTERNS) {
        if (pattern.test(cmd)) {
          return deny(
            `groundwork: subagent Bash blocked — seal key exfiltration detected (pattern: ${label}). The seal key is read exclusively by the gate system; subagents must not access it.`,
          )
        }
      }
    }

    // --- Check 3: mutating ledger CLI subcommand ---
    // Allow read-only subcommands first (status/view/show/help).
    if (READONLY_LEDGER_CMD_RE.test(cmd)) return passthrough()
    if (MUTATING_LEDGER_CMD_RE.test(cmd)) {
      // Narrow allow: `ledger complete` with a scoped token (sct_ prefix) and no
      // shell operators. All other mutating subcommands remain denied regardless
      // of token shape.
      if (isScopedCompleteOnly(cmd)) return passthrough()
      return deny(
        `groundwork: subagent Bash blocked — mutating the run ledger via the 'ledger' CLI is restricted to the orchestrator (init|set|complete|gate|abandon|autopilot|rm|scope-token require the write token). Detected in command: ${cmd.slice(0, 120)}`,
      )
    }

    return passthrough()
  } catch {
    return passthrough()
  }
}
