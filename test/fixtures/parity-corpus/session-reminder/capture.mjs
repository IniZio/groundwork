#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/session-reminder.mjs (SessionStart hook).
 *
 * Runs each scenario against the real hook executable, records stdout/stderr/exit_code,
 * and writes one JSON fixture file per scenario to this directory.
 *
 * Usage: node test/fixtures/parity-corpus/session-reminder/capture.mjs
 *   (re-run to refresh fixtures after hook changes)
 *
 * NEVER touches .groundwork/ in the repo root — each scenario uses an isolated temp dir.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'session-reminder.mjs')

/**
 * Spawn the session-reminder hook as an executable (not via `node <path>`).
 */
function runHook(projectDir, stdinPayload, extraEnv = {}) {
  const result = spawnSync(HOOK_PATH, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      // Suppress CLAUDE_ENV_FILE writes
      CLAUDE_ENV_FILE: '',
      ...extraEnv,
    },
    timeout: 10000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 0,
  }
}

/**
 * Write a ledger JSON file at the per-session path.
 */
function writeLedger(projectDir, sessionId, content) {
  const runsDir = join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, `${sessionId}.json`), JSON.stringify(content, null, 2))
}

/**
 * Write a fixture JSON file to this directory.
 */
function writeFixture(scenarioName, fixture) {
  const outPath = join(__dirname, `${scenarioName}.json`)
  writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`  wrote ${outPath}`)
}

/**
 * Create an isolated temp dir for a scenario.
 */
function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `groundwork-sr-${label}-`))
}

const SCENARIOS = []

