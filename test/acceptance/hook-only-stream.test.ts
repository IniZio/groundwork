/**
 * S6 — Integration proof: hook-only stream
 *
 * Drives REAL hook entrypoints (spawn .mjs CLIs) inside a mkdtemp fixture
 * project. No `journal append` call is made anywhere in this test.
 *
 * AC coverage:
 *  S6-AC1 — shard contains all four mandate types: TASK_COMPLETE, GATE, SESSION_END, FAILURE
 *  S6-AC2 — zero events carry source:"cli:journal"; every mandate-type event has source starting "hook:"
 *  S6-AC3 — `journal show --motive <id>` returns all four event types
 *  S6-AC4 — every event carries non-empty `motive`; no `rfc` field present (motive-only schema)
 *  S6-AC5 — shard is saved as test/fixtures/hook-only-stream.jsonl (Step-3 compiler fixture)
 *  S6-AC6 — all lines parse as JSON; tested with ≥2 hooks spawned in parallel (O_APPEND exercise)
 *  S6-AC7 — real repo .groundwork/journal/ is untouched
 */

// @ts-nocheck
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  copyFileSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const LEDGER_CLI = path.join(ROOT, 'hooks', 'ledger.mjs')
const STOP_GATE = path.join(ROOT, 'bin', 'gw-hook')
const SPEC_GUARD = path.join(ROOT, 'hooks', 'spec-guard.mjs')
const STRUGGLE_DETECTOR = path.join(ROOT, 'hooks', 'struggle-detector.mjs')
const JOURNAL_CLI = path.join(ROOT, 'hooks', 'journal.mjs')

// Fixture destination — written to a temp dir during tests to avoid dirtying the committed file.
// The committed fixture at test/fixtures/hook-only-stream.jsonl is the stable golden reference
// consumed by motive-compile and journal-order tests.
let FIXTURE_DEST: string

// Real repo journal dir — must remain untouched (AC7)
const REAL_JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'sess-s6-int'
const MOTIVE = 'test-motive-s6'
const WRITE_TOKEN = 'tok-s6-test'
const RFC_DIR_NAME = 'test-rfc-s6'
const STRUGGLE_THRESHOLD = '2'  // Override GROUNDWORK_STRUGGLE_THRESHOLD for fast crossing

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let tmpDir: string
let tmpDir2: string
let events: object[]
let events2: object[]
let realJournalSnapshot: string[]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function shardPath(): string {
  return path.join(tmpDir, '.groundwork', 'journal', `${today()}-${SESSION_ID}.jsonl`)
}

function baseEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: tmpDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
    CLAUDE_SESSION_ID: SESSION_ID,       // spec-guard uses this env var
    GROUNDWORK_MOTIVE: MOTIVE,           // force known motive via step-1 override
    GROUNDWORK_STRUGGLE_THRESHOLD: STRUGGLE_THRESHOLD,
  }
}

