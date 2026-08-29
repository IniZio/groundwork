#!/usr/bin/env node
/**
 * Capture script for ledger-bash-guard.mjs parity corpus.
 * Run: node test/fixtures/parity-corpus/ledger-bash-guard/capture.mjs
 * Writes one JSON fixture file per scenario to this directory.
 *
 * Note: "ledger add" is NOT in the mutating deny list (only init|set|complete|gate|abandon|autopilot|rm|scope-token).
 * Subagent "ledger add" passes. "ledger abandon" is a correct deny example.
 */
import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../../../../hooks/ledger-bash-guard.mjs')
const OUT_DIR = __dirname

function run(stdinPayload) {
  const r = spawnSync(HOOK, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
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
    scenario_name: 'subagent_ledger_add_allowed',
    description: 'Subagent "ledger add" — passes because "add" is NOT in the MUTATING_LEDGER_CMD_RE deny list (only init|set|complete|gate|abandon|autopilot|rm|scope-token)',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'ledger add s1 --wave 1' },
    },
  },
  {
    scenario_name: 'subagent_ledger_abandon_denied',
    description: 'Subagent "ledger abandon" — denied, abandon is in MUTATING_LEDGER_CMD_RE',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'ledger abandon' },
    },
  },
  {
    scenario_name: 'subagent_ledger_complete_denied',
    description: 'Subagent "bin/ledger complete" with plain write token — denied (not a scoped sct_ token)',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'bin/ledger complete s1 --token abc' },
    },
  },
  {
    scenario_name: 'subagent_ledger_set_denied',
    description: 'Subagent "ledger set" — denied, set is in MUTATING_LEDGER_CMD_RE',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'ledger set s1 --status in_progress' },
    },
  },
  {
    scenario_name: 'subagent_ledger_gate_denied',
    description: 'Subagent "ledger gate" — denied, gate is in MUTATING_LEDGER_CMD_RE',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'ledger gate advisor APPROVE --token abc' },
    },
  },
  {
    scenario_name: 'orchestrator_ledger_add_allowed',
    description: 'Orchestrator (no agent markers) "ledger add" — always passes, guard only fires for subagents',
    stdin_payload: {
      tool_name: 'Bash',
      tool_input: { command: 'ledger add s1' },
    },
  },
  {
    scenario_name: 'subagent_ledger_view_allowed',
    description: 'Subagent "ledger view" — passes, view is in READONLY_LEDGER_CMD_RE allow list',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'ledger view' },
    },
  },
  {
    scenario_name: 'subagent_non_ledger_bash_allowed',
    description: 'Subagent non-ledger Bash command — passes, unrelated command',
    stdin_payload: {
      tool_name: 'Bash',
      agent_type: 'general-purpose',
      tool_input: { command: 'echo hello' },
    },
  },
]

console.log(`Capturing ledger-bash-guard.mjs (${SCENARIOS.length} scenarios)`)
for (const s of SCENARIOS) {
  const result = run(s.stdin_payload)
  const fixture = {
    hook: 'ledger-bash-guard.mjs',
    hook_path: 'hooks/ledger-bash-guard.mjs',
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
