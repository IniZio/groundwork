#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — agent-nesting guard.
 *
 * PROBLEM: CLAUDE.md's nesting constraint existed only as prose. A
 * general-purpose subagent spawning another general-purpose re-pays the entire
 * fixed session prefix (~8,300 tokens) plus a fresh context for work the first
 * agent should have done itself. The prose rule costs tokens and doesn't bind;
 * this hook binds.
 *
 * POLICY (three rules, evaluated in order):
 *
 *   Rule 1 — junior-orchestrator spawn gate:
 *     Only the primary (top-level) orchestrator may spawn a junior-orchestrator.
 *     Any subagent caller (general-purpose, another junior, explore, …) is denied.
 *
 *   Rule 2 — junior-orchestrator caller cap:
 *     A junior-orchestrator IS the sub-orchestrator. It may delegate only to the
 *     JUNIOR_ALLOWED_SPAWN set: general-purpose, explore, advisor, designer,
 *     test-engineer, qa. Everything else is denied.
 *
 *   Rule 3 — leaf implementer constraint:
 *     Any other subagent (general-purpose, debugger, …) implements its own slice
 *     directly and may only call read-only specialists. DENIED_AT_DEPTH_1 types
 *     (general-purpose, orchestrator, debugger) are blocked when the caller is a
 *     positively-identified subagent.
 *
 * SUBAGENT DETECTION (empirically verified, orchestrator-impl-guard.mjs):
 *   Claude Code tags a subagent's PreToolUse stdin with:
 *     • agent_type  — non-empty string  (primary signal, in-band)
 *     • agent_id    — truthy value      (secondary in-band signal)
 *   The FleetView remote harness runs each subagent as its own session file:
 *     • transcript_path basename starts with "agent-"  (out-of-band signal)
 *   Orchestrator calls omit all three. session_id / cwd are SHARED between
 *   parent and subagent and therefore cannot discriminate; they are not used.
 *
 * FAIL-OPEN GUARANTEE: If none of the three signals are present the hook
 * cannot determine the caller's depth. It ALLOWS the call and emits a warning
 * as a permissionDecisionReason. Wrongly blocking the main orchestrator is
 * far more damaging than occasionally missing a nested call.
 *
 * DENY FORMAT: identical to sibling guards (agent-model-guard,
 * orchestrator-impl-guard) — JSON to stdout, exit 0.
 */

import path from 'node:path'
import { readStdin, passthrough } from './lib/hook-io.mjs'

/** Agents that subagents (depth ≥ 1) are NOT allowed to dispatch. */
const DENIED_AT_DEPTH_1 = new Set(['general-purpose', 'orchestrator', 'debugger'])

/**
 * Types a junior-orchestrator caller IS allowed to spawn (Rule 2).
 * Everything outside this set is denied for junior-orchestrator callers.
 */
const JUNIOR_ALLOWED_SPAWN = new Set(['general-purpose', 'explore', 'advisor', 'designer', 'test-engineer', 'qa'])

/**
 * Normalise a raw subagent_type to a bare name for policy matching.
 * Strips the optional "groundwork:" namespace prefix so that
 * "groundwork:general-purpose" and "general-purpose" are treated identically.
 */
function normaliseName(raw) {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  return s.startsWith('groundwork:') ? s.slice('groundwork:'.length) : s
}

/** Return true when the PreToolUse input originates from a subagent, not the
 *  main orchestrator. Uses the same three-signal heuristic as
 *  orchestrator-impl-guard (see that file's header for full rationale). */
function isSubagentCall(input) {
  const agentType = input?.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input?.agent_id) return true
  const tp = input?.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

/** Emit a deny response and exit 0. */
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  // Only act on Agent / Task / TaskCreate dispatches.
  const toolName = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (toolName !== 'Agent' && toolName !== 'Task' && toolName !== 'TaskCreate') return passthrough()

  const toolInput = input?.tool_input
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return passthrough()

  const bare = normaliseName(toolInput.subagent_type)
  if (!bare) return passthrough()

  const rawTarget = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : bare
  const callerIsSubagent = isSubagentCall(input)
  const callerBare = normaliseName(input?.agent_type)

  // ── Rule 1: junior-orchestrator spawn gate ───────────────────────────────
  // Only the primary (top-level) orchestrator may spawn a junior-orchestrator.
  // Any subagent caller is denied regardless of its identity.
  if (bare === 'junior-orchestrator') {
    if (!callerIsSubagent) return passthrough()
    return deny(
      'groundwork nesting-guard: only the primary orchestrator may spawn a junior-orchestrator. ' +
        'A subagent (a general-purpose worker or another junior-orchestrator) must not — ' +
        'implement the slice directly or surface a blocker to the parent orchestrator.',
    )
  }

  // ── Rule 2: junior-orchestrator caller cap ───────────────────────────────
  // A junior-orchestrator IS the sub-orchestrator: it may delegate only to
  // the JUNIOR_ALLOWED_SPAWN set. Everything else is denied.
  if (callerBare === 'junior-orchestrator' && callerIsSubagent) {
    if (JUNIOR_ALLOWED_SPAWN.has(bare)) return passthrough()
    return deny(
      `groundwork nesting-guard: a junior-orchestrator may delegate only to: ` +
        `general-purpose, explore, advisor, designer, test-engineer, qa. It must not spawn "${rawTarget}".`,
    )
  }

  // ── Rule 3: leaf implementer constraint ──────────────────────────────────
  // Any other subagent implements its own slice and may only call read-only
  // specialists; it may not spawn the orchestrating/implementer types.
  if (!DENIED_AT_DEPTH_1.has(bare)) return passthrough()

  // Only deny when we can positively identify the caller as a subagent.
  // Ambiguous callers (no depth signals) are allowed — fail-open.
  if (!callerIsSubagent) return passthrough()

  return deny(
    `groundwork nesting-guard: a subagent may not dispatch "${rawTarget}".\n` +
      `Depth-1 constraint: subagents implement their own slice directly; they may only\n` +
      `delegate to: explore, advisor, designer, test-engineer, qa, planner.\n` +
      `Do the work yourself, or surface a blocker to the parent orchestrator.`,
  )
}

main().catch(() => passthrough())
