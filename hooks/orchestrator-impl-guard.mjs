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
 * ledger-guard. On Edit/Write/MultiEdit (and their OpenCode fast_ variants) it
 * DENIES the call when:
 *   1. the caller is the orchestrator (not a delegated subagent).
 * Subagent edits always pass through. The ledger-active precondition was
 * removed — orchestrator direct edits are wrong regardless of ledger state,
 * and the prior "trivial work (no ledger)" escape valve was the loophole.
 *
 * Tool-name normalization: OpenCode v1.17.x registers fast_edit, fast_write,
 * fast_multiedit as DISTINCT tool names. To catch these and any future
 * fast_* / renamed variants without another patch, we normalize the incoming
 * tool name before matching:
 *   1. lowercase the name
 *   2. strip a leading "fast_" prefix
 *   3. match against the canonical set {edit, write, multiedit, notebookedit}
 * This means fast_edit → edit (guarded), fast_write → write (guarded), etc.
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
 *  - SCOPED. Acts only on edit/write/multiedit/notebookedit (canonical form after
 *    normalization); the one file it never touches is the ledger itself
 *    (`.groundwork/run.json`) — ledger-guard owns that, and the one-shot init
 *    Write must stay allowed.
 *  - SESSION-SAFE. A ledger owned by a different session never blocks this one
 *    (same rule the stop-gate uses).
 */

import path from 'node:path'
import { readStdin, passthrough } from './lib/hook-io.mjs'

/**
 * Canonical guarded tool names (lowercase, no fast_ prefix).
 * Normalization: lowercase → strip leading "fast_" → match here.
 * This catches Edit, Write, MultiEdit, NotebookEdit, fast_edit, fast_write,
 * fast_multiedit, fast_notebookedit, and any future fast_* variants.
 */
const GUARDED_CANONICAL = new Set(['edit', 'write', 'multiedit', 'notebookedit'])

/** Normalize a raw tool name to its canonical form for guard matching. */
function normalizeToolName(raw) {
  if (typeof raw !== 'string') return ''
  const lower = raw.toLowerCase()
  return lower.startsWith('fast_') ? lower.slice(5) : lower
}

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

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const rawTool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  const tool = normalizeToolName(rawTool)
  if (!GUARDED_CANONICAL.has(tool)) return passthrough()

  // Subagents are the intended implementers — never block them.
  if (isSubagentCall(input)) return passthrough()

  // The ledger file itself is governed by ledger-guard; its init Write stays free.
  if (isLedgerPath(input?.tool_input?.file_path)) return passthrough()

  return deny(
    `groundwork: orchestrator ${rawTool} blocked — delegate this change instead:\n` +
      `  task(subagent_type="groundwork:general-purpose", background=true, model="sonnet", prompt="<file path> + exact change + success criteria")\n` +
      `  Then mark it complete: $CLAUDE_PLUGIN_ROOT/hooks/ledger.mjs complete <id>`,
  )
}

main().catch(() => passthrough())