// ---------------------------------------------------------------------------
// Scenario 1: no_ledger — no active run, hook outputs context but no resume block
// ---------------------------------------------------------------------------
SCENARIOS.push(async function no_ledger() {
  const sessionId = 'test-sr-no-ledger-001'
  const tmpDir = makeTempDir('no-ledger')
  try {
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)

    // Parse the JSON output to verify shape
    let parsed = null
    try { parsed = JSON.parse(result.stdout) } catch { /* non-json output */ }
    const hasResumeBlock = result.stdout.includes('ACTIVE RUN — RESUME HERE')

    return {
      hook: 'session-reminder.mjs',
      hook_path: 'hooks/session-reminder.mjs',
      event_type: 'SessionStart',
      scenario_name: 'no_ledger',
      description: 'No .groundwork/runs/ dir. activeRunBlock returns "". Output is context JSON with hookSpecificOutput but no "ACTIVE RUN — RESUME HERE" block. EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [],
      stdin_payload: stdin,
      assertions: {
        has_resume_block: hasResumeBlock,
        output_shape: parsed ? { continue: parsed.continue, has_hookSpecificOutput: 'hookSpecificOutput' in parsed } : null,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 2: active_run — active run with pending slices → outputs resume block
// ---------------------------------------------------------------------------
SCENARIOS.push(async function active_run() {
  const sessionId = 'test-sr-active-run-002'
  const tmpDir = makeTempDir('active-run')
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'implement feature X',
    write_token: 'test-write-token-redacted',
    slices: [
      { id: 's1', wave: 1, status: 'complete', desc: 'done slice', behavior: 'implement auth handler' },
      { id: 's2', wave: 2, status: 'pending', desc: 'pending slice', behavior: 'write integration tests' },
    ],
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)

    let parsed = null
    try { parsed = JSON.parse(result.stdout) } catch { /* non-json */ }
    const additionalContext = parsed?.hookSpecificOutput?.additionalContext ?? ''
    const hasResumeBlock = additionalContext.includes('ACTIVE RUN — RESUME HERE')
    const hasSliceInfo = additionalContext.includes('s2')

    return {
      hook: 'session-reminder.mjs',
      hook_path: 'hooks/session-reminder.mjs',
      event_type: 'SessionStart',
      scenario_name: 'active_run',
      description: 'Active run with 1 complete + 1 pending slice. Hook outputs ACTIVE RUN — RESUME HERE block in additionalContext with slice list and ledger ref. EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 1 complete + 1 pending slice, no gate',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      assertions: {
        has_resume_block: hasResumeBlock,
        has_slice_info: hasSliceInfo,
        output_shape: parsed ? { continue: parsed.continue, has_hookSpecificOutput: 'hookSpecificOutput' in parsed } : null,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 3: pacing_exhausted — pacing budget=1, wave 1 fully resolved, wave 2 pending
//             → outputs pacing warning "Budget exhausted" in resume block
// ---------------------------------------------------------------------------
SCENARIOS.push(async function pacing_exhausted() {
  const sessionId = 'test-sr-pacing-exhausted-003'
  const tmpDir = makeTempDir('pacing-exhausted')
  // isExhausted = true when:
  //   - resolvedUnits (fully complete waves) >= budget+grant
  //   - hasRemainingWork (non-exempt incomplete slices)
  //   - activeUnit is null (no in_progress slices)
  // With policy=wave, budget=1, wave 1 fully complete → resolvedUnits=1, cap=1 → exhausted
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'two-wave feature',
    slices: [
      { id: 's1', wave: 1, status: 'complete', desc: 'wave 1 slice' },
      { id: 's2', wave: 2, status: 'pending', desc: 'wave 2 slice' },
    ],
    pacing: { policy: 'wave', budget: 1 },
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)

    let parsed = null
    try { parsed = JSON.parse(result.stdout) } catch { /* non-json */ }
    const additionalContext = parsed?.hookSpecificOutput?.additionalContext ?? ''
    const hasPacingWarning = additionalContext.includes('Budget exhausted')
    const hasPacingBlock = additionalContext.includes('Pacing policy')

    return {
      hook: 'session-reminder.mjs',
      hook_path: 'hooks/session-reminder.mjs',
      event_type: 'SessionStart',
      scenario_name: 'pacing_exhausted',
      description: 'Active run with pacing.policy=wave, budget=1. Wave 1 fully complete (resolvedUnits=1 >= cap=1) + wave 2 pending (hasRemainingWork). isExhausted=true → "⚠ Budget exhausted" in output. EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, wave 1 complete + wave 2 pending, pacing={policy:wave, budget:1}',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      assertions: {
        has_pacing_warning: hasPacingWarning,
        has_pacing_block: hasPacingBlock,
        output_shape: parsed ? { continue: parsed.continue, has_hookSpecificOutput: 'hookSpecificOutput' in parsed } : null,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 4: foreign_session — ledger.session_id != stdin session_id → no resume block
// ---------------------------------------------------------------------------
SCENARIOS.push(async function foreign_session() {
  const stdinSessionId = 'test-sr-current-session-004'
  const ledgerOwner = 'different-owner-session-xyz'
  const tmpDir = makeTempDir('foreign-session')
  const ledger = {
    active: true,
    session_id: ledgerOwner,
    brief: 'some other run',
    slices: [
      { id: 's1', wave: 1, status: 'pending', desc: 'pending slice' },
    ],
  }
  try {
    // Write at stdin session path so hook can find it but sees mismatched session_id
    writeLedger(tmpDir, stdinSessionId, ledger)
    const stdin = { session_id: stdinSessionId }
    const result = runHook(tmpDir, stdin)

    let parsed = null
    try { parsed = JSON.parse(result.stdout) } catch { /* non-json */ }
    const additionalContext = parsed?.hookSpecificOutput?.additionalContext ?? ''
    const hasResumeBlock = additionalContext.includes('ACTIVE RUN — RESUME HERE')

    return {
      hook: 'session-reminder.mjs',
      hook_path: 'hooks/session-reminder.mjs',
      event_type: 'SessionStart',
      scenario_name: 'foreign_session',
      description: 'Ledger at runs/<stdin_session_id>.json has session_id belonging to a different session. activeRunBlock returns "" (cross-session guard). No resume block in output. EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${stdinSessionId}.json`,
          content_summary: `active=true, but ledger.session_id="${ledgerOwner}" != stdin.session_id="${stdinSessionId}"`,
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      assertions: {
        has_resume_block: hasResumeBlock,
        output_shape: parsed ? { continue: parsed.continue, has_hookSpecificOutput: 'hookSpecificOutput' in parsed } : null,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Run all scenarios and write fixtures
// ---------------------------------------------------------------------------
async function main() {
  console.log('Running session-reminder capture scenarios...')
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = await scenario()
      // session-reminder always exits 0; all decisions are ALLOW (fail-open hook)
      fixture.decision = 'ALLOW'
      writeFixture(name, fixture)
      console.log(`exit=${fixture.exit_code} (ALLOW)`)
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      console.error(err.stack)
    }
  }
  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
