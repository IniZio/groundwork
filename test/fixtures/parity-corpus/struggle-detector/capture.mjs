#!/usr/bin/env node
/**
 * Capture script for struggle-detector.mjs parity corpus.
 * Run: node test/fixtures/parity-corpus/struggle-detector/capture.mjs
 * Writes one JSON fixture file per scenario to this directory.
 *
 * IMPORTANT CONTRACT NOTES:
 *  - session_id must be in the stdin JSON payload (not CLAUDE_SESSION_ID env)
 *  - projectDir comes from CLAUDE_PROJECT_DIR env or input.cwd field
 *  - hook always exits 0 (PostToolUse never blocks)
 *  - once-per-session dedup: each (session_id × kind × fingerprint) emitted at most once
 *  - GROUNDWORK_STRUGGLE_THRESHOLD env overrides default threshold of 3
 */
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../../../../hooks/struggle-detector.mjs')
const OUT_DIR = __dirname

function runInvocation(stdinPayload, projectDir, env = {}) {
  const r = spawnSync(HOOK, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...env },
    timeout: 5000,
  })
  return {
    stdin_payload: stdinPayload,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    exit_code: r.status ?? 0,
  }
}

function readTally(projectDir, sessionId) {
  try {
    const fp = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.detector.json`)
    return JSON.parse(readFileSync(fp, 'utf8'))
  } catch { return null }
}

function readSignals(projectDir) {
  try {
    const fp = path.join(projectDir, '.groundwork', 'struggle-signals.jsonl')
    return readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch { return [] }
}

function makeTempDir(name) {
  const d = path.join(os.tmpdir(), `parity-corpus-${name}-${Date.now()}`)
  mkdirSync(path.join(d, '.groundwork', 'runs'), { recursive: true })
  return d
}

function save(scenario, fixture) {
  const file = path.join(OUT_DIR, `${scenario}.json`)
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n')
  const sig = fixture.signal_emitted ? 'SIGNAL' : 'NO-SIGNAL'
  console.log(`  ${sig}  ${scenario}.json`)
}

// ---------------------------------------------------------------------------
// Scenario 1: below_threshold_no_signal
// threshold=3, call 2x with same command — count 2 < threshold, no signal
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-below-thresh-s1'
  const dir = makeTempDir('s1')
  const inv = { tool_name: 'Bash', session_id: SESSION, tool_input: { command: 'ls /tmp' }, tool_response: { exit_code: 0, result: 'file1' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '3' }
  const calls = [runInvocation(inv, dir, ENV), runInvocation(inv, dir, ENV)]
  const tally = readTally(dir, SESSION)
  const signals = readSignals(dir)
  save('below_threshold_no_signal', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'below_threshold_no_signal',
    description: 'Same Bash command called 2x with threshold=3 — count stays below threshold, no signal emitted',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '3', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: signals.length > 0,
    signal_kind: null,
    final_detector_state: tally,
    decision: 'NO-SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

// ---------------------------------------------------------------------------
// Scenario 2: repeat_command_signal_fires
// threshold=2, call 2x with same command — fires on 2nd call
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-repeat-cmd-s2'
  const dir = makeTempDir('s2')
  const inv = { tool_name: 'Bash', session_id: SESSION, tool_input: { command: 'npm test' }, tool_response: { exit_code: 0, result: '' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '2' }
  const calls = [runInvocation(inv, dir, ENV), runInvocation(inv, dir, ENV)]
  const tally = readTally(dir, SESSION)
  const signals = readSignals(dir)
  save('repeat_command_signal_fires', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'repeat_command_signal_fires',
    description: 'Same Bash command called 2x with threshold=2 — repeat-command signal fires on 2nd call',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '2', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: signals.length > 0,
    signal_kind: signals[0]?.kind ?? null,
    final_detector_state: tally,
    decision: signals.length > 0 ? 'SIGNAL' : 'NO-SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

// ---------------------------------------------------------------------------
// Scenario 3: fail_retry_signal
// threshold=2, first call exit_code=1, second exit_code=0 — fail-retry fires
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-fail-retry-s3'
  const dir = makeTempDir('s3')
  const invFail = { tool_name: 'Bash', session_id: SESSION, tool_input: { command: 'tsc --noEmit' }, tool_response: { exit_code: 1, result: '', stderr: 'error TS2345: argument of type' } }
  const invRetry = { tool_name: 'Bash', session_id: SESSION, tool_input: { command: 'tsc --noEmit' }, tool_response: { exit_code: 0, result: '' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '2' }
  const calls = [runInvocation(invFail, dir, ENV), runInvocation(invRetry, dir, ENV)]
  const tally = readTally(dir, SESSION)
  const signals = readSignals(dir)
  save('fail_retry_signal', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'fail_retry_signal',
    description: 'Same command called after prior failure — fail-retry signal fires when hadFail && count >= 2',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '2', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: signals.some(s => s.kind === 'fail-retry'),
    signal_kind: signals.find(s => s.kind === 'fail-retry')?.kind ?? null,
    final_detector_state: tally,
    decision: signals.length > 0 ? 'SIGNAL' : 'NO-SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

// ---------------------------------------------------------------------------
// Scenario 4: file_thrash_signal
// threshold=2, Edit same file twice — file-thrash fires on 2nd call
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-file-thrash-s4'
  const dir = makeTempDir('s4')
  const inv = { tool_name: 'Edit', session_id: SESSION, tool_input: { file_path: '/home/user/project/src/foo.ts' }, tool_response: { result: 'ok' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '2' }
  const calls = [runInvocation(inv, dir, ENV), runInvocation(inv, dir, ENV)]
  const tally = readTally(dir, SESSION)
  const signals = readSignals(dir)
  save('file_thrash_signal', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'file_thrash_signal',
    description: 'Edit on same file_path called 2x with threshold=2 — file-thrash signal fires on 2nd call',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '2', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: signals.some(s => s.kind === 'file-thrash'),
    signal_kind: signals.find(s => s.kind === 'file-thrash')?.kind ?? null,
    final_detector_state: tally,
    decision: signals.length > 0 ? 'SIGNAL' : 'NO-SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

// ---------------------------------------------------------------------------
// Scenario 5: non_matching_tool_passthrough
// tool_name=Read — hook ignores non-Bash/Edit/Write tools, no tally written
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-passthrough-s5'
  const dir = makeTempDir('s5')
  const inv = { tool_name: 'Read', session_id: SESSION, tool_input: { file_path: '/home/user/foo.ts' }, tool_response: { result: 'content' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '2' }
  const calls = [runInvocation(inv, dir, ENV)]
  const tally = readTally(dir, SESSION)
  save('non_matching_tool_passthrough', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'non_matching_tool_passthrough',
    description: 'tool_name=Read — hook only tracks Bash/Edit/Write; Read is ignored, no tally file created',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '2', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: false,
    signal_kind: null,
    final_detector_state: tally,
    decision: 'NO-SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

// ---------------------------------------------------------------------------
// Scenario 6: once_per_session_dedup
// threshold=2, 3 calls — signal fires on 2nd, NOT re-emitted on 3rd
// signals.jsonl has exactly 1 line; emitted map prevents duplicate
// ---------------------------------------------------------------------------
;(() => {
  const SESSION = 'sess-dedup-s6'
  const dir = makeTempDir('s6')
  const inv = { tool_name: 'Bash', session_id: SESSION, tool_input: { command: 'npm test' }, tool_response: { exit_code: 0, result: '' } }
  const ENV = { GROUNDWORK_STRUGGLE_THRESHOLD: '2' }
  const calls = [runInvocation(inv, dir, ENV), runInvocation(inv, dir, ENV), runInvocation(inv, dir, ENV)]
  const tally = readTally(dir, SESSION)
  const signals = readSignals(dir)
  save('once_per_session_dedup', {
    hook: 'struggle-detector.mjs',
    hook_path: 'hooks/struggle-detector.mjs',
    event_type: 'PostToolUse',
    scenario_name: 'once_per_session_dedup',
    description: '3 calls, threshold=2: signal fires on 2nd call, 3rd call does NOT re-emit (once-per-session dedup via emitted map in tally)',
    env: { GROUNDWORK_STRUGGLE_THRESHOLD: '2', CLAUDE_PROJECT_DIR: '<temp_dir>' },
    disk_state_setup: ['mkdir -p <temp_dir>/.groundwork/runs'],
    invocations: calls,
    signal_emitted: signals.length === 1,
    signal_kind: signals[0]?.kind ?? null,
    final_detector_state: tally,
    signals_count: signals.length,
    decision: 'SIGNAL',
  })
  rmSync(dir, { recursive: true, force: true })
})()

console.log('Done.')
