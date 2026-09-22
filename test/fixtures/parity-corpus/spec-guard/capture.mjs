#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/spec-guard.mjs (PreToolUse hook).
 *
 * Usage:
 *   node test/fixtures/parity-corpus/spec-guard/capture.mjs
 *   node test/fixtures/parity-corpus/spec-guard/capture.mjs --verify
 *
 * NEVER touches .groundwork/ in the repo root — each scenario uses an isolated temp dir.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'spec-guard.mjs')
const FIXED_SESSION_ID = 'parity-spec-guard-fixture-session'

{
  const hookContent = readFileSync(HOOK_PATH, 'utf8')
  if (hookContent.includes('src/gw/cli/main.ts')) {
    console.error('REFUSED: hooks/spec-guard.mjs is a gw shim — corpus is frozen.')
    process.exit(1)
  }
}

function runHook(projectDir, stdinPayload, extraEnv = {}) {
  const { CLAUDE_PROJECT_DIR: _cpd, CLAUDE_PLUGIN_ROOT: _cpr, ...restEnv } = process.env
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: { ...restEnv, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID, ...extraEnv },
    timeout: 10000,
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exit_code: result.status ?? 1 }
}

function writeLedger(projectDir, sessionId, content) {
  const runsDir = join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, `${sessionId}.json`), JSON.stringify(content, null, 2))
}

function writeFixture(name, fixture) {
  const outPath = join(__dirname, `${name}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `groundwork-sg-${label}-`))
}

const SCENARIOS = []

// ---------------------------------------------------------------------------
// Scenario 1: non_guarded_absolute_path — src/ path → ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function non_guarded_absolute_path() {
  const tmpDir = makeTempDir('s1')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(tmpDir, 'src', 'foo.ts') },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload)
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'non_guarded_absolute_path',
      description: 'Edit on <tmpdir>/src/foo.ts — relPath "src/foo.ts" is outside guarded prefixes. Passthrough: exit 0, no output.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 2: non_guarded_relative_path — hooks/ relative path → ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function non_guarded_relative_path() {
  const tmpDir = makeTempDir('s2')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'hooks/some-hook.mjs' },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload)
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'non_guarded_relative_path',
      description: 'Write on relative "hooks/some-hook.mjs" — not under doc/specs/ or docs/steering/. Passthrough: exit 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 3: bash_tool_passthrough — Bash not in GUARDED_TOOLS → ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function bash_tool_passthrough() {
  const tmpDir = makeTempDir('s3')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload)
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'bash_tool_passthrough',
      description: 'Bash tool is not in GUARDED_TOOLS (edit/write/multiedit). Immediate passthrough: exit 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 4: spec_build_dir_no_warn — .groundwork/spec-build/ not guarded (D-101) → ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function spec_build_dir_no_warn() {
  const tmpDir = makeTempDir('s4')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(tmpDir, '.groundwork', 'spec-build', 'index.md') },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload)
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'spec_build_dir_no_warn',
      description: 'Write on .groundwork/spec-build/index.md — not a guarded prefix. No WARN; passthrough: exit 0, stderr empty.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 5: guarded_path_no_ledger — doc/specs/ path, no ledger → WARN
// ---------------------------------------------------------------------------
SCENARIOS.push(async function guarded_path_no_ledger() {
  const tmpDir = makeTempDir('s5')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(tmpDir, 'doc', 'specs', 'foo.md') },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload, { CLAUDE_SESSION_ID: FIXED_SESSION_ID })
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'guarded_path_no_ledger',
      description: 'Edit on doc/specs/foo.md (guarded). No ledger on disk. Fail-open: "spec-guard: WARN — no run ledger found" → stderr, exit 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID, CLAUDE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'WARN',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 6: guarded_path_with_ledger — doc/specs/ path, ledger exists → ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function guarded_path_with_ledger() {
  const tmpDir = makeTempDir('s6')
  const ledger = {
    active: true,
    session_id: FIXED_SESSION_ID,
    brief: 'spec parity test',
    slices: [{ id: 's1', wave: 1, status: 'pending', desc: 'test slice' }],
  }
  try {
    writeLedger(tmpDir, FIXED_SESSION_ID, ledger)
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(tmpDir, 'doc', 'specs', 'foo.md') },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload, { CLAUDE_SESSION_ID: FIXED_SESSION_ID })
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'guarded_path_with_ledger',
      description: 'Edit on doc/specs/foo.md (guarded). Ledger found. RFC gate removed in S6 — passthrough after ledger load: exit 0, no output.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID, CLAUDE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [{ path: `.groundwork/runs/${FIXED_SESSION_ID}.json`, content_summary: 'active=true, 1 pending slice', content: ledger }],
      stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 7: malformed_stdin — invalid JSON → fail-open, ALLOW
// ---------------------------------------------------------------------------
SCENARIOS.push(async function malformed_stdin() {
  const { CLAUDE_PROJECT_DIR: _cpd, CLAUDE_PLUGIN_ROOT: _cpr, ...restEnv } = process.env
  const result = spawnSync('node', [HOOK_PATH], {
    input: '{ not valid json',
    encoding: 'utf8',
    env: { ...restEnv, CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
    timeout: 10000,
  })
  return {
    hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
    scenario_name: 'malformed_stdin',
    description: 'Malformed JSON on stdin. Parse error → passthrough() fail-open: exit 0, stdout empty, stderr empty.',
    env: { CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
    disk_state_setup: [],
    stdin_payload: '{ not valid json',
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', exit_code: result.status ?? 1, decision: 'ALLOW',
  }
})

// ---------------------------------------------------------------------------
// Scenario 8: cross_repo_path — absolute path outside projectDir → ALLOW (no WARN)
// ---------------------------------------------------------------------------
SCENARIOS.push(async function cross_repo_path() {
  const tmpDir = makeTempDir('s8')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/home/newman/magic/hanlun-lms/doc/specs/artifact/requirements.md' },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload)
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'cross_repo_path',
      description: 'Write to absolute path in another project. relativeFromProject returns raw path; isGuarded=false → passthrough. Exit 0, stderr empty (no WARN).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'ALLOW',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Scenario 9: docs_steering_no_ledger — docs/steering/ guarded, no ledger → WARN
// ---------------------------------------------------------------------------
SCENARIOS.push(async function docs_steering_no_ledger() {
  const tmpDir = makeTempDir('s9')
  try {
    const stdinPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(tmpDir, 'docs', 'steering', 'style.md') },
      cwd: tmpDir,
      session_id: FIXED_SESSION_ID,
    }
    const result = runHook(tmpDir, stdinPayload, { CLAUDE_SESSION_ID: FIXED_SESSION_ID })
    return {
      hook: 'spec-guard.mjs', hook_path: 'hooks/spec-guard.mjs', event_type: 'PreToolUse',
      scenario_name: 'docs_steering_no_ledger',
      description: 'Write on docs/steering/style.md (second guarded prefix). No ledger on disk. Fail-open: WARN to stderr, exit 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>', CLAUDE_CODE_SESSION_ID: FIXED_SESSION_ID, CLAUDE_SESSION_ID: FIXED_SESSION_ID },
      disk_state_setup: [], stdin_payload: stdinPayload,
      stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, decision: 'WARN',
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------
// Capture: run all scenarios and write fixture files
// ---------------------------------------------------------------------------
async function runCapture() {
  console.log('Running spec-guard capture scenarios...')
  let failed = 0
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.name}... `)
    try {
      const fixture = await scenario()
      writeFixture(scenario.name, fixture)
      console.log(`exit=${fixture.exit_code} decision=${fixture.decision}`)
    } catch (err) {
      failed++
      console.error(`FAILED: ${err.message}\n${err.stack}`)
    }
  }
  if (failed) { console.error(`\n${failed} scenario(s) failed.`); process.exit(1) }
  console.log(`Done. ${SCENARIOS.length} fixtures written.`)
}

