/**
 * TypeScript port of hooks/agent-model-guard.mjs — model guard for delegated agents.
 * Stateless: takes pre-parsed input and env; no process.exit(), no readStdin().
 */
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import type { HookFn, HookResult } from './types.js'
import { normaliseSubagentType } from './normalise-subagent-type.js'

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

function warnAllow(reason: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: reason,
        },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

function injectModel(toolInput: unknown, model: string, reason: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: reason,
          updatedInput: { ...(toolInput as Record<string, unknown>), model },
        },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize any model string to the short tier alias accepted by the Claude Code
 * Agent/Task `model` parameter: sonnet | opus | haiku | fable.
 */
function toTierAlias(model: string): string {
  if (typeof model !== 'string') return model
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('sonnet')) return 'sonnet'
  return model
}

/**
 * Resolve the claude-code model for a subagent_type from the registry.
 * Returns null when absent/unknown or maps to "inherit"/empty.
 */
function resolveModel(registry: Record<string, unknown> | null, subagentType: unknown): string | null {
  const key = normaliseSubagentType(subagentType)
  if (!key) return null
  const agents = (registry as Record<string, Record<string, unknown>> | null)?.agents
  const agent = agents?.[key]
  const model = agent && typeof agent === 'object' ? (agent as Record<string, unknown>)['claude-code'] : null
  if (typeof model !== 'string' || !model || model === 'inherit') return null
  return model
}

/**
 * Locate model-registry.json: prefer CLAUDE_PLUGIN_ROOT env, else resolve
 * relative to this file (src/gw/hook/ → ../../../model-registry.json).
 */
function loadRegistry(env: Record<string, string | undefined>): Record<string, unknown> | null {
  const candidates: string[] = []
  if (env.CLAUDE_PLUGIN_ROOT) {
    candidates.push(path.join(env.CLAUDE_PLUGIN_ROOT, 'model-registry.json'))
  }
  // Try relative to the running binary (dist/gw → dist/ → repo root).
  // process.argv[0] is the binary path in both compiled and bun-source modes.
  const binDir = path.dirname(process.argv[0] ?? '')
  candidates.push(path.join(binDir, '..', 'model-registry.json'))
  candidates.push(path.join(binDir, 'model-registry.json'))
  // Also try relative to import.meta.url for source-run environments (bun/vitest).
  try {
    const here = path.dirname(new URL(import.meta.url).pathname)
    candidates.push(path.join(here, '..', '..', '..', 'model-registry.json'))
    candidates.push(path.join(here, '..', '..', 'model-registry.json'))
    candidates.push(path.join(here, '..', 'model-registry.json'))
  } catch { /* ignore — import.meta.url may not be a file URL in compiled binary */ }
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Opt-in diagnostic: append full parsed input to hook-debug.log when
 * GROUNDWORK_HOOK_DEBUG is set. Best-effort — never breaks the hook.
 */
function debugLog(input: unknown, env: Record<string, string | undefined>): void {
  const envVal = env.GROUNDWORK_HOOK_DEBUG
  if (!envVal) return
  try {
    let logPath: string
    if (envVal.includes('/')) {
      logPath = envVal
    } else {
      const pluginRoot =
        env.CLAUDE_PLUGIN_ROOT ||
        path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')
      logPath = path.join(pluginRoot, '.groundwork', 'hook-debug.log')
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...(input as Record<string, unknown>) }) + '\n'
    appendFileSync(logPath, line, 'utf8')
  } catch {
    /* best-effort */
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export const run: HookFn = async (rawInput, env) => {
  try {
    const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput
      : {}) as Record<string, unknown>

    // Opt-in diagnostic.
    debugLog(input, env)

    const toolName = typeof input.tool_name === 'string' ? input.tool_name : ''
    if (toolName !== 'Agent' && toolName !== 'Task' && toolName !== 'TaskCreate') {
      return passthrough()
    }

    const toolInput = input.tool_input
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
      return passthrough()
    }
    const ti = toolInput as Record<string, unknown>

    // Model injected when subagent_type is missing/unknown — never opus.
    const DEFAULT_MODEL = env.GROUNDWORK_DEFAULT_AGENT_MODEL || 'sonnet'

    // Built-in Claude Code agent types banned in favor of namespaced groundwork equivalents.
    const BANNED_BUILTINS = new Set(
      (env.GROUNDWORK_BANNED_BUILTIN_AGENTS || 'explore,general-purpose')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    )

    // Ban built-in agents that duplicate a groundwork agent.
    const rawType = typeof ti.subagent_type === 'string' ? ti.subagent_type.trim() : ''
    if (rawType && !rawType.includes(':') && BANNED_BUILTINS.has(rawType.toLowerCase())) {
      return deny(
        `groundwork: the built-in "${rawType}" agent is banned while groundwork is active — use the namespaced equivalent:\n` +
          `  subagent_type: "groundwork:${rawType.toLowerCase()}"\n` +
          `The groundwork agent runs on its model-registry tier and carries the groundwork role prompt; the built-in inherits the opus session model and has neither.`,
      )
    }

    const registry = loadRegistry(env)
    if (!registry) return passthrough()

    // Prefix warning: bare groundwork agent name without namespace — warn and allow.
    if (rawType && !rawType.includes(':')) {
      const bare = rawType.toLowerCase()
      const groundworkAgents = new Set(Object.keys((registry.agents as Record<string, unknown>) || {}))
      if (groundworkAgents.has(bare)) {
        return warnAllow(
          `groundwork prefix-guard: bare "${rawType}" — use "groundwork:${bare}" to run with the groundwork role prompt and model-registry tier. ` +
            `The harness will not auto-prefix bare names; dispatching "${rawType}" uses the built-in agent with neither.`,
        )
      }
    }

    // Operator intent wins: never override an explicit, non-empty model.
    if (typeof ti.model === 'string' && ti.model.trim()) return passthrough()

    const subagentType = ti.subagent_type
    const resolved = resolveModel(registry, subagentType)
    const model = toTierAlias(resolved || DEFAULT_MODEL)
    const who = (typeof subagentType === 'string' && subagentType.trim()) || '(no subagent_type)'
    const note = resolved
      ? `groundwork model-guard: injected model "${model}" for ${who} (was unset — would have inherited the opus session model)`
      : `groundwork model-guard: ${who} has no registry mapping; injected default "${model}" to avoid inheriting the opus session model`

    return injectModel(toolInput, model, note)
  } catch {
    return passthrough()
  }
}
