/**
 * S2 acceptance tests — ledger.mjs emits hook events.
 *
 * AC coverage:
 *  S2-AC1 — `ledger complete S1 S2` → exactly two TASK_COMPLETE events
 *  S2-AC2 — `ledger gate advisor APPROVE --citation X --rubric Y` → one GATE event
 *  S2-AC3 — `ledger abandon` → one SESSION_END event with outcome:"abandoned"
 *  S2-AC4 — motive provenance: rfc_ref present → ledger.rfc_ref; absent → synthetic
 *  S2-AC5 — fail-open: unwritable journal dir → exit 0, slice still complete, stderr non-empty
 *  S2-AC6 — stdout byte-identical to pre-change output
 *  S2-AC7 — rejected write-token → no event appended
 *  S2-AC8 — partial success: `ledger complete S1 BOGUS` → exit 2, S1 complete, one event
 */

// @ts-nocheck
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'hooks', 'ledger.mjs')

let projectDir: string
let ledgerFile: string

const WRITE_TOKEN = 'tok-test-001'

function baseLedger(overrides: Record<string, unknown> = {}) {
  const result: Record<string, unknown> = {
    version: 1,
    active: true,
    session_id: 'sess-test',
    brief: 'test run',
    reinforcements: 0,
    token_free: true, // opt out of token enforcement so tests don't need --token
    slices: [
      { id: 'S1', name: 'tracer', wave: 0, blocked_by: [], status: 'pending', acceptance: ['a'] },
      { id: 'S2', name: 'feature', wave: 1, blocked_by: [], status: 'pending', acceptance: ['b'] },
    ],
    gate: {},
    ...overrides,
  }
  // A ledger with write_token must not also carry token_free — token_free would bypass the check
  if (result.write_token != null) delete result.token_free
  return result
}

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-ledger-events-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
  ledgerFile = path.join(projectDir, '.groundwork', 'run.json')
  writeFileSync(ledgerFile, JSON.stringify(baseLedger(), null, 2))
})
afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