// ---------------------------------------------------------------------------
// Verify: re-run scenarios and compare against stored fixtures
// ---------------------------------------------------------------------------
async function runVerify() {
  console.log('Verifying spec-guard fixtures...')
  let passed = 0
  let failed = 0
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    const fixturePath = join(__dirname, `${name}.json`)
    process.stdout.write(`  ${name}... `)
    if (!existsSync(fixturePath)) {
      console.error(`MISSING fixture: ${fixturePath}`)
      failed++
      continue
    }
    let stored
    try { stored = JSON.parse(readFileSync(fixturePath, 'utf8')) }
    catch (err) { console.error(`UNREADABLE: ${err.message}`); failed++; continue }
    let fresh
    try { fresh = await scenario() }
    catch (err) { console.error(`SCENARIO ERROR: ${err.message}`); failed++; continue }
    const ok = fresh.stdout === stored.stdout && fresh.stderr === stored.stderr && fresh.exit_code === stored.exit_code
    if (ok) {
      passed++
      console.log(`OK (exit=${fresh.exit_code} decision=${stored.decision})`)
    } else {
      failed++
      const diffs = []
      if (fresh.exit_code !== stored.exit_code) diffs.push(`exit_code: stored=${stored.exit_code} fresh=${fresh.exit_code}`)
      if (fresh.stdout !== stored.stdout) diffs.push(`stdout: stored=${JSON.stringify(stored.stdout)} fresh=${JSON.stringify(fresh.stdout)}`)
      if (fresh.stderr !== stored.stderr) diffs.push(`stderr: stored=${JSON.stringify(stored.stderr)} fresh=${JSON.stringify(fresh.stderr)}`)
      console.error(`MISMATCH — ${diffs.join('; ')}`)
    }
  }
  console.log(`\nVerify complete: ${passed} identical, ${failed} mismatched.`)
  if (failed > 0) process.exit(1)
}

if (process.argv.includes('--verify')) {
  runVerify().catch(err => { console.error(err); process.exit(1) })
} else {
  runCapture().catch(err => { console.error(err); process.exit(1) })
}
