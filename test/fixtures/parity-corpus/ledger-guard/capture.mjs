#!/usr/bin/env node
/**
 * Capture script for ledger-guard.mjs parity corpus.
 * Run: node test/fixtures/parity-corpus/ledger-guard/capture.mjs
 * Writes one JSON fixture file per scenario to this directory.
 */
import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../../../../hooks/ledger-guard.mjs')
const OUT_DIR = __dirname

function run(stdinPayload, env = {}) {
  const r = spawnSync(HOOK, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  })
  return {
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    exit_code: r.status ?? 0,
  }
}

function parseDecision(stdout) {
  if (!stdout) return 'PASS'
  try {
    const parsed = JSON.parse(stdout)
    const d = parsed?.hookSpecificOutput?.permissionDecision
    if (d === 'deny') return 'DENY'
  } catch {}
  return 'PASS'
}

function save(scenario, fixture) {
  const file = path.join(OUT_DIR, `${scenario}.json`)
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  ${fixture.decision === 'DENY' ? 'DENY' : 'PASS'}  ${scenario}.json`)
}

const SCENARIOS = [
  {
    scenario_name: 'orchestrator_read_ledger_denied',
    description: 'Orchestrator reads ledger file directly — Read/Edit/MultiEdit denied for ALL callers on ledger paths',
    stdin_payload: {
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/.groundwork/runs/abc-session-123.json' },
    },
  },
  {
    scenario_name: 'orchestrator_write_ledger_allowed',
    description: 'Orchestrator one-shot init Write to ledger — allowed (no agent markers)',
    stdin_payload: {
      tool_name: 'Write',
      tool_input: { file_path: '/home/user/.groundwork/runs/abc-session-123.json' },
    },
  },
  {
    scenario_name: 'subagent_write_ledger_denied',
    description: 'Subagent Write to ledger — denied (Write intercepted for subagent callers)',
    stdin_payload: {
      tool_name: 'Write',
      agent_type: 'general-purpose',
      agent_id: 'agent-123',
      tool_input: { file_path: '/home/user/.groundwork/runs/abc-session-123.json' },
    },
  },
  {
    scenario_name: 'subagent_read_ledger_denied',
    description: 'Subagent reads ledger file — denied (Read denied for all callers on ledger paths)',
    stdin_payload: {
      tool_name: 'Read',
      agent_type: 'general-purpose',
      agent_id: 'agent-123',
      tool_input: { file_path: '/home/user/.groundwork/runs/abc-session-123.json' },
    },
  },
  {
    scenario_name: 'seal_key_read_denied',
    description: 'Any caller reads seal key — denied for ALL callers',
    stdin_payload: {
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/.groundwork/runs/abc-session-123.seal.key' },
    },
  },
  {
    scenario_name: 'non_ledger_path_passes',
    description: 'Read of a normal source file — passthrough, not a ledger path',
    stdin_payload: {
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/project/src/foo.ts' },
    },
  },
  {
    scenario_name: 'non_read_tool_passes',
    description: 'Bash tool call — passthrough, guard only fires on Read/Edit/MultiEdit/Write',
    stdin_payload: {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    },
  },
  {
    scenario_name: 'legacy_run_json_denied',
    description: 'Read of legacy single-session ledger path .groundwork/run.json — denied for all callers',
    stdin_payload: {
      tool_name: 'Read',
      tool_input: { file_path: '/home/user/.groundwork/run.json' },
    },
  },
]

console.log(`Capturing ledger-guard.mjs (${SCENARIOS.length} scenarios)`)
for (const s of SCENARIOS) {
  const result = run(s.stdin_payload)
  const fixture = {
    hook: 'ledger-guard.mjs',
    hook_path: 'hooks/ledger-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: s.scenario_name,
    description: s.description,
    env: {},
    disk_state_setup: [],
    stdin_payload: s.stdin_payload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: parseDecision(result.stdout),
  }
  save(s.scenario_name, fixture)
}
console.log('Done.')
