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
 * Subcommands: init | set | complete | gate | abandon | checkpoint | rm | scope-token |
 *              hold | await-human | milestone-signoff
 *
 * The `['"`)]*` group after the path segment catches quoted-path forms that a
 * shell expands before exec — e.g. `"hooks/ledger.mjs" checkpoint` where a
 * closing quote or paren separates the filename from the subcommand.
 * Forms covered: double-quote ("), single-quote ('), backtick (`), closing paren ()).
 */
const MUTATING_LEDGER_CMD_RE = /\bledger(?:\.mjs)?['"`)]*\s+(?:init|set|complete|gate|abandon|checkpoint|rm|scope-token|hold|await-human|milestone-signoff)\b/


/**
 * Narrow allow: returns true iff the command is ONLY a `ledger complete`
 * invocation carrying a scoped token (`sct_` + lowercase hex), with no shell
 * chaining operators.
 */
function isScopedCompleteOnly(cmd: string): boolean {
  // Reject shell chaining/redirection.
  if (/[;|&\n`<>]|\$\(/.test(cmd)) return false
  // Require specifically the `complete` subcommand (not init/gate/etc.).
  if (!/\bledger(?:\.mjs)?\s+complete\b/.test(cmd)) return false
  // Require a scoped token with the distinguishable `sct_` prefix + hex chars.
  if (!/--token\s+sct_[0-9a-f]+\b/.test(cmd)) return false
  return true
}

/**
 * Narrow allow: returns true iff the command is ONLY a `ledger set <id> --blocked-by <list>`
 * invocation — edge repair only, no terminal-transition flags, no chaining.
 *
 * Permitted:  ledger set <id> --blocked-by <list>
 * Denied:     any flag other than --blocked-by or --motive (positive allowlist)
 *             any short flag (-x) regardless of intent
 *             --blocked-by with no value (bare `--blocked-by` at end, or `--blocked-by=`)
 *             --motive with no value (bare `--motive` at end, or `--motive=`)
 *             any shell chaining or redirection
 *             missing id or missing --blocked-by
 *
 * Defence in depth: --status and --token are also denied explicitly so they are
 * caught even if the allowlist logic is ever relaxed.
 *
 * Combination cell (known-prefix trap): only {--blocked-by, --motive} are allowed; any
 * other flag is DENIED. The checks run in order: chaining first, defence-in-depth
 * exclusions, then positive allowlist.
 *
 * The <id> positional may appear anywhere after `set` — before or after --motive.
 */
function isScopedSetBlockedByOnly(cmd: string): boolean {
  if (/[;|&\n`<>]|\$\(/.test(cmd)) return false
  if (!/\bledger(?:\.mjs)?\s+set\b/.test(cmd)) return false
  if (/--status\b/.test(cmd)) return false
  if (/--token\b/.test(cmd)) return false

  const setMatch = cmd.match(/\bledger(?:\.mjs)?\s+set\s+(.*)$/)
  if (!setMatch) return false
  const tokens = setMatch[1].trim().split(/\s+/).filter(Boolean)

  const VALUE_FLAGS = new Set(['--motive', '--blocked-by'])
  let idFound = false
  let skipNext = false
  for (const tok of tokens) {
    if (skipNext) { skipNext = false; continue }
    if (tok.startsWith('-')) {
      if (!tok.includes('=') && VALUE_FLAGS.has(tok)) skipNext = true
      continue
    }
    idFound = /^[A-Za-z0-9]\S*$/.test(tok)
    break
  }
  if (!idFound) return false

  const flagTokens = tokens.filter(t => t.startsWith('-'))

  if (flagTokens.length === 0) return false

  for (const flag of flagTokens) {
    if (flag === '--blocked-by' || /^--blocked-by=.+$/.test(flag)) continue
    if (flag === '--motive' || /^--motive=.+$/.test(flag)) continue
    return false // any other flag (including short flags) → denied
  }

  const hasBlockedByEqForm = flagTokens.some(t => /^--blocked-by=.+$/.test(t))
  if (!hasBlockedByEqForm) {
    const idx = tokens.indexOf('--blocked-by')
    if (idx < 0 || idx + 1 >= tokens.length) return false
    const next = tokens[idx + 1]
    if (!next || next.startsWith('-')) return false
  }

  const hasMotiveEqForm = flagTokens.some(t => /^--motive=.+$/.test(t))
  const hasBareMotive = flagTokens.includes('--motive')
  if (hasBareMotive && !hasMotiveEqForm) {
    const idx = tokens.indexOf('--motive')
    if (idx < 0 || idx + 1 >= tokens.length) return false
    const next = tokens[idx + 1]
    if (!next || next.startsWith('-')) return false
  }

  return true
}

/**
 * Mutation verb patterns — only checked when the command also references a ledger/key path.
 * Each entry is [pattern, label] for the deny reason.
 */
const MUTATION_PATTERNS: Array<[RegExp, string]> = [
  [/>{1,2}\s*\S*\.groundwork\/(?:run\.json|runs\/)/, 'shell redirection (>/>>)'],
  [/\btee\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'tee'],
  [/\bsed\s+-i\b/, 'sed -i'],
  [/\bmv\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'mv'],
  [/\bcp\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'cp'],
  [/\brm\b[^|]*\.groundwork\/(?:run\.json|runs\/[^/\s]+\.(?:json|seal\.key))/, 'rm'],
  [/\bchmod\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'chmod'],
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

    if (SEAL_KEY_RE.test(cmd)) {
      for (const [pattern, label] of EXFIL_PATTERNS) {
        if (pattern.test(cmd)) {
          return deny(
            `groundwork: subagent Bash blocked — seal key exfiltration detected (pattern: ${label}). The seal key is read exclusively by the gate system; subagents must not access it.`,
          )
        }
      }
    }

    if (MUTATING_LEDGER_CMD_RE.test(cmd)) {
      // Narrow allow: scoped `ledger complete` (sct_ token, no shell operators).
      if (isScopedCompleteOnly(cmd)) return passthrough()
      // Narrow allow: `ledger set <id> --blocked-by` — edge repair only.
      if (isScopedSetBlockedByOnly(cmd)) return passthrough()
      return deny(
        `groundwork: subagent Bash blocked — mutating the run ledger via the 'ledger' CLI is restricted to the orchestrator (init|set|complete|gate|abandon|checkpoint|rm|scope-token|hold|await-human|milestone-signoff require the write token). Detected in command: ${cmd.slice(0, 120)}`,
      )
    }

    return passthrough()
  } catch {
    return passthrough()
  }
}
