/**
 * TypeScript port of hooks/nesting-guard.mjs — agent-nesting guard.
 * Stateless: takes pre-parsed input and env; no process.exit().
 */
import path from 'node:path'
import type { HookFn, HookResult } from './types.js'
import { normaliseSubagentType, normaliseAllowlistType } from './normalise-subagent-type.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Policy constants ──────────────────────────────────────────────────────────

/** Agents that subagents (depth ≥ 1) are NOT allowed to dispatch. */
const DENIED_AT_DEPTH_1 = new Set(['general-purpose', 'orchestrator', 'debugger'])

/**
 * Types a junior-orchestrator caller IS allowed to spawn (Rule 2).
 * Everything outside this set is denied for junior-orchestrator callers.
 */
const JUNIOR_ALLOWED_SPAWN = new Set([
  'general-purpose',
  'explore',
  'advisor',
  'designer',
  'test-engineer',
  'qa',
])

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Return true when the PreToolUse input originates from a subagent, not the
 * main orchestrator. Uses the same three-signal heuristic as
 * orchestrator-impl-guard.
 */
function isSubagentCall(input: Record<string, unknown>): boolean {
  const agentType = (input as Record<string, unknown>).agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if ((input as Record<string, unknown>).agent_id) return true
  const tp = (input as Record<string, unknown>).transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

// ── Main export ───────────────────────────────────────────────────────────────

export const run: HookFn = async (rawInput, _env) => {
  try {
    const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput
      : {}) as Record<string, unknown>

    // Only act on Agent / Task / TaskCreate dispatches.
    const toolName = typeof input.tool_name === 'string' ? input.tool_name : ''
    if (toolName !== 'Agent' && toolName !== 'Task' && toolName !== 'TaskCreate') {
      return passthrough()
    }

    const toolInput = input.tool_input
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
      return passthrough()
    }
    const ti = toolInput as Record<string, unknown>

    const bare = normaliseSubagentType(ti.subagent_type)
    if (!bare) return passthrough()

    const rawTarget = typeof ti.subagent_type === 'string' ? ti.subagent_type : bare
    const callerIsSubagent = isSubagentCall(input)
    const callerBare = normaliseSubagentType(input.agent_type)

    // ── Rule 1: junior-orchestrator spawn gate ────────────────────────────────
    // Only the primary (top-level) orchestrator may spawn a junior-orchestrator.
    if (bare === 'junior-orchestrator') {
      if (!callerIsSubagent) return passthrough()
      return deny(
        'groundwork nesting-guard: only the primary orchestrator may spawn a junior-orchestrator. ' +
          'A subagent (a general-purpose worker or another junior-orchestrator) must not — ' +
          'implement the slice directly or surface a blocker to the parent orchestrator.',
      )
    }

    // ── Rule 2: junior-orchestrator caller cap ────────────────────────────────
    // A junior-orchestrator may delegate only to the JUNIOR_ALLOWED_SPAWN set.
    // Uses normaliseAllowlistType (strict: known namespace only) so that an
    // unknown namespace like "evil:explore" does NOT satisfy the allowlist by
    // name collision. Allowlists under-match; deny lists over-match — both
    // fail closed, just in opposite directions.
    if (callerBare === 'junior-orchestrator' && callerIsSubagent) {
      const allowBare = normaliseAllowlistType(ti.subagent_type)
      if (allowBare && JUNIOR_ALLOWED_SPAWN.has(allowBare)) return passthrough()
      return deny(
        `groundwork nesting-guard: a junior-orchestrator may delegate only to: ` +
          `general-purpose, explore, advisor, designer, test-engineer, qa. It must not spawn "${rawTarget}".`,
      )
    }

    // ── Rule 3: leaf implementer constraint ───────────────────────────────────
    // Any other subagent implements its own slice and may only call read-only
    // specialists; it may not spawn the orchestrating/implementer types.
    if (!DENIED_AT_DEPTH_1.has(bare)) return passthrough()

    // Only deny when we can positively identify the caller as a subagent.
    if (!callerIsSubagent) return passthrough()

    return deny(
      `groundwork nesting-guard: a subagent may not dispatch "${rawTarget}".\n` +
        `Depth-1 constraint: subagents implement their own slice directly; they may only\n` +
        `delegate to: explore, advisor, designer, test-engineer, qa, planner.\n` +
        `Do the work yourself, or surface a blocker to the parent orchestrator.`,
    )
  } catch {
    return passthrough()
  }
}
