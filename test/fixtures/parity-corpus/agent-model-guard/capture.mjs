#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/agent-model-guard.mjs
 *
 * Usage: node test/fixtures/parity-corpus/agent-model-guard/capture.mjs
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'agent-model-guard.mjs')
const OUT_DIR = __dirname

const HOOK_NAME = 'agent-model-guard.mjs'
const HOOK_REL = 'hooks/agent-model-guard.mjs'

const scenarios = [
  {
    name: 'model_absent_known_agent',
    description: 'No model in tool_input, subagent_type=groundwork:general-purpose — injects sonnet from registry',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:general-purpose' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'model_absent_explore',
    description: 'No model in tool_input, subagent_type=groundwork:explore — injects haiku from registry',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:explore' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'model_absent_advisor',
    description: 'No model in tool_input, subagent_type=groundwork:advisor — injects opus from registry',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:advisor' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'model_already_present',
    description: 'tool_input.model already set — passthrough unchanged (operator intent wins)',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:general-purpose', model: 'sonnet' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'unknown_subagent_type',
    description: 'subagent_type=groundwork:unknown-type not in registry — injects DEFAULT_MODEL (fail-open)',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:unknown-type' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'non_agent_tool',
    description: 'tool_name=Bash — not an agent dispatch, passthrough immediately',
    stdin: { tool_name: 'Bash', tool_input: { command: 'echo hello' } },
    env: {},
    disk_state_setup: [],
  },
]

/**
 * Classify outcome:
 * DENY: stdout JSON contains permissionDecision: 'deny'
 * INJECT: stdout JSON contains permissionDecision: 'allow' + updatedInput with model
 * WARN_ALLOW: stdout JSON contains permissionDecision: 'allow' (no updatedInput)
 * PASS: empty stdout (true passthrough)
 */
function classifyDecision(stdout, exitCode) {
  if (exitCode !== 0) return 'DENY'
  const trimmed = stdout.trim()
  if (!trimmed) return 'PASS'
  try {
    const parsed = JSON.parse(trimmed)
    const hs = parsed?.hookSpecificOutput
    const decision = hs?.permissionDecision
    if (decision === 'deny') return 'DENY'
    if (decision === 'allow') {
      if (hs?.updatedInput?.model) return 'INJECT'
      return 'WARN_ALLOW'
    }
  } catch {
    // non-JSON passthrough
  }
  return 'PASS'
}

const results = []

for (const scenario of scenarios) {
  const stdinStr = JSON.stringify(scenario.stdin)

  const result = spawnSync(HOOK_PATH, [], {
    input: stdinStr,
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...scenario.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const exitCode = result.status ?? (result.error ? 1 : 0)
  const decision = classifyDecision(stdout, exitCode)

  // Extract injected model if present
  let injectedModel = null
  try {
    const parsed = JSON.parse(stdout.trim())
    injectedModel = parsed?.hookSpecificOutput?.updatedInput?.model ?? null
  } catch {
    // no-op
  }

  const fixture = {
    hook: HOOK_NAME,
    hook_path: HOOK_REL,
    event_type: 'PreToolUse',
    scenario_name: scenario.name,
    description: scenario.description,
    env: scenario.env,
    disk_state_setup: scenario.disk_state_setup,
    stdin_payload: scenario.stdin,
    stdout,
    stderr,
    exit_code: exitCode,
    decision,
    injected_model: injectedModel,
  }

  const outPath = path.join(OUT_DIR, `${scenario.name}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')

  results.push({ name: scenario.name, decision, exitCode, injectedModel })
}

// Summary table
console.log('\nagent-model-guard parity-corpus capture — summary')
console.log('─'.repeat(76))
console.log(`${'SCENARIO'.padEnd(36)} ${'DECISION'.padEnd(12)} ${'MODEL'.padEnd(10)} EXIT`)
console.log('─'.repeat(76))
for (const r of results) {
  console.log(`${r.name.padEnd(36)} ${r.decision.padEnd(12)} ${(r.injectedModel ?? '-').padEnd(10)} ${r.exitCode}`)
}
console.log('─'.repeat(76))
console.log(`${results.length} fixtures written to ${OUT_DIR}`)
