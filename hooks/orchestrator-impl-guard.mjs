#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — orchestrator direct-implementation guard.
 *
 * The orchestrator is instructed (CLAUDE.md / SessionStart reminder) to NEVER
 * implement directly — it classifies, delegates to subagents, and reviews. That
 * advisory is routinely dropped under context pressure: a real hanlun session
 * fired 24 Agent dispatches yet still ran 200 Edits + 37 Writes itself, on the
 * expensive opus session model, instead of handing the work to a
 * groundwork:general-purpose subagent (which runs on sonnet per
 * model-registry.json). The result was ~88% of output-token load landing on
 * opus despite the fan-out machinery being available and correctly routed.
 *
 * This hook is the mechanical backstop, mirroring agent-model-guard /
 * ledger-guard. On Edit/Write/MultiEdit it DENIES the call **only when both**:
 *   1. the caller is the orchestrator (not a delegated subagent), AND
 *   2. an active run ledger exists (`.groundwork/run.json`, active:true) —
 *      i.e. the orchestrator has committed to a sliced run.
 * Everything else passes through, so trivial work (no ledger) and every
 * subagent edit are untouched.
 *
 * Subagent detection (verified empirically against Claude Code 2.1.191 and the
 * FleetView remote harness):
 *   - Local Claude Code tags a subagent's tool call in the PreToolUse stdin with
 *     `agent_type` (e.g. "general-purpose") and `agent_id`; an orchestrator call
 *     omits both. This is the primary, in-band signal.
 *   - The FleetView remote harness instead runs each subagent as its own
 *     `agent-<id>.jsonl` session, so `transcript_path`'s basename starts with
 *     "agent-". Used as a secondary OR-signal so the guard is correct on both.
 *   `session_id` / `cwd` are SHARED between parent and subagent, so they cannot
 *   discriminate and are not used.
 *
 * Design guarantees (identical contract to the sibling guards):
 *  - FAIL-OPEN. Any error, malformed stdin, or unreadable ledger → emit nothing,
 *    exit 0, let the call proceed. A guard must never wedge real work.
 *  - SCOPED. Acts only on Edit/Write/MultiEdit; the one file it never touches is
 *    the ledger itself (`.groundwork/run.json`) — ledger-guard owns that, and
 *    the one-shot init Write must stay allowed.
 *  - SESSION-SAFE. A ledger owned by a different session never blocks this one
 *    (same rule the stop-gate uses).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readStdin, passthrough } from './lib/hook-io.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

/** Deny the call with a reason that points at delegation / the escape valve. */
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/** Is the caller a delegated subagent (which is SUPPOSED to implement)? */
function isSubagentCall(input) {
  const agentType = input?.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input?.agent_id) return true
  const tp = input?.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

/** Is this file path the run ledger (`…/.groundwork/run.json`)? */
function isLedgerPath(fp) {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  return path.basename(norm) === 'run.json' && path.basename(path.dirname(norm)) === '.groundwork'
}

/**
 * Return the active ledger for this session, or null when there is nothing to
 * enforce (no ledger, inactive, unreadable, or owned by a different session).
 */
function activeLedgerForSession(input) {
  const projectDir = (typeof input?.cwd === 'string' && input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const ledgerPath = path.join(projectDir, '.groundwork', 'run.json')
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    return null
  }
  if (!ledger || ledger.active !== true) return null
  const sessionId = typeof input?.session_id === 'string' ? input.session_id : ''
  if (typeof ledger.session_id === 'string' && ledger.session_id && sessionId && ledger.session_id !== sessionId) {
    return null
  }
  return ledger
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const tool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (!GUARDED.has(tool)) return passthrough()

  // Subagents are the intended implementers — never block them.
  if (isSubagentCall(input)) return passthrough()

  // The ledger file itself is governed by ledger-guard; its init Write stays free.
  if (isLedgerPath(input?.tool_input?.file_path)) return passthrough()

  // Only bite once the orchestrator has committed to an active, owned run.
  if (!activeLedgerForSession(input)) return passthrough()

  return deny(
    `groundwork: the orchestrator must not ${tool} files directly during an active run — that is exactly the "NEVER implement directly" rule, and it puts heavy work on the expensive opus session model instead of a sonnet subagent.\n` +
      `Delegate this edit to a subagent that owns the slice:\n` +
      `  • dispatch a groundwork:general-purpose agent (Task/Agent tool, subagent_type "groundwork:general-purpose") with the exact file + change; it runs on sonnet per model-registry.json.\n` +
      `  • track it in the ledger: $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs status\n` +
      `If this work genuinely is not part of the run, abandon it first: $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs abandon (sets active:false — the guard then releases).`,
  )
}

main().catch(() => passthrough())
