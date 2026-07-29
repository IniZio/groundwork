#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — model guard for delegated agents.
 *
 * The orchestrator is instructed (CLAUDE.md, "Per-agent models") that every
 * `Task`/`Agent` dispatch MUST carry an explicit `model:`, because Claude Code
 * does NOT auto-apply `model-registry.json` to a subagent — a dispatch with no
 * `model` silently inherits the (expensive) opus session model. That advisory is
 * routinely dropped: a real nexus session fired 30 Agent calls, ALL without
 * `model`, so every git-master/general-purpose/qa subagent billed as opus.
 *
 * This hook is the mechanical backstop. On every Agent/Task/TaskCreate call it:
 *   - LEAVES an explicit `model` untouched (operator intent wins, always);
 *   - otherwise INJECTS the model that `subagent_type` maps to in the registry
 *     (claude-code column), rewriting the tool input via `updatedInput` so the
 *     call runs on the right tier with no retry round-trip;
 *   - for an unknown or absent `subagent_type`, injects a cheap DEFAULT rather
 *     than letting it inherit opus.
 *
 * Design guarantees:
 *  - FAIL-OPEN. Any error, unreadable registry, or unexpected shape → emit
 *    nothing and exit 0, i.e. let the call proceed unchanged. A hook must never
 *    wedge a dispatch.
 *  - NON-OVERRIDING. A call that already specifies `model` is never altered.
 *  - SCOPED. Only acts on the Agent/Task/TaskCreate tools (also gated by the
 *    hooks.json matcher); anything else is a no-op allow.
 *
 * NOTE on TaskCreate: Claude Code v2.1.198+ runs agents in the background by
 * default. For background dispatch the harness fires PreToolUse with
 * tool_name "TaskCreate" (not "Agent"). The tool_input layout is identical
 * (same subagent_type field). The matcher covers all three variants so the ban
 * and model-injection logic applies regardless of foreground vs background.
 *
 * Output contract (PreToolUse): to rewrite input we MUST return
 * permissionDecision "allow" together with the COMPLETE updated input object
 * (updatedInput replaces the input wholesale, so every original field is echoed
 * back plus `model`). See https://code.claude.com/docs/en/hooks.md.
 */

import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStdin, passthrough } from './lib/hook-io.mjs'

/**
 * Opt-in diagnostic: capture the REAL PreToolUse payload shape for TaskCreate
 * dispatches so we can confirm the exact key that holds subagent_type.
 *
 * Enable by setting the env var before starting Claude Code:
 *   export GROUNDWORK_HOOK_DEBUG=/path/to/hook-debug.log
 *   # or a bare value (no "/") to use the default location:
 *   export GROUNDWORK_HOOK_DEBUG=1
 *
 * When unset/empty this function is a complete no-op — zero file I/O, zero
 * perf cost, zero behavior change. When set, one JSON line is appended per
 * hook invocation, capturing the full parsed input (tool_name + tool_input)
 * and a timestamp. Failures are silently swallowed; the hook result is never
 * affected by whether logging succeeds or fails.
 */
function debugLog(input) {
  const envVal = process.env.GROUNDWORK_HOOK_DEBUG
  if (!envVal) return
  try {
    // Use the env value as the log path if it looks like one (contains "/"),
    // otherwise fall back to <plugin-root>/.groundwork/hook-debug.log,
    // resolved the same way loadRegistry() finds model-registry.json.
    let logPath
    if (envVal.includes('/')) {
      logPath = envVal
    } else {
      const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
        || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
      logPath = path.join(pluginRoot, '.groundwork', 'hook-debug.log')
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...input }) + '\n'
    appendFileSync(logPath, line, 'utf8')
  } catch {
    /* best-effort — never break the hook */
  }
}

/** Model injected when subagent_type is missing/unknown — never opus. Defaults to the 'sonnet' tier alias (pinned via ANTHROPIC_DEFAULT_SONNET_MODEL in user settings). */
const DEFAULT_MODEL = process.env.GROUNDWORK_DEFAULT_AGENT_MODEL || 'sonnet'

/**
 * Normalize any model string to the short tier alias accepted by the Claude Code
 * Agent/Task `model` parameter: sonnet | opus | haiku | fable.
 *
 * Handles full model IDs ("claude-sonnet-4-6", "us.anthropic.claude-sonnet-4-6",
 * "claude-sonnet-4-6[1m]"), bare aliases ("opus"), and anything in between.
 * Case-insensitive. Returns the input unchanged when no known tier token is found
 * (defensive pass-through so the caller can still attempt the dispatch).
 */
