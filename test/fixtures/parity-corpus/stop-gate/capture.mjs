#!/usr/bin/env node
/**
 * Parity-corpus capture script for hooks/stop-gate.mjs (Stop hook).
 *
 * Runs each scenario against the real hook executable, records stdout/stderr/exit_code,
 * and writes one JSON fixture file per scenario to this directory.
 *
 * Usage: node test/fixtures/parity-corpus/stop-gate/capture.mjs
 *   (re-run to refresh fixtures after hook changes)
 *
 * NEVER touches .groundwork/ in the repo root — each scenario uses an isolated temp dir.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const HOOK_PATH = join(REPO_ROOT, 'hooks', 'stop-gate.mjs')
const LEDGER_BIN = join(REPO_ROOT, 'bin', 'ledger')

/**
 * Spawn the stop-gate hook as an executable (not via `node <path>`).
 * @param {string} projectDir
 * @param {object} stdinPayload
 * @param {object} [extraEnv]
 */
function runHook(projectDir, stdinPayload, extraEnv = {}) {
  const result = spawnSync(HOOK_PATH, [], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ...extraEnv,
    },
    timeout: 10000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exit_code: result.status ?? 1,
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
  return mkdtempSync(join(tmpdir(), `groundwork-sg-${label}-`))
}

const SCENARIOS = []

