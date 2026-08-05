/**
 * S8 — AC-coverage view tests
 *
 * AC coverage:
 *  S8-AC1 — Golden-file equivalence: fixture vs compiled ac_coverage view (field-by-field)
 *  S8-AC2 — AC_COVERAGE round-trip: events not silently dropped; appear in agent.ac_coverage
 *  S8-AC3 — met/unmet/uncovered distinction correct (deriveAcCoverage semantics)
 *  S8-AC4 — fold stays pure (0-import guard still passes — asserted in motive-seams.test.ts)
 *  S8-AC5 — COMPILER_VERSION bumped to motive-compile/1.2.0
 *  S8-AC6 — motive-render produces "## AC Coverage" section after "## Open Items"
 *  S8-AC7 — motive-html includes <h2>AC Coverage</h2>
 *  S8-AC8 — ledger complete emits AC_COVERAGE events for slices with covers_ac
 */

// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { compile, COMPILER_VERSION } from '../../hooks/lib/motive-compile.mjs'
import { renderView } from '../../hooks/lib/motive-render.mjs'
import { renderHtml } from '../../hooks/lib/motive-html.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const LEDGER_CLI = path.join(ROOT, 'hooks', 'ledger.mjs')

/** Build a minimal AC_COVERAGE event. */
function acEvent(ac: string, slice: string, motive = 'motive-test') {
  return {
    type: 'AC_COVERAGE',
    ts: '2026-01-01T00:00:00.000Z',
    motive,
    source: 'hook:ledger',
    data: { ac, slice },
  }
}

/** Build a minimal TASK_COMPLETE event. */
function tcEvent(slice: string, motive = 'motive-test') {
  return {
    type: 'TASK_COMPLETE',
    ts: '2026-01-01T00:01:00.000Z',
    motive,
    source: 'hook:ledger',
    data: { slice },
  }
}

/** Build an AC_COVERAGE declaration event (no covering slices). */
function acDeclEvent(ac: string, motive = 'motive-test') {
  return {
    type: 'AC_COVERAGE',
    ts: '2026-01-01T00:00:00.000Z',
    motive,
    source: 'hook:migrate',
    data: { ac, covering: [] },
  }
}

// ---------------------------------------------------------------------------
// S8-AC5 — COMPILER_VERSION
// ---------------------------------------------------------------------------

it('S8-AC5: COMPILER_VERSION is motive-compile/1.4.0', () => {
  expect(COMPILER_VERSION).toBe('motive-compile/1.4.0')
})

// ---------------------------------------------------------------------------
// S8-AC2 — AC_COVERAGE round-trip: events not silently dropped
// ---------------------------------------------------------------------------

it('S8-AC2: AC_COVERAGE events are folded into agent.ac_coverage (not silently dropped)', () => {
  const events = [
    acEvent('AC1', 'S1'),
    acEvent('AC2', 'S1'),
    acEvent('AC2', 'S2'),
  ]
  const view = compile(events, {})
  const cov = view.agent.ac_coverage
  expect(cov).toBeDefined()
  // AC1 has covering [S1], AC2 has covering [S1, S2]
  const all = [...cov.met, ...cov.unmet]
  const ac1 = all.find((a: any) => a.id === 'AC1')
  const ac2 = all.find((a: any) => a.id === 'AC2')
  expect(ac1).toBeDefined()
  expect(ac2).toBeDefined()
  expect(ac1.covering).toContain('S1')
  expect(ac2.covering).toContain('S1')
  expect(ac2.covering).toContain('S2')
})

// ---------------------------------------------------------------------------
// S8-AC3 — met / unmet / uncovered semantics
// ---------------------------------------------------------------------------