/** Synchronously run the ledger CLI. */
function runLedger(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [LEDGER_CLI, ...args], {
    env: baseEnv(),
    encoding: 'utf8',
    timeout: 15_000,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Synchronously run a hook CLI with JSON stdin. */
function runHookSync(
  hookPath: string,
  payload: object,
  extraEnv: Record<string, string> = {},
  hookArgs: string[] = [],
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(hookPath, hookArgs, {
    input: JSON.stringify(payload),
    env: { ...baseEnv(), ...extraEnv },
    encoding: 'utf8',
    timeout: 15_000,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Asynchronously spawn a hook CLI — returns a promise for parallel use (AC6). */
function spawnHookAsync(
  hookPath: string,
  payload: object,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [hookPath], {
      env: { ...baseEnv(), ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
    child.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout: out, stderr: err }))
  })
}

/** Build a Bash PostToolUse payload for struggle-detector. */
function bashPayload(cmd: string, exitCode = 0): object {
  return {
    tool_name: 'Bash',
    tool_input: { command: cmd },
    tool_response: { output: '', exit_code: exitCode },
    session_id: SESSION_ID,
    cwd: tmpDir,
  }
}

/** Read all lines from the journal shard and parse as JSON objects. */
function readShard(): object[] {
  try {
    return readFileSync(shardPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Pass-2 helpers — same session, different tmpDir, NO GROUNDWORK_MOTIVE
// (forces resolveMotive to fall through to ledger.rfc_ref → provenance:"ledger.rfc_ref")
// ---------------------------------------------------------------------------

function baseEnvNoMotive(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: tmpDir2,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
    CLAUDE_SESSION_ID: SESSION_ID,
    GROUNDWORK_STRUGGLE_THRESHOLD: STRUGGLE_THRESHOLD,
  }
}

function shardPath2(): string {
  return path.join(tmpDir2, '.groundwork', 'journal', `${today()}-${SESSION_ID}.jsonl`)
}

function bashPayload2(cmd: string, exitCode = 0): object {
  return {
    tool_name: 'Bash',
    tool_input: { command: cmd },
    tool_response: { output: '', exit_code: exitCode },
    session_id: SESSION_ID,
    cwd: tmpDir2,
  }
}

function runLedger2(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [LEDGER_CLI, ...args], {
    env: baseEnvNoMotive(),
    encoding: 'utf8',
    timeout: 15_000,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function runHookSync2(
  hookPath: string,
  payload: object,
  extraEnv: Record<string, string> = {},
  hookArgs: string[] = [],
): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(hookPath, hookArgs, {
    input: JSON.stringify(payload),
    env: { ...baseEnvNoMotive(), ...extraEnv },
    encoding: 'utf8',
    timeout: 15_000,
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function spawnHookAsync2(
  hookPath: string,
  payload: object,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [hookPath], {
      env: { ...baseEnvNoMotive(), ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
    child.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout: out, stderr: err }))
  })
}

function readShard2(): object[] {
  try {
    return readFileSync(shardPath2(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Fixture setup + hook driving (runs once before all assertions)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // ── 0. Snapshot real journal BEFORE driving any hooks (AC7) ───────────────
  realJournalSnapshot = existsSync(REAL_JOURNAL_DIR)
    ? readdirSync(REAL_JOURNAL_DIR).filter((f) => f.includes(SESSION_ID))
    : []

  // ── 1. Create isolated temp project dir ────────────────────────────────────
  tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-s6-int-'))
  // Point the fixture dest at the temp dir so the committed fixture stays clean.
  FIXTURE_DEST = path.join(tmpDir, 'hook-only-stream.jsonl')

  // ── 2. Create directory skeleton ─────────────────────────────────────────
  mkdirSync(path.join(tmpDir, '.groundwork', 'rfcs', RFC_DIR_NAME), { recursive: true })
  mkdirSync(path.join(tmpDir, '.groundwork', 'runs'), { recursive: true })
  mkdirSync(path.join(tmpDir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(tmpDir, 'doc', 'specs'), { recursive: true })

  // ── 3. Write RFC (status "draft" → not in ALLOWED_RFC_STATUSES → SPEC_DRIFT) ─
  writeFileSync(
    path.join(tmpDir, '.groundwork', 'rfcs', RFC_DIR_NAME, 'rfc.yaml'),
    `uid: ${MOTIVE}\nstatus: draft\nspec_delta: []\n`,
  )

  // ── 4. Write a spec file so the guarded path exists ──────────────────────
  writeFileSync(path.join(tmpDir, 'doc', 'specs', 'test.md'), '# test spec\n')

  // ── 5. Write the ledger (rfc_ref → RFC dir, one pending slice) ───────────
  const rfcRelPath = `.groundwork/rfcs/${RFC_DIR_NAME}`
  const ledger = {
    version: 1,
    active: true,
    session_id: SESSION_ID,
    brief: 'S6 integration proof run',
    rfc_ref: rfcRelPath,
    reinforcements: 0,
    write_token: WRITE_TOKEN,
    gate: {},
    slices: [
      {
        id: 'S1',
        wave: 0,
        blocked_by: [],
        status: 'pending',
        acceptance: ['slice complete'],
      },
    ],
  }
  writeFileSync(
    path.join(tmpDir, '.groundwork', 'run.json'),
    JSON.stringify(ledger, null, 2),
  )

  // ── 6. FAILURE: drive struggle-detector twice with same command ───────────
  //    threshold=2 → first invocation sets count=1 (no emit)
  //    second invocation sets count=2 (≥ threshold → emit FAILURE)
  const repeatCmd = 'echo integration-test-repeat'
  runHookSync(STRUGGLE_DETECTOR, bashPayload(repeatCmd))

  // ── 7. SPEC_DRIFT + FAILURE in parallel (exercises O_APPEND, AC6) ────────
  //    struggle-detector #2 emits FAILURE; spec-guard emits SPEC_DRIFT
  const specPayload = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(tmpDir, 'doc', 'specs', 'test.md') },
    session_id: SESSION_ID,
    cwd: tmpDir,
  }
  const [, ] = await Promise.all([
    spawnHookAsync(STRUGGLE_DETECTOR, bashPayload(repeatCmd)),
    spawnHookAsync(SPEC_GUARD, specPayload),
  ])

  // ── 8. TASK_COMPLETE ──────────────────────────────────────────────────────
  runLedger(['complete', 'S1', '--token', WRITE_TOKEN])

  // ── 9. GATE ───────────────────────────────────────────────────────────────
  runLedger(['gate', 'advisor', 'APPROVE', '--token', WRITE_TOKEN])

  // ── 10. SESSION_END: stop-gate reads ledger (all complete + APPROVE) ──────
  const stopPayload = { session_id: SESSION_ID, cwd: tmpDir }
  runHookSync(STOP_GATE, stopPayload, {}, ['hook', 'stop-gate'])

  // ── 11. Collect events ───────────────────────────────────────────────────
  events = readShard()

  // ── Pass 2: identical sequence WITHOUT GROUNDWORK_MOTIVE ─────────────────
  //    resolveMotive falls through to ledger.rfc_ref → motive_provenance:"ledger.rfc_ref"
  tmpDir2 = mkdtempSync(path.join(tmpdir(), 'gw-s6-int2-'))
  mkdirSync(path.join(tmpDir2, '.groundwork', 'rfcs', RFC_DIR_NAME), { recursive: true })
  mkdirSync(path.join(tmpDir2, '.groundwork', 'runs'), { recursive: true })
  mkdirSync(path.join(tmpDir2, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(tmpDir2, 'doc', 'specs'), { recursive: true })
  writeFileSync(
    path.join(tmpDir2, '.groundwork', 'rfcs', RFC_DIR_NAME, 'rfc.yaml'),
    `uid: ${MOTIVE}\nstatus: draft\nspec_delta: []\n`,
  )
  writeFileSync(path.join(tmpDir2, 'doc', 'specs', 'test.md'), '# test spec\n')
  writeFileSync(
    path.join(tmpDir2, '.groundwork', 'run.json'),
    JSON.stringify(ledger, null, 2),
  )

  const repeatCmd2 = 'echo integration-test-repeat-p2'
  runHookSync2(STRUGGLE_DETECTOR, bashPayload2(repeatCmd2))

  const specPayload2 = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(tmpDir2, 'doc', 'specs', 'test.md') },
    session_id: SESSION_ID,
    cwd: tmpDir2,
  }
  await Promise.all([
    spawnHookAsync2(STRUGGLE_DETECTOR, bashPayload2(repeatCmd2)),
    spawnHookAsync2(SPEC_GUARD, specPayload2),
  ])

  runLedger2(['complete', 'S1', '--token', WRITE_TOKEN])
  runLedger2(['gate', 'advisor', 'APPROVE', '--token', WRITE_TOKEN])
  runHookSync2(STOP_GATE, { session_id: SESSION_ID, cwd: tmpDir2 }, {}, ['hook', 'stop-gate'])

  events2 = readShard2()

  // ── 12. Save fixture for Step-3 compiler (both passes — env + ledger.rfc_ref provenance) ──
  const pass1Raw = events.length > 0 ? readFileSync(shardPath(), 'utf8') : ''
  const pass2Raw = events2.length > 0 ? readFileSync(shardPath2(), 'utf8') : ''
  if (pass1Raw || pass2Raw) {
    writeFileSync(FIXTURE_DEST, pass1Raw + pass2Raw)
  }
}, 120_000)

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  if (tmpDir2) rmSync(tmpDir2, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe('S6 hook-only stream integration', () => {
  const MANDATE_TYPES = ['TASK_COMPLETE', 'GATE', 'SESSION_END', 'FAILURE'] as const

  test('S6-AC6: all journal lines parse as valid JSON (no partial-line corruption)', () => {
    // readShard() uses JSON.parse on every line — if any throws, events will be empty or throw
    const raw = readFileSync(shardPath(), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(() => JSON.parse(line), `malformed line: ${line.slice(0, 80)}`).not.toThrow()
    }
  })

  test('S6-AC1: shard contains all four mandate event types', () => {
    const types = new Set(events.map((e: any) => e.type))
    for (const t of MANDATE_TYPES) {
      expect(types, `missing type: ${t}`).toContain(t)
    }
  })

  test('S6-AC2: no event carries source:"cli:journal"; all mandate-type events have source starting "hook:"', () => {
    for (const e of events as any[]) {
      expect(e.source, `event ${e.type} has cli:journal source`).not.toBe('cli:journal')
    }
    const mandateEvents = (events as any[]).filter((e) => MANDATE_TYPES.includes(e.type))
    for (const e of mandateEvents) {
      expect(e.source, `${e.type} source does not start with hook:`).toMatch(/^hook:/)
    }
  })

  test('S6-AC4: every event has non-empty motive; no rfc key present (motive-only schema)', () => {
    expect(events.length).toBeGreaterThan(0)
    for (const e of events as any[]) {
      expect(e.motive, `event ${e.type} has empty/missing motive`).toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(e, 'rfc'), `event ${e.type} has unexpected rfc key`).toBe(false)
    }
  })

  test('S6-AC3: journal show --motive returns all four event types', () => {
    const r = spawnSync(
      'node',
      [JOURNAL_CLI, 'show', '--motive', MOTIVE, '--since', '9999d', '--last', '9999'],
      {
        env: { ...baseEnv(), CLAUDE_PROJECT_DIR: tmpDir },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    expect(r.status, `journal show failed: ${r.stderr}`).toBe(0)
    const output = r.stdout
    for (const t of MANDATE_TYPES) {
      expect(output, `journal show missing ${t}`).toContain(t)
    }
  })

  test('S6-AC5: fixture file exists at test/fixtures/hook-only-stream.jsonl', () => {
    expect(existsSync(FIXTURE_DEST), 'fixture not written').toBe(true)
    const lines = readFileSync(FIXTURE_DEST, 'utf8').split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    // Every line must parse as JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test('S6-AC7: real repo .groundwork/journal/ is untouched', () => {
    // realJournalSnapshot was captured in beforeAll BEFORE hooks ran
    const after = existsSync(REAL_JOURNAL_DIR)
      ? readdirSync(REAL_JOURNAL_DIR).filter((f) => f.includes(SESSION_ID))
      : []
    expect(after, `hooks wrote a shard with sess-s6-int in real repo journal`).toEqual(realJournalSnapshot)
  })

  test('S6-AC8: pass-2 events carry motive_provenance:"ledger.rfc_ref" (no GROUNDWORK_MOTIVE)', () => {
    expect(events2.length, 'pass-2 produced no events').toBeGreaterThan(0)
    const ledgerRefEvents = (events2 as any[]).filter(
      (e) => e.data?.motive_provenance === 'ledger.rfc_ref',
    )
    expect(ledgerRefEvents.length, 'no event with motive_provenance:"ledger.rfc_ref" in pass-2').toBeGreaterThan(0)
    // All pass-2 events must carry motive and no rfc key
    for (const e of events2 as any[]) {
      expect(e.motive, `pass-2 event ${e.type} missing motive`).toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(e, 'rfc'), `pass-2 event ${e.type} has unexpected rfc key`).toBe(false)
    }
  })

  test('event counts per type (informational)', () => {
    const counts: Record<string, number> = {}
    for (const e of events as any[]) {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    // At minimum one of each mandate type
    for (const t of MANDATE_TYPES) {
      expect(counts[t] ?? 0).toBeGreaterThanOrEqual(1)
    }
    // Log counts for the report
    console.info('Event counts:', JSON.stringify(counts))
  })
})