// ---------------------------------------------------------------------------
// Scenario 1: no_ledger — no .groundwork/runs/ dir → EXIT 0
// ---------------------------------------------------------------------------
SCENARIOS.push(async function no_ledger() {
  const sessionId = 'test-no-ledger-001'
  const tmpDir = makeTempDir('no-ledger')
  try {
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'no_ledger',
      description: 'No .groundwork/runs/ dir exists — hook reads stdin but finds no ledger. Fail-open: EXIT 0 (allow).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 2: active_incomplete — active run, pending slices, no gate → EXIT 1
// ---------------------------------------------------------------------------
SCENARIOS.push(async function active_incomplete() {
  const sessionId = 'test-active-incomplete-002'
  const tmpDir = makeTempDir('active-incomplete')
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'trivial test run',
    slices: [
      { id: 's1', status: 'pending', wave: 1, desc: 'first slice' },
      { id: 's2', status: 'in_progress', wave: 1, desc: 'second slice' },
    ],
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'active_incomplete',
      description: 'Active run with 2 pending/in_progress slices and no advisor gate. Brief contains "trivial" so plan pre-gate is skipped. Hook blocks: EXIT 1.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 2 incomplete slices (pending + in_progress), no gate',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 3: active_all_complete_no_gate — all slices done but no APPROVE → EXIT 1
// ---------------------------------------------------------------------------
SCENARIOS.push(async function active_all_complete_no_gate() {
  const sessionId = 'test-all-complete-no-gate-003'
  const tmpDir = makeTempDir('all-complete-no-gate')
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'trivial',
    slices: [
      { id: 's1', status: 'complete', wave: 1, desc: 'done slice' },
    ],
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'active_all_complete_no_gate',
      description: 'All slices complete but gate.advisor not set. workRemains = !advisorApproved = true. Hook blocks: EXIT 1.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 1 complete slice, no gate',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 4: gate_correction — gate.advisor = "CORRECTION" → EXIT 1
// ---------------------------------------------------------------------------
SCENARIOS.push(async function gate_correction() {
  const sessionId = 'test-gate-correction-004'
  const tmpDir = makeTempDir('gate-correction')
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'trivial',
    slices: [
      { id: 's1', status: 'complete', wave: 1, desc: 'done slice' },
    ],
    gate: { advisor: 'CORRECTION' },
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'gate_correction',
      description: 'gate.advisor = CORRECTION — advisorApproved = false, workRemains = true. Hook blocks: EXIT 1.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 1 complete slice, gate.advisor=CORRECTION',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 5: gate_approve_valid_seal — use bin/ledger to create real approved run → EXIT 0
// ---------------------------------------------------------------------------
SCENARIOS.push(async function gate_approve_valid_seal() {
  // bin/ledger reads CLAUDE_CODE_SESSION_ID from env (not SESSION_ID).
  // Override it with a random UUID so the CLI uses an isolated session for this scenario.
  const sessionId = randomUUID()
  const tmpDir = makeTempDir('gate-approve-valid')
  const ledgerEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: tmpDir,
    // Override both env vars to ensure bin/ledger uses our isolated session ID
    CLAUDE_CODE_SESSION_ID: sessionId,
    SESSION_ID: sessionId,
  }
  try {
    mkdirSync(join(tmpDir, '.groundwork', 'runs'), { recursive: true })

    const initPayload = JSON.stringify({
      active: true,
      session_id: sessionId,
      brief: 'trivial',
      slices: [{ id: 's1', wave: 1, status: 'pending', desc: 'test slice' }],
    })

    // Init the ledger via bin/ledger CLI
    const initResult = spawnSync(LEDGER_BIN, ['init', '-'], {
      input: initPayload,
      encoding: 'utf8',
      env: ledgerEnv,
      timeout: 10000,
    })
    if (initResult.status !== 0) {
      throw new Error(`ledger init failed (status=${initResult.status}): stdout=${initResult.stdout} stderr=${initResult.stderr}`)
    }

    // Parse write_token from init output
    const initOut = initResult.stdout
    const tokenMatch = initOut.match(/write[_-]?token[:\s]+([A-Za-z0-9_-]+)/i)
    if (!tokenMatch) {
      throw new Error(`Could not parse write_token from init output: ${initOut}`)
    }
    const writeToken = tokenMatch[1]

    // Parse the actual ledger path from init output (bin/ledger uses CLAUDE_CODE_SESSION_ID, not our uuid)
    const pathMatch = initOut.match(/→\s+(.+\.json)/)
    const actualLedgerPath = pathMatch ? pathMatch[1] : join(tmpDir, '.groundwork', 'runs', `${sessionId}.json`)

    // Mark slice complete
    const completeResult = spawnSync(LEDGER_BIN, ['complete', 's1', '--token', writeToken], {
      encoding: 'utf8',
      env: ledgerEnv,
      timeout: 10000,
    })
    if (completeResult.status !== 0) {
      throw new Error(`ledger complete failed: stdout=${completeResult.stdout} stderr=${completeResult.stderr}`)
    }

    // Record advisor APPROVE gate (generates seal)
    const gateResult = spawnSync(LEDGER_BIN, ['gate', 'advisor', 'APPROVE', '--token', writeToken], {
      encoding: 'utf8',
      env: ledgerEnv,
      timeout: 10000,
    })
    if (gateResult.status !== 0) {
      throw new Error(`ledger gate failed: stdout=${gateResult.stdout} stderr=${gateResult.stderr}`)
    }

    // Extract actual session_id from ledger file for the hook stdin
    const finalLedger = JSON.parse(readFileSync(actualLedgerPath, 'utf8'))
    const actualSessionId = finalLedger.session_id || sessionId
    // Redact write_token from stored fixture (security)
    const fixtureLedger = { ...finalLedger, write_token: '<redacted>' }

    const stdin = { session_id: actualSessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'gate_approve_valid_seal',
      description: 'All slices complete, gate.advisor=APPROVE with a valid HMAC seal (generated by bin/ledger CLI). Hook allows: EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/<session_id>.json`,
          content_summary: 'active=true, 1 complete slice, gate.advisor=APPROVE, gate.seal=<valid_hmac> (generated by bin/ledger)',
          content: fixtureLedger,
        },
      ],
      stdin_payload: { session_id: '<session_id_matches_ledger>' },
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 6: gate_approve_bad_seal — APPROVE gate but seal HMAC is wrong → EXIT 1
// ---------------------------------------------------------------------------
SCENARIOS.push(async function gate_approve_bad_seal() {
  const sessionId = 'test-gate-approve-bad-seal-006'
  const tmpDir = makeTempDir('gate-approve-bad-seal')
  // gate.seal is present but is a fake value — key file does not exist either
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'trivial',
    slices: [
      { id: 's1', status: 'complete', wave: 1, desc: 'done slice' },
    ],
    gate: {
      advisor: 'APPROVE',
      seal: 'fakeseal-intentionally-invalid-hmac-value',
    },
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'gate_approve_bad_seal',
      description: 'gate.advisor=APPROVE, all slices complete, but gate.seal is a fake HMAC value and no key file exists. checkSeal returns false → fail-closed → EXIT 1 (block).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 1 complete slice, gate.advisor=APPROVE, gate.seal=<invalid_hmac> (no key file)',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 7: abandoned — active:false, no gate.seal → EXIT 0
// ---------------------------------------------------------------------------
SCENARIOS.push(async function abandoned() {
  const sessionId = 'test-abandoned-007'
  const tmpDir = makeTempDir('abandoned')
  const ledger = {
    active: false,
    session_id: sessionId,
    brief: 'trivial',
    slices: [
      { id: 's1', status: 'pending', wave: 1, desc: 'slice never completed' },
    ],
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'abandoned',
      description: 'ledger.active=false with no gate.seal (unsealed/legacy path). checkSeal returns null → legacy: allow. EXIT 0.',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=false, no gate.seal (checkSeal → null, legacy allow path)',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 8: foreign_session — ledger.session_id != stdin session_id → EXIT 0
// ---------------------------------------------------------------------------
SCENARIOS.push(async function foreign_session() {
  // The hook reads the ledger at runs/<stdin_session_id>.json
  // but the ledger's session_id field belongs to a different session → ALLOW
  const stdinSessionId = 'test-current-session-008'
  const ledgerOwner = 'original-owner-session-abc'
  const tmpDir = makeTempDir('foreign-session')
  const ledger = {
    active: true,
    session_id: ledgerOwner,
    brief: 'trivial',
    slices: [
      { id: 's1', status: 'pending', wave: 1, desc: 'pending slice' },
    ],
  }
  try {
    // Write ledger at the path the hook will look for (stdin session_id)
    writeLedger(tmpDir, stdinSessionId, ledger)
    const stdin = { session_id: stdinSessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'foreign_session',
      description: 'Ledger found at runs/<stdin_session_id>.json but ledger.session_id is a different owner. Cross-session leakage guard: EXIT 0 (allow).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${stdinSessionId}.json`,
          content_summary: `active=true, but ledger.session_id="${ledgerOwner}" != stdin.session_id="${stdinSessionId}"`,
          content: ledger,
        },
      ],
      stdin_payload: stdin,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Scenario 9: motive_ref_missing — non-trivial run, no plan_ref/motive → EXIT 1
// ---------------------------------------------------------------------------
SCENARIOS.push(async function motive_ref_missing() {
  const sessionId = 'test-motive-ref-missing-009'
  const tmpDir = makeTempDir('motive-ref-missing')
  // 3 slices with kind=impl → NOT trivial (slices.length > 2 AND has impl kind)
  const ledger = {
    active: true,
    session_id: sessionId,
    brief: 'implement big feature',
    slices: [
      { id: 's1', status: 'pending', wave: 1, kind: 'impl', desc: 'slice one' },
      { id: 's2', status: 'pending', wave: 1, kind: 'impl', desc: 'slice two' },
      { id: 's3', status: 'pending', wave: 2, kind: 'impl', desc: 'slice three' },
    ],
  }
  try {
    writeLedger(tmpDir, sessionId, ledger)
    const stdin = { session_id: sessionId }
    const result = runHook(tmpDir, stdin)
    return {
      hook: 'stop-gate.mjs',
      hook_path: 'hooks/stop-gate.mjs',
      event_type: 'Stop',
      scenario_name: 'motive_ref_missing',
      description: 'Non-trivial run (3 impl slices, non-trivial brief). No plan_ref, no motive_ref/motive, no plan/design slice complete. Plan pre-gate fires: EXIT 1 (block).',
      env: { CLAUDE_PROJECT_DIR: '<isolated_temp_dir>' },
      disk_state_setup: [
        {
          path: `.groundwork/runs/${sessionId}.json`,
          content_summary: 'active=true, 3 impl slices (non-trivial), no plan_ref, no motive',
          content: ledger,
        },
      ],
      stdin_payload: stdin,
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
  console.log('Running stop-gate capture scenarios...')
  for (const scenario of SCENARIOS) {
    const name = scenario.name
    try {
      process.stdout.write(`  ${name}... `)
      const fixture = await scenario()
      // Both allow() and block() call process.exit(0); decision is in stdout JSON content.
      let parsedOut = null
      try { parsedOut = JSON.parse(fixture.stdout) } catch { /* non-json */ }
      const decision = parsedOut?.decision === 'block' ? 'DENY' : 'ALLOW'
      fixture.decision = decision
      writeFixture(name, fixture)
      console.log(`exit=${fixture.exit_code} (${decision})`)
    } catch (err) {
      console.error(`FAILED: ${err.message}`)
      console.error(err.stack)
    }
  }
  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