describe('S8-AC3: met/unmet semantics (deriveAcCoverage)', () => {
  it('AC is MET when covering non-empty and all covering slices have TASK_COMPLETE', () => {
    const events = [
      acEvent('AC1', 'S1'),
      tcEvent('S1'),
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    expect(cov.met.map((a: any) => a.id)).toContain('AC1')
    expect(cov.unmet.map((a: any) => a.id)).not.toContain('AC1')
    const ac1 = cov.met.find((a: any) => a.id === 'AC1')
    expect(ac1.met).toBe(true)
    expect(ac1.missing).toHaveLength(0)
  })

  it('AC is UNMET when a covering slice has no TASK_COMPLETE', () => {
    const events = [
      acEvent('AC1', 'S1'),
      // No TASK_COMPLETE for S1
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    expect(cov.unmet.map((a: any) => a.id)).toContain('AC1')
    expect(cov.met.map((a: any) => a.id)).not.toContain('AC1')
    const ac1 = cov.unmet.find((a: any) => a.id === 'AC1')
    expect(ac1.met).toBe(false)
    expect(ac1.missing).toContain('S1')
  })

  it('AC is UNMET when covering is empty (no AC_COVERAGE events for that key)', () => {
    // No events at all → no keys → empty met and unmet
    const view = compile([], {})
    const cov = view.agent.ac_coverage
    expect(cov.met).toHaveLength(0)
    expect(cov.unmet).toHaveLength(0)
  })

  it('partial coverage: AC unmet when only some covering slices are complete', () => {
    const events = [
      acEvent('AC1', 'S1'),
      acEvent('AC1', 'S2'),
      tcEvent('S1'),
      // S2 not completed
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    expect(cov.unmet.map((a: any) => a.id)).toContain('AC1')
    const ac1 = cov.unmet.find((a: any) => a.id === 'AC1')
    expect(ac1.missing).toContain('S2')
    expect(ac1.missing).not.toContain('S1')
  })

  it('multiple ACs: ordering by numeric suffix (AC1 before AC10 before AC2 if non-numeric)', () => {
    const events = [
      acEvent('AC10', 'S10'),
      acEvent('AC2', 'S2'),
      acEvent('AC1', 'S1'),
      tcEvent('S1'),
      tcEvent('S2'),
      tcEvent('S10'),
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    const ids = cov.met.map((a: any) => a.id)
    expect(ids.indexOf('AC1')).toBeLessThan(ids.indexOf('AC2'))
    expect(ids.indexOf('AC2')).toBeLessThan(ids.indexOf('AC10'))
  })
})

// ---------------------------------------------------------------------------
// S8-AC1 — Golden-file equivalence (fixture vs compiled view)
// ---------------------------------------------------------------------------

describe('S8-AC1: golden-file equivalence — compiled ac_coverage', () => {
  /**
   * The fixture simulates: a motive with 3 ACs.
   *   AC1 — covered by S1 (completed) → met
   *   AC2 — covered by S1 + S2, but S2 incomplete → unmet
   *   AC3 — covered by S3 (completed) → met
   */
  const FIXTURE_FEATURE = {
    slug: 'golden-test',
    status: 'in_progress',
    ac_coverage: {
      AC1: ['S1'],
      AC2: ['S1', 'S2'],
      AC3: ['S3'],
    },
    runs: [
      {
        session_id: 'sess-1',
        slices_completed: ['S1', 'S3'],
      },
    ],
  }

  it('per-AC statuses match field-by-field', () => {
    // Derive expected from fixture (deriveAcCoverage logic)
    const completed = new Set(FIXTURE_FEATURE.runs.flatMap((r) => r.slices_completed))
    const expected = Object.entries(FIXTURE_FEATURE.ac_coverage).map(([id, covering]) => {
      const missing = (covering as string[]).filter((s) => !completed.has(s))
      const met = (covering as string[]).length > 0 && missing.length === 0
      return { id, covering, missing, met }
    })

    // Build events that correspond to the fixture
    const events: any[] = []
    for (const [ac, slices] of Object.entries(FIXTURE_FEATURE.ac_coverage)) {
      for (const slice of slices as string[]) {
        events.push(acEvent(ac, slice))
      }
    }
    for (const slice of [...completed]) {
      events.push(tcEvent(slice))
    }

    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    const actual = [...cov.met, ...cov.unmet].sort((a: any, b: any) =>
      parseInt(a.id.replace('AC', '')) - parseInt(b.id.replace('AC', ''))
    )

    expect(actual).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i].id).toBe(expected[i].id)
      expect(actual[i].met).toBe(expected[i].met)
      expect(actual[i].covering.sort()).toEqual(expected[i].covering.sort())
      expect(actual[i].missing.sort()).toEqual(expected[i].missing.sort())
    }
  })
})

// ---------------------------------------------------------------------------
// S8-AC1 (golden file) — compile() output field-by-field vs feature.mjs golden
// ---------------------------------------------------------------------------
//
// Provenance: hooks/feature.mjs deriveAcCoverage() at commit 11efcd0.
// Fixture: test/fixtures/ac-coverage-golden.json (checked-in).
//
// Gap closed: AC3 (empty covering []) is now representable via the AC_COVERAGE
// declaration form — { ac, covering: [] } — so compile() produces it as unmet.
// All four golden ACs are now asserted field-by-field.

describe('S8-AC1(golden): compile() ac_coverage matches feature.mjs golden fixture', () => {
  const GOLDEN_PATH = path.join(ROOT, 'test', 'fixtures', 'ac-coverage-golden.json')

  it('golden fixture file exists and is parseable', () => {
    const raw = readFileSync(GOLDEN_PATH, 'utf8')
    const g = JSON.parse(raw)
    expect(g.met).toBeDefined()
    expect(g.unmet).toBeDefined()
  })

  it('compile() met list matches golden met (field-by-field, all ACs including AC3)', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))
    // Build events matching the fixture_doc: AC1=[S1], AC2=[S1,S2], AC3=[], AC4=[S4]
    // completed=[S1,S3]. AC3 uses the declaration form (no covering slices).
    const events: any[] = [
      acEvent('AC1', 'S1'),
      acEvent('AC2', 'S1'),
      acEvent('AC2', 'S2'),
      acDeclEvent('AC3'),
      acEvent('AC4', 'S4'),
      tcEvent('S1'),
      tcEvent('S3'),
    ]
    const view = compile(events, {})
    const actual = view.agent.ac_coverage

    expect(actual.met).toHaveLength(golden.met.length)
    for (const gEntry of golden.met) {
      const aEntry = actual.met.find((a: any) => a.id === gEntry.id)
      expect(aEntry, `${gEntry.id} missing from compile() met`).toBeDefined()
      expect(aEntry.met).toBe(gEntry.met)
      expect([...aEntry.covering].sort()).toEqual([...gEntry.covering].sort())
      expect([...aEntry.missing].sort()).toEqual([...gEntry.missing].sort())
    }
  })

  it('compile() unmet list matches golden unmet (field-by-field, all ACs including AC3)', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'))
    const events: any[] = [
      acEvent('AC1', 'S1'),
      acEvent('AC2', 'S1'),
      acEvent('AC2', 'S2'),
      acDeclEvent('AC3'),
      acEvent('AC4', 'S4'),
      tcEvent('S1'),
      tcEvent('S3'),
    ]
    const view = compile(events, {})
    const actual = view.agent.ac_coverage

    expect(actual.unmet).toHaveLength(golden.unmet.length)
    for (const gEntry of golden.unmet) {
      const aEntry = actual.unmet.find((a: any) => a.id === gEntry.id)
      expect(aEntry, `${gEntry.id} missing from compile() unmet`).toBeDefined()
      expect(aEntry.met).toBe(gEntry.met)
      expect([...aEntry.covering].sort()).toEqual([...gEntry.covering].sort())
      expect([...aEntry.missing].sort()).toEqual([...gEntry.missing].sort())
    }
  })

  it('AC3 declaration form: AC3 appears as unmet with empty covering and missing', () => {
    // Declaration form closes the gap: AC3 with covering:[] is now visible in compile() output.
    const events: any[] = [
      acDeclEvent('AC3'),
    ]
    const view = compile(events, {})
    const ac3 = view.agent.ac_coverage.unmet.find((a: any) => a.id === 'AC3')
    expect(ac3).toBeDefined()
    expect(ac3.met).toBe(false)
    expect(ac3.covering).toHaveLength(0)
    expect(ac3.missing).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S8-AC9 — ac_coverage respects session_completed_ids (semantic-seam fix)
// ---------------------------------------------------------------------------
//
// Regression pair mirroring the F8 slice_state_mismatch tests in
// motive-compile.test.ts:395-442. Verifies that ac_coverage uses the same
// "isComplete" predicate as the divergence check so both halves of compile()
// agree on which slices are done.

describe('S8-AC9: ac_coverage folds session_completed_ids into met/missing', () => {
  /** Ground truth where S1 completed via the session stream (pre-motive TASK_COMPLETE). */
  function makeGtWithSessionIds(sessionCompletedIds: string[]) {
    return {
      head_sha: 'abc1234',
      branch: 'main',
      dirty_paths: [],
      existing_paths: {},
      ledger: { found: true, slices: [], gate: {} },
      session_completed_ids: sessionCompletedIds,
      collected_at: '2026-08-03T09:00:00.000Z',
    }
  }

  it('CASE A: slice complete only via session_completed_ids → AC met, no contradiction', () => {
    // S1 has NO TASK_COMPLETE in the motive-filtered event stream, but IS in
    // session_completed_ids.  ac_coverage must treat S1 as complete → AC1 met.
    const events: any[] = [
      acEvent('AC1', 'S1'),
      // No tcEvent('S1') — the TASK_COMPLETE was emitted under a synthetic motive
    ]
    const gt = makeGtWithSessionIds(['S1'])
    const view = compile(events, { groundTruth: gt })
    const cov = view.agent.ac_coverage

    // AC1 must be in met, not unmet
    expect(cov.met.map((a: any) => a.id)).toContain('AC1')
    expect(cov.unmet.map((a: any) => a.id)).not.toContain('AC1')
    const ac1 = cov.met.find((a: any) => a.id === 'AC1')
    expect(ac1.met).toBe(true)
    expect(ac1.missing).toHaveLength(0)

    // No divergence either (both halves agree)
    expect(view.divergence.banner).toBe('✓ No divergence')
    const mismatches = view.divergence.findings.filter((f: any) => f.kind === 'slice_state_mismatch')
    expect(mismatches).toHaveLength(0)
  })

  it('CASE B: slice absent from both streams → AC still unmet', () => {
    // S1 is NOT in the motive-filtered stream and NOT in session_completed_ids.
    // ac_coverage must keep S1 in missing → AC1 unmet.
    const events: any[] = [
      acEvent('AC1', 'S1'),
      // No tcEvent or session entry for S1
    ]
    const gt = makeGtWithSessionIds([]) // empty — S1 witnessed nowhere
    const view = compile(events, { groundTruth: gt })
    const cov = view.agent.ac_coverage

    expect(cov.unmet.map((a: any) => a.id)).toContain('AC1')
    expect(cov.met.map((a: any) => a.id)).not.toContain('AC1')
    const ac1 = cov.unmet.find((a: any) => a.id === 'AC1')
    expect(ac1.met).toBe(false)
    expect(ac1.missing).toContain('S1')
  })

  it('CASE A without groundTruth: no session stream → normal fold-only semantics unchanged', () => {
    // When groundTruth is absent (no session stream), a TASK_COMPLETE in the
    // motive stream still marks the slice complete.
    const events: any[] = [
      acEvent('AC1', 'S1'),
      tcEvent('S1'),
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    expect(cov.met.map((a: any) => a.id)).toContain('AC1')
    expect(cov.unmet.map((a: any) => a.id)).not.toContain('AC1')
  })
})

// ---------------------------------------------------------------------------
// S8-AC6 — motive-render includes "## AC Coverage" after "## Open Items"
// ---------------------------------------------------------------------------

it('S8-AC6: renderView includes ## AC Coverage after ## Open Items', () => {
  const events = [
    acEvent('AC1', 'S1'),
    tcEvent('S1'),
  ]
  const view = compile(events, {})
  const md = renderView(view)
  expect(md).toContain('## AC Coverage')
  const openIdx = md.indexOf('## Open Items')
  const acIdx = md.indexOf('## AC Coverage')
  const decisionIdx = md.indexOf('## Decision Log')
  expect(openIdx).toBeGreaterThanOrEqual(0)
  expect(acIdx).toBeGreaterThan(openIdx)
  expect(decisionIdx).toBeGreaterThan(acIdx)
})

it('S8-AC6: renderView shows met and unmet entries', () => {
  const events = [
    acEvent('AC1', 'S1'),
    tcEvent('S1'),
    acEvent('AC2', 'S2'),
    // S2 not completed
  ]
  const view = compile(events, {})
  const md = renderView(view)
  expect(md).toContain('AC1')
  expect(md).toContain('met')
  expect(md).toContain('AC2')
  expect(md).toContain('unmet')
})

// ---------------------------------------------------------------------------
// S8-AC7 — motive-html includes <h2>AC Coverage</h2>
// ---------------------------------------------------------------------------

it('S8-AC7: renderHtml includes <h2>AC Coverage</h2>', () => {
  const events = [
    acEvent('AC1', 'S1'),
    tcEvent('S1'),
  ]
  const view = compile(events, {})
  const html = renderHtml(view)
  expect(html).toContain('<h2>AC Coverage</h2>')
})

// ---------------------------------------------------------------------------
// S8-AC8 — ledger complete emits AC_COVERAGE events for slices with covers_ac
// ---------------------------------------------------------------------------

describe('S8-AC8: ledger complete emits AC_COVERAGE events for covers_ac slices', () => {
  let projectDir: string
  let ledgerFile: string

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'gw-motive-cov-'))
    mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
    ledgerFile = path.join(projectDir, '.groundwork', 'run.json')
  })
  afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

  function writeLedger(slices: any[]) {
    writeFileSync(
      ledgerFile,
      JSON.stringify(
        {
          version: 1,
          active: true,
          session_id: 'sess-cov',
          brief: 'coverage test',
          reinforcements: 0,
          slices,
          gate: {},
        },
        null,
        2,
      ),
    )
  }

  function run(args: string[]) {
    return spawnSync('node', [LEDGER_CLI, ...args], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        CLAUDE_PROJECT_DIR: projectDir,
      },
      encoding: 'utf8',
    })
  }

  function readShard(): any[] {
    const shardDir = path.join(projectDir, '.groundwork', 'journal')
    let files: string[]
    try {
      files = require('node:fs').readdirSync(shardDir).filter((f: string) => f.endsWith('.jsonl'))
    } catch {
      return []
    }
    if (!files.length) return []
    const content = readFileSync(path.join(shardDir, files[0]), 'utf8')
    return content
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  }

  it('emits AC_COVERAGE events when slice has covers_ac (single string)', () => {
    writeLedger([
      { id: 'S1', wave: 1, status: 'pending', blocked_by: [], covers_ac: 'AC1' },
    ])
    const result = run(['complete', 'S1'])
    expect(result.status).toBe(0)
    const events = readShard()
    const acEvents = events.filter((e: any) => e.type === 'AC_COVERAGE')
    expect(acEvents).toHaveLength(1)
    expect(acEvents[0].data.slice).toBe('S1')
    expect(acEvents[0].data.ac).toBe('AC1')
  })

  it('emits multiple AC_COVERAGE events when slice has covers_ac array', () => {
    writeLedger([
      { id: 'S1', wave: 1, status: 'pending', blocked_by: [], covers_ac: ['AC1', 'AC2'] },
    ])
    const result = run(['complete', 'S1'])
    expect(result.status).toBe(0)
    const events = readShard()
    const acEvents = events.filter((e: any) => e.type === 'AC_COVERAGE')
    expect(acEvents).toHaveLength(2)
    const acKeys = acEvents.map((e: any) => e.data.ac)
    expect(acKeys).toContain('AC1')
    expect(acKeys).toContain('AC2')
  })

  it('emits no AC_COVERAGE events when slice has no covers_ac', () => {
    writeLedger([
      { id: 'S1', wave: 1, status: 'pending', blocked_by: [] },
    ])
    const result = run(['complete', 'S1'])
    expect(result.status).toBe(0)
    const events = readShard()
    const acEvents = events.filter((e: any) => e.type === 'AC_COVERAGE')
    expect(acEvents).toHaveLength(0)
  })

  it('TASK_COMPLETE is still emitted alongside AC_COVERAGE', () => {
    writeLedger([
      { id: 'S1', wave: 1, status: 'pending', blocked_by: [], covers_ac: 'AC1' },
    ])
    run(['complete', 'S1'])
    const events = readShard()
    const tc = events.filter((e: any) => e.type === 'TASK_COMPLETE')
    const ac = events.filter((e: any) => e.type === 'AC_COVERAGE')
    expect(tc).toHaveLength(1)
    expect(ac).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// G2 fix — AC_COVERAGE array covers form
// ---------------------------------------------------------------------------

describe('G2: AC_COVERAGE array covers form — { slice, covers: [...] }', () => {
  it('registers each ac from covers array in acCoverageMap', () => {
    const events = [
      {
        type: 'AC_COVERAGE',
        ts: '2026-01-01T00:00:00.000Z',
        motive: 'test',
        source: 'cli:journal',
        data: { slice: 'S1-parser', covers: ['AC-1', 'AC-2'] },
      },
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    const all = [...cov.met, ...cov.unmet]
    expect(all.length).toBeGreaterThanOrEqual(2)
    const ids = all.map((a: any) => a.id)
    expect(ids).toContain('AC-1')
    expect(ids).toContain('AC-2')
    // S1-parser must appear as a covering slice for both
    const ac1 = all.find((a: any) => a.id === 'AC-1')
    const ac2 = all.find((a: any) => a.id === 'AC-2')
    expect(ac1.covering).toContain('S1-parser')
    expect(ac2.covering).toContain('S1-parser')
  })

  it('combines covers array with single-ac form for the same AC', () => {
    const events = [
      // single-AC form: S2 covers AC-3
      { type: 'AC_COVERAGE', ts: '2026-01-01T00:00:00.000Z', motive: 'test', source: 'hook:ledger',
        data: { ac: 'AC-3', slice: 'S2-validator' } },
      // array covers form: S3 also covers AC-3 and AC-4
      { type: 'AC_COVERAGE', ts: '2026-01-01T00:00:01.000Z', motive: 'test', source: 'cli:journal',
        data: { slice: 'S3-http', covers: ['AC-3', 'AC-4'] } },
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    const all = [...cov.met, ...cov.unmet]
    const ac3 = all.find((a: any) => a.id === 'AC-3')
    const ac4 = all.find((a: any) => a.id === 'AC-4')
    expect(ac3).toBeDefined()
    expect(ac3.covering).toContain('S2-validator')
    expect(ac3.covering).toContain('S3-http')
    expect(ac4).toBeDefined()
    expect(ac4.covering).toContain('S3-http')
  })

  it('event-only matrix fallback: AC×slice matrix renders non-empty when no ledger is present', () => {
    // AC_COVERAGE events present; groundTruth present but ledger not found (real pilot path)
    const events = [
      {
        type: 'AC_COVERAGE',
        ts: '2026-01-01T00:00:00.000Z',
        motive: 'test',
        source: 'cli:journal',
        data: { slice: 'S1-parser', covers: ['AC-1', 'AC-2'] },
      },
      {
        type: 'AC_COVERAGE',
        ts: '2026-01-01T00:00:01.000Z',
        motive: 'test',
        source: 'hook:ledger',
        data: { ac: 'AC-3', slice: 'S2-validator' },
      },
    ]
    // groundTruth present but ledger not found — simulates motive ledger not discovered
    const groundTruth = {
      head_sha: null,
      branch: null,
      dirty_paths: [],
      existing_paths: {},
      ledger: { found: false, slices: [], gate: {} },
      session_completed_ids: [],
      collected_at: '2026-01-01T00:00:00.000Z',
    }
    const view = compile(events, { groundTruth })
    const cov = view.agent.ac_coverage
    const all = [...cov.met, ...cov.unmet]
    // Matrix must be non-empty
    expect(all.length).toBeGreaterThanOrEqual(2)

    // All entries have status_unknown=true (covering slices exist, ledger not found)
    for (const entry of all) {
      if ((entry as any).covering.length > 0) {
        expect((entry as any).status_unknown).toBe(true)
      }
    }

    // Rendered markdown must include the matrix with "? unknown" status, not "✗ unmet"
    const md = renderView(view)
    expect(md).toContain('AC×Slice Traceability Matrix')
    expect(md).not.toContain('No AC coverage data')
    expect(md).toContain('AC-1')
    expect(md).toContain('AC-2')
    expect(md).toContain('AC-3')
    expect(md).toContain('? unknown')
    expect(md).not.toContain('✗ unmet')
  })
})

// ---------------------------------------------------------------------------
// S8-AC10 — charter-seeded AC coverage
// ---------------------------------------------------------------------------

describe('S8-AC10: charter-declared ACs visible in compile() without events', () => {
  it('declared AC with no covering slices appears in unmet with covering=[]', () => {
    const charter = {
      acceptance_criteria: [
        { id: 'AC-1', statement: 'Must do X.' },
      ],
    }
    const view = compile([], { charter })
    const cov = view.agent.ac_coverage
    const ac1 = cov.unmet.find((a: any) => a.id === 'AC-1')
    expect(ac1).toBeDefined()
    expect(ac1.covering).toHaveLength(0)
    expect(ac1.missing).toHaveLength(0)
    expect(ac1.met).toBe(false)
    expect(ac1.status_unknown).toBe(false)
  })

  it('declared AC claimed by a completed slice is met', () => {
    const charter = {
      acceptance_criteria: [
        { id: 'AC-1', statement: 'Must do X.' },
      ],
    }
    const events = [
      acEvent('AC-1', 'S1'),
      tcEvent('S1'),
    ]
    const view = compile(events, { charter })
    const cov = view.agent.ac_coverage
    expect(cov.met.map((a: any) => a.id)).toContain('AC-1')
    expect(cov.unmet.map((a: any) => a.id)).not.toContain('AC-1')
    const ac1 = cov.met.find((a: any) => a.id === 'AC-1')
    expect(ac1.met).toBe(true)
    expect(ac1.missing).toHaveLength(0)
  })

  it('undeclared AC (event only, no charter) still appears as before', () => {
    // Event-only path must be unaffected by charter seeding
    const events = [
      acEvent('AC-99', 'S1'),
    ]
    const view = compile(events, {})
    const cov = view.agent.ac_coverage
    const all = [...cov.met, ...cov.unmet]
    const ac99 = all.find((a: any) => a.id === 'AC-99')
    expect(ac99).toBeDefined()
    expect(ac99.covering).toContain('S1')
  })

  it('charter with empty acceptance_criteria produces same ac_coverage as no charter', () => {
    // Backward compat: empty acceptance_criteria must not change event-driven output
    const charter = {
      acceptance_criteria: [],
      open_items: [],
      objective: 'x',
      notes: '',
      out_of_scope: '',
      decisions: [],
      path: '/tmp/x.md',
    }
    const events = [acEvent('AC-1', 'S1')]
    const viewWith = compile(events, { charter })
    const viewWithout = compile(events, {})
    const withUnmet = viewWith.agent.ac_coverage.unmet.find((a: any) => a.id === 'AC-1')
    const withoutUnmet = viewWithout.agent.ac_coverage.unmet.find((a: any) => a.id === 'AC-1')
    expect(withUnmet).toEqual(withoutUnmet)
  })

  it('charter null (missing file) does not crash compile()', () => {
    const events = [acEvent('AC-1', 'S1')]
    expect(() => compile(events, { charter: null })).not.toThrow()
  })
})
