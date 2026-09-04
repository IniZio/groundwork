#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/nesting-guard.mjs
 *
 * Usage: node test/fixtures/parity-corpus/nesting-guard/capture.mjs
 *
 * Spawns the hook with each scenario's stdin payload, captures stdout/stderr/exit_code,
 * and writes one JSON fixture file per scenario.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const HOOK_PATH = path.join(REPO_ROOT, 'hooks', 'nesting-guard.mjs')
const OUT_DIR = __dirname

const HOOK_NAME = 'nesting-guard.mjs'
const HOOK_REL = 'hooks/nesting-guard.mjs'

// Shim guard — refuse if the hook has been converted to a gw shim or deleted
{
  let hookContent
  try {
    hookContent = readFileSync(HOOK_PATH, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('REFUSED: hooks/nesting-guard.mjs has been deleted (converted to gw-hook); corpus is frozen (D-10).')
      process.exit(1)
    }
    throw err
  }
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error('REFUSED: hooks/nesting-guard.mjs is a gw shim — re-running capture would overwrite fixtures with shim output, making parity tautological. The corpus is frozen (D-10).')
    process.exit(1)
  }
}

const scenarios = [
  {
    name: 'primary_spawns_junior',
    description: 'Primary orchestrator (no agent_type) spawns junior-orchestrator — Rule 1 PASS (only orchestrator may spawn junior)',
    stdin: { tool_name: 'Agent', tool_input: { subagent_type: 'groundwork:junior-orchestrator' } },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'subagent_spawns_junior',
    description: 'general-purpose subagent tries to spawn junior-orchestrator — Rule 1 DENY',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:junior-orchestrator' },
      agent_type: 'groundwork:general-purpose',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'junior_spawns_allowed_gp',
    description: 'junior-orchestrator spawns general-purpose — Rule 2 PASS (in JUNIOR_ALLOWED_SPAWN)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:general-purpose' },
      agent_type: 'groundwork:junior-orchestrator',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'junior_spawns_allowed_explore',
    description: 'junior-orchestrator spawns explore — Rule 2 PASS (in JUNIOR_ALLOWED_SPAWN)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:explore' },
      agent_type: 'groundwork:junior-orchestrator',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'junior_spawns_denied_debugger',
    description: 'junior-orchestrator spawns debugger — Rule 2 DENY (not in JUNIOR_ALLOWED_SPAWN)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:debugger' },
      agent_type: 'groundwork:junior-orchestrator',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'junior_spawns_denied_orchestrator',
    description: 'junior-orchestrator spawns orchestrator — Rule 2 DENY (not in JUNIOR_ALLOWED_SPAWN)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:orchestrator' },
      agent_type: 'groundwork:junior-orchestrator',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'junior_spawns_denied_junior',
    description: 'junior-orchestrator tries to spawn another junior-orchestrator — Rule 1 DENY (callerIsSubagent=true, target=junior-orchestrator)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:junior-orchestrator' },
      agent_type: 'groundwork:junior-orchestrator',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'leaf_spawns_denied_gp',
    description: 'general-purpose leaf tries to spawn another general-purpose — Rule 3 DENY (DENIED_AT_DEPTH_1)',
    stdin: {
      tool_name: 'Agent',
      tool_input: { subagent_type: 'groundwork:general-purpose' },
      agent_type: 'groundwork:general-purpose',
      agent_id: 'abc123',
    },
    env: {},
    disk_state_setup: [],
  },
  {
    name: 'non_agent_tool_passthrough',
    description: 'tool_name=Bash — not an agent dispatch, passthrough immediately',
    stdin: { tool_name: 'Bash', tool_input: { command: 'echo hello' } },
    env: {},
    disk_state_setup: [],
  },
]

/**
 * Classify outcome from hook output.
 * DENY: stdout JSON contains permissionDecision: 'deny'
 * PASS: empty stdout or no deny
 */
function classifyDecision(stdout, exitCode) {
  if (exitCode !== 0) return 'DENY'
  try {
    const parsed = JSON.parse(stdout.trim())
    const decision = parsed?.hookSpecificOutput?.permissionDecision
    if (decision === 'deny') return 'DENY'
  } catch {
    // passthrough = empty stdout
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
  }

  const outPath = path.join(OUT_DIR, `${scenario.name}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')

  results.push({ name: scenario.name, decision, exitCode, outPath })
}

// Summary table
console.log('\nnesting-guard parity-corpus capture — summary')
console.log('─'.repeat(72))
console.log(`${'SCENARIO'.padEnd(42)} ${'DECISION'.padEnd(8)} EXIT`)
console.log('─'.repeat(72))
for (const r of results) {
  console.log(`${r.name.padEnd(42)} ${r.decision.padEnd(8)} ${r.exitCode}`)
}
console.log('─'.repeat(72))
console.log(`${results.length} fixtures written to ${OUT_DIR}`)
