#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — agent-nesting depth-1 guard.
 *
 * PROBLEM: CLAUDE.md's "Depth-1 Constraint" existed only as prose. A
 * general-purpose subagent spawning another general-purpose re-pays the entire
 * fixed session prefix (~8,300 tokens) plus a fresh context for work the first
 * agent should have done itself. The prose rule costs tokens and doesn't bind;
 * this hook binds.
 *
 * POLICY (mirrors CLAUDE.md § "Depth-1 Constraint"):
 *   Depth 0 (main orchestrator) — may dispatch anything, including
 *     general-purpose and orchestrator. Nothing is denied.
 *   Depth ≥ 1 (any subagent) — may dispatch explore, advisor, designer,
 *     test-engineer, qa, planner. DENIED: general-purpose and orchestrator.
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
 * Depth-2 experiment: types a junior-orchestrator caller IS allowed to spawn.
 * Everything outside this set is denied. Gated behind GROUNDWORK_DEPTH2_EXPERIMENT.
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

  // ── Depth-2 experiment (gated behind env flag) ──────────────────────────
  if (process.env.GROUNDWORK_DEPTH2_EXPERIMENT) {
    // FAIL-CLOSED junior spawn: spawning a junior-orchestrator is permitted
    // only when the caller is positively identified as general-purpose.
    // If the caller is a subagent with absent/ambiguous/other agent_type, deny.
    if (bare === 'junior-orchestrator' && callerIsSubagent) {
      if (callerBare !== 'general-purpose') {
        return deny(
          `groundwork nesting-guard: spawning "junior-orchestrator" denied.\n` +
            `Fail-closed rule: only a general-purpose caller may spawn junior-orchestrator;\n` +
            `caller agent_type "${callerBare || '(absent/ambiguous)'}" is not permitted.\n` +
            `Surface the blocker to a general-purpose agent or the parent orchestrator.`,
        )
      }
      // Caller is general-purpose — allow (depth-1 → depth-2 is the one valid path).
      return passthrough()
    }

    // CALLER-TYPE CAP: if caller is junior-orchestrator, apply allow-list.
    if (callerBare === 'junior-orchestrator' && callerIsSubagent) {
      if (!JUNIOR_ALLOWED_SPAWN.has(bare)) {
        return deny(
          `groundwork nesting-guard: a junior-orchestrator may not dispatch "${rawTarget}".\n` +
            `Depth-2 caller-type cap: junior-orchestrator may only delegate to:\n` +
            `general-purpose, explore, advisor, designer, test-engineer, qa.\n` +
            `Do the work yourself, or surface a blocker to the parent orchestrator.`,
        )
      }
      // Target is in the allow-list — permit.
      return passthrough()
    }
  }
  // ── End depth-2 experiment ────────────────────────────────────────────────

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