function toTierAlias(model) {
  if (typeof model !== 'string') return model
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'opus'
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('fable')) return 'fable'
  if (lower.includes('sonnet')) return 'sonnet'
  return model
}

/**
 * Built-in Claude Code agent types that groundwork BANS in favor of its own
 * namespaced equivalents. The built-ins default to `inherit` (the opus session
 * model) and, more importantly, carry none of groundwork's role prompts. A bare
 * (unprefixed) subagent_type is a built-in; the groundwork agent is namespaced
 * (e.g. "groundwork:explore"). Override the set via env (comma-separated).
 */
const BANNED_BUILTINS = new Set(
  (process.env.GROUNDWORK_BANNED_BUILTIN_AGENTS || 'explore,general-purpose')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

/** Deny a dispatch outright (built-in agent ban). */
function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

/** Auto-approve the call with a rewritten input that carries `model`. */
function injectModel(toolInput, model, reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: reason,
        updatedInput: { ...toolInput, model },
      },
    }),
  )
  process.exit(0)
}

/**
 * Locate model-registry.json: prefer the plugin root env, else resolve relative
 * to this script (hooks/ → ../model-registry.json). Returns the parsed object or
 * null on any failure (caller fails open).
 */
function loadRegistry() {
  const candidates = []
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    candidates.push(path.join(process.env.CLAUDE_PLUGIN_ROOT, 'model-registry.json'))
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  candidates.push(path.join(here, '..', 'model-registry.json'))
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Pure: normalize a subagent_type to a registry key. Strips a `prefix:` (e.g.
 * "groundwork:general-purpose" → "general-purpose") and lowercases (built-in
 * "Explore" → "explore"). Empty/absent → ''.
 */
function registryKey(subagentType) {
  if (typeof subagentType !== 'string' || !subagentType.trim()) return ''
  const afterPrefix = subagentType.includes(':') ? subagentType.slice(subagentType.lastIndexOf(':') + 1) : subagentType
  return afterPrefix.trim().toLowerCase()
}

/**
 * Pure: resolve the claude-code model for a subagent_type. Returns the registry
 * model, or null when the key is absent/unknown or maps to "inherit"/empty (the
 * caller then uses DEFAULT_MODEL). Never returns "inherit".
 */
function resolveModel(registry, subagentType) {
  const key = registryKey(subagentType)
  if (!key) return null
  const agent = registry?.agents?.[key]
  const model = agent && typeof agent === 'object' ? agent['claude-code'] : null
  if (typeof model !== 'string' || !model || model === 'inherit') return null
  return model
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  // Opt-in diagnostic: log full payload before any filtering (see debugLog above).
  debugLog(input)

  const toolName = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (toolName !== 'Agent' && toolName !== 'Task' && toolName !== 'TaskCreate') return passthrough()

  const toolInput = input?.tool_input
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return passthrough()

  // Ban built-in agents that duplicate a groundwork agent. A bare (unprefixed)
  // subagent_type is a Claude Code built-in; the groundwork equivalent is
  // namespaced ("groundwork:explore"). Built-ins skip groundwork's role prompt
  // and default to the opus session model.
  const rawType = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type.trim() : ''
  if (rawType && !rawType.includes(':') && BANNED_BUILTINS.has(rawType.toLowerCase())) {
    return deny(
      `groundwork: the built-in "${rawType}" agent is banned while groundwork is active — use the namespaced equivalent:\n` +
        `  subagent_type: "groundwork:${rawType.toLowerCase()}"\n` +
        `The groundwork agent runs on its model-registry tier and carries the groundwork role prompt; the built-in inherits the opus session model and has neither.`,
    )
  }

  // Operator intent wins: never override an explicit, non-empty model.
  if (typeof toolInput.model === 'string' && toolInput.model.trim()) return passthrough()

  const registry = loadRegistry()
  if (!registry) return passthrough()

  const subagentType = toolInput.subagent_type
  const resolved = resolveModel(registry, subagentType)
  const model = toTierAlias(resolved || DEFAULT_MODEL)
  const who = (typeof subagentType === 'string' && subagentType.trim()) || '(no subagent_type)'
  const note = resolved
    ? `groundwork model-guard: injected model "${model}" for ${who} (was unset — would have inherited the opus session model)`
    : `groundwork model-guard: ${who} has no registry mapping; injected default "${model}" to avoid inheriting the opus session model`

  return injectModel(toolInput, model, note)
}

// Only execute when run directly (not imported as a module under test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => passthrough())
}
