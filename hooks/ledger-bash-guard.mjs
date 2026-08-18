#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — ledger Bash mutation guard (best-effort secondary layer).
 *
 * Blocks subagent Bash commands that target the run ledger or seal key with mutation
 * or exfiltration patterns. The orchestrator's Bash access is never restricted.
 *
 * Attack vectors blocked (S4-AC3):
 *  - Shell redirection into ledger/key path (>, >>)
 *  - tee to ledger/key path
 *  - sed -i on ledger/key
 *  - mv / cp into .groundwork/runs/
 *  - rm / chmod of ledger or key
 *  - jq redirect into ledger/key
 *  - cat / less / head / tail / xxd / od of *.seal.key (key exfiltration)
 *  - ledger CLI with mutating subcommand (init|set|complete|gate|abandon|autopilot)
 *    — also matches node .../ledger.mjs to block wrapper bypass
 *
 * Allowed:
 *  - All orchestrator Bash (no agent markers present)
 *  - Subagent Bash that doesn't target ledger/key paths with mutation verbs
 *  - Read-only ledger CLI subcommands: status | view | show | help
 *
 * FAIL-OPEN: any error or parse failure → passthrough.
 * This layer is BEST-EFFORT — obfuscation can defeat pattern matching.
 * The primary guarantee is S3's fail-closed seal-verify.
 */

import path from 'node:path'
import { readStdin, passthrough, isEmbeddedAgent } from './lib/hook-io.mjs'

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/**
 * Is the caller a delegated subagent (as opposed to the orchestrator)?
 * Self-contained copy of the detection in orchestrator-impl-guard.mjs.
 */
function isSubagentCall(input) {
  const agentType = input?.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input?.agent_id) return true
  const tp = input?.transcript_path
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
 * Pattern allows: `bin/ledger complete`, `node hooks/ledger.mjs complete`, etc.
 *
 * scope-token is explicitly included: issuance must remain orchestrator-only.
 * A subagent that could mint its own scoped token would defeat the auth design.
 */
const MUTATING_LEDGER_CMD_RE = /\bledger(?:\.mjs)?\s+(?:init|set|complete|gate|abandon|autopilot|rm|scope-token)\b/

/** Read-only ledger CLI subcommands — these are explicitly allowed. */
const READONLY_LEDGER_CMD_RE = /\bledger(?:\.mjs)?\s+(?:status|view|show|help)\b/

/**
 * Narrow allow: returns true iff the command is ONLY a `ledger complete`
 * invocation carrying a scoped token (`sct_` + lowercase hex), with no shell
 * chaining operators.
 *
 * Fail-closed design:
 *  - Shell-operator check (`; | & \n \` $(`) rejects all chained commands
 *    before any subcommand inspection.
 *  - The subcommand check requires `complete` specifically — any other mutating
 *    subcommand (including new ones added to MUTATING_LEDGER_CMD_RE later)
 *    won't match and falls through to deny.
 *  - The token-format check requires the `sct_` prefix that only `ledger
 *    scope-token` emits; plain write tokens (bare hex) do not match.
 *
 * This guard is defense-in-depth only. Real authorization lives in
 * assertScopedOrWriteToken in hooks/ledger.mjs, which rejects fabricated
 * tokens, unowned slices, and missing created_by. A subagent faking an
 * sct_-shaped token passes the guard and is then correctly rejected by the CLI.
 */
function isScopedCompleteOnly(cmd) {
  // Reject any shell chaining or redirection that could hide a second command or
  // redirect output/input unexpectedly. < is included to block stdin-hijack even
  // though MUTATION_PATTERNS only guards against paths in the ledger/key tree.
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
const MUTATION_PATTERNS = [
  // Shell redirection into a path: "> path" or ">> path"
  [/>{1,2}\s*\S*\.groundwork\/(?:run\.json|runs\/)/, 'shell redirection (>/>>)'],
  // tee to ledger/key
  [/\btee\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'tee'],
  // sed -i
  [/\bsed\s+-i\b/, 'sed -i'],
  // mv into .groundwork/runs/
  [/\bmv\b[^|]*\.groundwork\/runs\//, 'mv'],
  // cp into .groundwork/runs/
  [/\bcp\b[^|]*\.groundwork\/runs\//, 'cp'],
  // rm of ledger or key
  [/\brm\b[^|]*\.groundwork\/(?:run\.json|runs\/[^/\s]+\.(?:json|seal\.key))/, 'rm'],
  // chmod on ledger/key
  [/\bchmod\b[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'chmod'],
  // jq with redirection into ledger/key
  [/\bjq\b[^|]*>{1,2}[^|]*\.groundwork\/(?:run\.json|runs\/)/, 'jq redirect'],
]

/** Exfiltration patterns — only checked against seal key paths. */
const EXFIL_PATTERNS = [
  [/\b(?:cat|less|head|tail|xxd|od)\b[^|]*\.groundwork\/runs\/[^/\s]+\.seal\.key/, 'key read (cat/less/head/tail/xxd/od)'],
  [/\.groundwork\/runs\/[^/\s]+\.seal\.key[^|]*\b(?:cat|less|head|tail|xxd|od)\b/, 'key read (piped)'],
]

async function main() {
  if (isEmbeddedAgent()) return passthrough()

  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const rawTool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (rawTool.toLowerCase() !== 'bash') return passthrough()

  // Only enforce for subagent calls — orchestrator retains full ledger-CLI + key access.
  if (!isSubagentCall(input)) return passthrough()

  const cmd = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : ''
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
    // shell operators.  All other mutating subcommands remain denied regardless
    // of token shape.
    if (isScopedCompleteOnly(cmd)) return passthrough()
    return deny(
      `groundwork: subagent Bash blocked — mutating the run ledger via the 'ledger' CLI is restricted to the orchestrator (init|set|complete|gate|abandon|autopilot|rm|scope-token require the write token). Detected in command: ${cmd.slice(0, 120)}`,
    )
  }

  return passthrough()
}

main().catch(() => passthrough())
