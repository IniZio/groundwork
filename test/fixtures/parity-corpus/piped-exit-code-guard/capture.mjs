#!/usr/bin/env node
/**
 * Capture script for piped-exit-code-guard.mjs parity corpus.
 * Run: node test/fixtures/parity-corpus/piped-exit-code-guard/capture.mjs
 * Writes one JSON fixture file per scenario to this directory.
 */
import { spawnSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../../../../hooks/piped-exit-code-guard.mjs')
const OUT_DIR = __dirname

// Shim guard — refuse if the hook has been converted to a gw shim
{
  const hookContent = readFileSync(HOOK, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error('REFUSED: hooks/piped-exit-code-guard.mjs is a gw shim — re-running capture would overwrite fixtures with shim output, making parity tautological. The corpus is frozen (D-10).')
    process.exit(1)
  }
}

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
    scenario_name: 'pipe_to_grep_then_dollar_q',
    description: 'pipe | grep then ; echo $? — denied, $? captures grep not upstream cmd',
    command: 'cat file.txt | grep foo; echo $?',
  },
  {
    scenario_name: 'pipe_to_tail_then_dollar_q',
    description: 'pipe | tail then ; echo $? — denied, $? captures tail not upstream cmd',
    command: 'some_cmd | tail -n 20; echo $?',
  },
  {
    scenario_name: 'pipe_to_wc_then_if_dollar_q',
    description: 'pipe | wc then ; if [ $? ... ] — denied, $? captures wc not upstream cmd',
    command: 'ls | wc -l; if [ $? -eq 0 ]',
  },
  {
    scenario_name: 'pipe_to_awk_then_dollar_q',
    description: 'pipe | awk then && echo $? — denied, $? captures awk exit status',
    command: 'cat log.txt | awk \'{print $1}\' && echo $?',
  },
  {
    scenario_name: 'safe_pipestatus_allowed',
    description: 'pipe | grep then ${PIPESTATUS[0]} — passes, PIPESTATUS[0] reads the correct upstream exit status',
    command: 'cat file.txt | grep foo; echo ${PIPESTATUS[0]}',
  },
  {
    scenario_name: 'pipe_no_status_check_allowed',
    description: 'multi-pipe with no $? check — passes, no status read after pipe',
    command: 'cat file.txt | grep foo | sort',
  },
  {
    scenario_name: 'dollar_q_without_pipe_allowed',
    description: '$? after plain command with no pipe — passes, not the guarded pattern',
    command: 'ls foo; echo $?',
  },
  {
    scenario_name: 'single_quoted_dollar_q_allowed',
    description: "$? inside single quotes — passes, hook strips single-quoted strings before matching",
    command: "echo '$?' | cat",
  },
]

console.log(`Capturing piped-exit-code-guard.mjs (${SCENARIOS.length} scenarios)`)
for (const s of SCENARIOS) {
  const stdinPayload = { tool_name: 'Bash', tool_input: { command: s.command } }
  const result = run(stdinPayload)
  const fixture = {
    hook: 'piped-exit-code-guard.mjs',
    hook_path: 'hooks/piped-exit-code-guard.mjs',
    event_type: 'PreToolUse',
    scenario_name: s.scenario_name,
    description: s.description,
    env: {},
    disk_state_setup: [],
    stdin_payload: stdinPayload,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    decision: parseDecision(result.stdout),
  }
  save(s.scenario_name, fixture)
}
console.log('Done.')