/** Run the ledger CLI with an isolated CLAUDE_PROJECT_DIR (no ambient env leakage). */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
  }
  // Explicitly omit CLAUDE_CODE_SESSION_ID so the CLI uses the legacy run.json path
  const r = spawnSync('node', [CLI, ...args], {
    env,
    encoding: 'utf8',
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function shardPath(sessionId = 'sess-test'): string {
  return path.join(projectDir, '.groundwork', 'journal', `${today()}-${sessionId}.jsonl`)
}

function readShard(sessionId = 'sess-test'): object[] {
  try {
    return readFileSync(shardPath(sessionId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// S2-AC1 — complete two ids → two TASK_COMPLETE events
// ---------------------------------------------------------------------------

test('S2-AC1: ledger complete S1 S2 appends exactly two TASK_COMPLETE events', () => {
  const { code, stdout, stderr } = run(['complete', 'S1', 'S2'])
  expect(code).toBe(0)
  expect(stderr).toBe('')

  const events = readShard()
  const tc = events.filter((e: any) => e.type === 'TASK_COMPLETE')
  expect(tc).toHaveLength(2)

  const slices = tc.map((e: any) => e.data?.slice)
  expect(slices).toContain('S1')
  expect(slices).toContain('S2')

  for (const e of tc as any[]) {
    expect(e.source).toBe('hook:ledger')
    expect(typeof e.ts).toBe('string')
  }
})

// ---------------------------------------------------------------------------
// S2-AC2 — gate APPROVE → one GATE event with verdict + citation + rubric
// ---------------------------------------------------------------------------

test('S2-AC2: ledger gate advisor APPROVE --citation X --rubric Y appends one GATE event', () => {
  const { code, stderr } = run(['gate', 'advisor', 'APPROVE', '--citation', 'TestCite', '--rubric', 'TestRubric'])
  expect(code).toBe(0)
  expect(stderr).toBe('')

  const events = readShard()
  const gateEvents = events.filter((e: any) => e.type === 'GATE')
  expect(gateEvents).toHaveLength(1)

  const g = gateEvents[0] as any
  expect(g.source).toBe('hook:ledger')
  expect(g.data?.verdict).toBe('APPROVE')
  expect(g.data?.citation).toBe('TestCite')
  expect(g.data?.rubric).toBe('TestRubric')
})

// ---------------------------------------------------------------------------
// S2-AC3 — abandon → one SESSION_END with outcome:"abandoned"
// ---------------------------------------------------------------------------

test('S2-AC3: ledger abandon appends one SESSION_END event with outcome:abandoned', () => {
  const { code, stderr } = run(['abandon'])
  expect(code).toBe(0)
  expect(stderr).toBe('')

  const events = readShard()
  const se = events.filter((e: any) => e.type === 'SESSION_END')
  expect(se).toHaveLength(1)

  const e = se[0] as any
  expect(e.source).toBe('hook:ledger')
  expect(e.data?.outcome).toBe('abandoned')
})

// ---------------------------------------------------------------------------
// S2-AC4 — motive provenance
// ---------------------------------------------------------------------------

describe('S2-AC4: motive provenance', () => {
  test('with rfc_ref → motive_provenance:"ledger.rfc_ref"', () => {
    writeFileSync(ledgerFile, JSON.stringify(baseLedger({ rfc_ref: 'rfc-uid-42' }), null, 2))
    run(['complete', 'S1'])
    const events = readShard()
    const tc = events.find((e: any) => e.type === 'TASK_COMPLETE') as any
    expect(tc).toBeDefined()
    expect(tc.motive).toBe('rfc-uid-42')
    expect(tc.data?.motive_provenance).toBe('ledger.rfc_ref')
  })

  test('without rfc_ref → motive="session:..." motive_provenance:"synthetic"', () => {
    run(['complete', 'S1'])
    const events = readShard()
    const tc = events.find((e: any) => e.type === 'TASK_COMPLETE') as any
    expect(tc).toBeDefined()
    expect(tc.motive).toMatch(/^session:/)
    expect(tc.data?.motive_provenance).toBe('synthetic')
  })
})

// ---------------------------------------------------------------------------
// S2-AC5 — fail-open: unwritable journal dir
// ---------------------------------------------------------------------------

test('S2-AC5: unwritable journal dir → exit 0, slice complete, stderr non-empty', () => {
  // Pre-create journal dir and make it unwritable
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  chmodSync(journalDir, 0o444)

  let result: { code: number; stdout: string; stderr: string }
  try {
    result = run(['complete', 'S1'])
  } finally {
    // restore so afterEach cleanup can remove it
    chmodSync(journalDir, 0o755)
  }

  // exit 0 (fail-open)
  expect(result!.code).toBe(0)
  // slice still marked complete
  const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'))
  const s1 = ledger.slices.find((s: any) => s.id === 'S1')
  expect(s1?.status).toBe('complete')
  // stderr contains a warning from emitHookEvent
  expect(result!.stderr.length).toBeGreaterThan(0)
})

// ---------------------------------------------------------------------------
// S2-AC6 — stdout byte-identical to pre-change output
// ---------------------------------------------------------------------------

test('S2-AC6: stdout of complete / gate / abandon unchanged', () => {
  const complete = run(['complete', 'S1'])
  expect(complete.stdout).toBe('S1 ✓ (1/2 complete)\n')

  const gate = run(['gate', 'advisor', 'APPROVE'])
  expect(gate.stdout).toBe('advisor: APPROVE\n')

  const abandon = run(['abandon'])
  expect(abandon.stdout).toBe('run cancelled (active:false) — gate released\n')
})

// ---------------------------------------------------------------------------
// S2-AC7 — rejected write-token → no event
// ---------------------------------------------------------------------------

test('S2-AC7: rejected write-token → no event appended', () => {
  // Write ledger with a write_token set
  writeFileSync(ledgerFile, JSON.stringify(baseLedger({ write_token: 'correct-token' }), null, 2))

  const result = run(['complete', 'S1', '--token', 'wrong-token'])
  expect(result.code).not.toBe(0)

  const events = readShard()
  expect(events.filter((e: any) => e.type === 'TASK_COMPLETE')).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// S2-AC8 — partial success: known id marked, unknown id triggers die
// ---------------------------------------------------------------------------

test('S2-AC8: ledger complete S1 BOGUS → exit 2, S1 complete, exactly one TASK_COMPLETE', () => {
  const result = run(['complete', 'S1', 'BOGUS'])
  expect(result.code).toBe(2)

  // S1 should be complete on disk
  const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'))
  const s1 = ledger.slices.find((s: any) => s.id === 'S1')
  expect(s1?.status).toBe('complete')

  // Exactly one TASK_COMPLETE event, for S1 only
  const events = readShard()
  const tc = events.filter((e: any) => e.type === 'TASK_COMPLETE')
  expect(tc).toHaveLength(1)
  expect((tc[0] as any).data?.slice).toBe('S1')
})
