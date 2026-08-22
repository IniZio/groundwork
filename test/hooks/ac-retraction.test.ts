/**
 * AC_RETRACTION — append-only coverage retraction tests
 *
 * V11: a mistaken AC_COVERAGE claim (e.g. S9→AC-11, S10→AC-10) can be corrected
 * by appending an AC_RETRACTION event.  The journal is never mutated; all three
 * folds (motive-compile, motive-map, motive-graph-fold) honour the retraction in
 * an order-independent post-loop pass.
 *
 * Acceptance criteria verified here:
 *   R-AC1  — retracted claim no longer counts as coverage
 *   R-AC2  — unretracted claim still counts (no over-correction)
 *   R-AC3  — order-independence: retraction before claim → same result
 *   R-AC4  — PARITY: both folds agree on retracted coverage (with bite proof)
 *   R-AC5  — AC_RETRACTION is in NEVER_COMPRESS
 *   R-AC6  — CLI records AC_RETRACTION event
 */

// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compile } from '../../hooks/lib/motive-compile.mjs'
import { NEVER_COMPRESS } from '../../hooks/lib/journal-io.mjs'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'
import { assembleGraphFold } from '../../hooks/lib/motive-graph-fold.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_CLI = join(ROOT, 'hooks', 'journal.mjs')
const MOTIVE = 'retraction-test'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'gw-ac-retract-'))
}

function makeJournalEnv(dir: string, sessionId = 'test-retract-session'): Record<string, string> {
  return { ...process.env, CLAUDE_PROJECT_DIR: dir, JOURNAL_SESSION_ID: sessionId }
}

/** Write events as a JSONL shard in the journal dir for MOTIVE. */
function writeJournalShard(dir: string, events: object[]): void {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(journalDir, '2026-01-01-test.jsonl'), lines + '\n', 'utf8')
}

/** Write a minimal charter with acceptance_criteria. */
function writeCharter(dir: string, motive: string, acIds: string[]): void {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  const acLines = acIds.map((id) => `- ${id}: Statement for ${id}`).join('\n')
  writeFileSync(
    join(motiveDir, 'motive.md'),
    `# ${motive}\n\n## Objective\nRetraction test motive.\n\n## Acceptance criteria\n\n${acLines}\n`,
  )
}

/** Read MAP.md for a motive. */
function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

function runJournal(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [JOURNAL_CLI, ...args], { encoding: 'utf8', env })
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

const TS1 = '2026-01-01T00:00:00.000Z'
const TS2 = '2026-01-01T00:01:00.000Z'
const TS3 = '2026-01-01T00:02:00.000Z'
const TS4 = '2026-01-01T00:03:00.000Z'

function acCovEvent(ac: string, slice: string, ts = TS1, motive = MOTIVE) {
  return { type: 'AC_COVERAGE', ts, motive, source: 'hook:ledger', data: { ac, slice } }
}
function tcEvent(slice: string, ts = TS2, motive = MOTIVE) {
  return { type: 'TASK_COMPLETE', ts, motive, source: 'hook:ledger', data: { slice } }
}
function acRetractEvent(ac: string, slice: string, reason: string, ts = TS3, motive = MOTIVE) {
  return { type: 'AC_RETRACTION', ts, motive, source: 'cli:journal', data: { ac, slice, reason } }
}

// ---------------------------------------------------------------------------
// Three-fold parity helpers (used by R-AC4 and R-AC4-BITE)
// ---------------------------------------------------------------------------

/**
 * Feed ONE event stream to all three folds and return whether each fold
 * believes (acId, sliceId) is still covered after processing those events.
 *
 * Optional fold-override functions let bite tests inject broken fold
 * behaviour WITHOUT changing the event stream:
 *   compileFn      — replaces the real `compile` call (receives full events)
 *   graphFoldFn    — replaces the real `assembleGraphFold` call (full events)
 *   mapPostProcess — transforms MAP.md text after regeneration (full shard)
 *
 * When no overrides are supplied every fold receives the identical `events`
 * array and the helper is a genuine three-way parity check.
 *
 * Parity mechanism: structured-data comparison, not source-text assertion.
 *   compile:   ac_coverage.{met,unmet}[i].covering (string[])
 *   graphFold: active covers_ac edges in assembleGraphFold output (not retired)
 *   map:       MAP.md parsed to Map<acId, Set<sliceId>> — (ac, slice)-level,
 *              matching compile and graph arms.  Line format (motive-map.mjs:988):
 *                `✓ **<acId>** — met (covered by: <s1>, <s2>)`
 *              A cosmetic change to the ✓ rendering or "covered by:" clause would
 *              break this guard — intentional contract coupling.
 *              regenerateMotiveMap is void-returning; MAP.md is the only output surface.
 */
function computeThreeFoldCoverage(
  acId: string,
  sliceId: string,
  events: any[],
  dir: string,
  motive: string,
  overrides?: {
    compileFn?: (evts: any[], opts: any) => any,
    graphFoldFn?: (evts: any[]) => any,
    mapPostProcess?: (mapMd: string) => string,
  },
): { compile: boolean; graphFold: boolean; map: boolean } {
  const compileFn = overrides?.compileFn ?? compile
  const graphFoldFn = overrides?.graphFoldFn ?? assembleGraphFold
  const mapPostProcess = overrides?.mapPostProcess ?? ((md: string) => md)

  // ── motive-compile fold — full event stream ────────────────────────────────
  const compileView = compileFn(events, {})
  const compileAll: any[] = [
    ...compileView.agent.ac_coverage.met,
    ...compileView.agent.ac_coverage.unmet,
  ]
  const compileEntry = compileAll.find((a: any) => a.id === acId)
  const compileCovered: boolean = compileEntry?.covering?.includes(sliceId) ?? false

  // ── motive-graph-fold — full event stream ──────────────────────────────────
  const graph = graphFoldFn(events)
  const graphCovered: boolean = graph.edges.some(
    (e: any) =>
      e.kind === 'covers_ac' &&
      e.from === `slice:${sliceId}` &&
      e.to === `ac:${acId}`,
  )

  // ── motive-map fold — full event stream written to shard ───────────────────
  // regenerateMotiveMap is void; MAP.md is the only output surface.
  writeJournalShard(dir, events)
  regenerateMotiveMap(dir, motive)
  const rawMapMd = readMap(dir, motive)
  const mapMd = mapPostProcess(rawMapMd)
  // Parse to Map<acId, Set<sliceId>> — (ac, slice)-level, matching compile and graph arms.
  // Format: `✓ **<acId>** — met (covered by: <s1>, <s2>)` (motive-map.mjs:988).
  // If the "covered by:" rendering changes this regex breaks — intentional contract coupling.
  const mapAcSlices = new Map<string, Set<string>>()
  for (const m of mapMd.matchAll(/✓ \*\*([^*]+)\*\* — met \(covered by: ([^)]+)\)/g)) {
    const acKey = m[1]
    const sliceIds = m[2].split(',').map((s: string) => s.trim())
    mapAcSlices.set(acKey, new Set(sliceIds))
  }
  const mapCovered: boolean = mapAcSlices.get(acId)?.has(sliceId) ?? false

  return { compile: compileCovered, graphFold: graphCovered, map: mapCovered }
}

/**
 * Throw if any fold disagrees with the others on (acId, sliceId) coverage.
 */
function assertThreeFoldParity(
  results: { compile: boolean; graphFold: boolean; map: boolean },
  acId: string,
  sliceId: string,
): void {
  const { compile: c, graphFold: g, map: m } = results
  if (c !== g || c !== m) {
    throw new Error(
      `Three-fold parity failure for (${acId}←${sliceId}): ` +
      `compile=${c}, graph-fold=${g}, map=${m}`,
    )
  }
}

// ---------------------------------------------------------------------------
// R-AC5 — AC_RETRACTION is in NEVER_COMPRESS
// ---------------------------------------------------------------------------

it('R-AC5: AC_RETRACTION is in NEVER_COMPRESS', () => {
  expect(NEVER_COMPRESS.has('AC_RETRACTION')).toBe(true)
})

// ---------------------------------------------------------------------------
// R-AC1 — retracted claim no longer counts as coverage (motive-compile fold)
// ---------------------------------------------------------------------------

describe('R-AC1: retracted claim no longer counts (motive-compile)', () => {
  it('removes AC-1 from coverage when retracted', () => {
    const events = [
      acCovEvent('AC-1', 'S1'),
      tcEvent('S1'),
      acRetractEvent('AC-1', 'S1', 'mistake'),
    ]
    const view = compile(events, {})
    const all: any[] = [...view.agent.ac_coverage.met, ...view.agent.ac_coverage.unmet]
    const ac1 = all.find((a: any) => a.id === 'AC-1')
    // AC-1 should either be absent from met or have empty covering
    const covering: string[] = ac1?.covering ?? []
    expect(covering).not.toContain('S1')
  })
})

// ---------------------------------------------------------------------------
// R-AC2 — unretracted claim still counts (no over-correction, motive-compile)
// ---------------------------------------------------------------------------

describe('R-AC2: unretracted claim still counts (motive-compile)', () => {
  it('AC-2 coverage by S2 is preserved when only AC-1/S1 is retracted', () => {
    const events = [
      acCovEvent('AC-1', 'S1'),
      acCovEvent('AC-2', 'S2'),
      tcEvent('S1'),
      tcEvent('S2'),
      acRetractEvent('AC-1', 'S1', 'mistake'),
    ]
    const view = compile(events, {})
    const met: any[] = view.agent.ac_coverage.met
    const ac2 = met.find((a: any) => a.id === 'AC-2')
    expect(ac2).toBeDefined()
    expect(ac2.covering).toContain('S2')
  })

  it('retraction of S1 does not remove S2 coverage for AC-1 when S2 also covers it', () => {
    const events = [
      acCovEvent('AC-1', 'S1'),
      acCovEvent('AC-1', 'S2'),
      tcEvent('S1'),
      tcEvent('S2'),
      acRetractEvent('AC-1', 'S1', 'S1 did not actually implement AC-1'),
    ]
    const view = compile(events, {})
    const met: any[] = view.agent.ac_coverage.met
    const ac1 = met.find((a: any) => a.id === 'AC-1')
    expect(ac1).toBeDefined()
    expect(ac1.covering).toContain('S2')
    expect(ac1.covering).not.toContain('S1')
  })
})

// ---------------------------------------------------------------------------
// R-AC3 — order-independence: retraction before claim = same result
// ---------------------------------------------------------------------------

describe('R-AC3: order-independence (motive-compile)', () => {
  function compileResult(events: object[]) {
    const view = compile(events, {})
    const all: any[] = [...view.agent.ac_coverage.met, ...view.agent.ac_coverage.unmet]
    const ac1 = all.find((a: any) => a.id === 'AC-1')
    return ac1?.covering ?? []
  }

  it('retraction after claim: AC-1 not covered', () => {
    // chronological: coverage first, retraction second
    const events = [
      acCovEvent('AC-1', 'S1', TS1),
      tcEvent('S1', TS2),
      acRetractEvent('AC-1', 'S1', 'D-23', TS3),
    ]
    expect(compileResult(events)).not.toContain('S1')
  })

  it('retraction BEFORE claim (earlier ts): AC-1 still not covered', () => {
    // retraction ts < claim ts — should still be order-independent
    const events = [
      // retraction has earlier timestamp than the coverage event
      acRetractEvent('AC-1', 'S1', 'D-23', TS1),
      acCovEvent('AC-1', 'S1', TS2),
      tcEvent('S1', TS3),
    ]
    expect(compileResult(events)).not.toContain('S1')
  })
})

// ---------------------------------------------------------------------------
// R-AC4 — PARITY: all three folds honour AC_RETRACTION
// ---------------------------------------------------------------------------
//
// The parity test proves that a retraction honoured by any one fold but
// IGNORED by another causes the parity assertion to fail.
//
// Bite proof: see R-AC4-BITE below — three executable tests, one per fold.
// Each passes the SAME full event stream to all three folds and uses an
// output-injection wrapper to simulate that fold's retraction step being a
// no-op, then asserts assertThreeFoldParity() throws.  Run with:
//   npx vitest run test/hooks/ac-retraction.test.ts

describe('R-AC4: PARITY — both folds agree on retraction', () => {
  let dir: string

  beforeEach(() => {
    dir = tmp()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('compile and regenerateMotiveMap both show retracted AC-1 as not covered', () => {
    const events = [
      acCovEvent('AC-1', 'S1'),
      tcEvent('S1'),
      acRetractEvent('AC-1', 'S1', 'D-23 rejected this requirement'),
    ]
    writeCharter(dir, MOTIVE, ['AC-1'])
    // computeThreeFoldCoverage checks at (ac, slice) granularity across all three
    // folds — the map arm parses the "covered by:" clause into Map<acId, Set<sliceId>>
    // so a two-slice scenario where AC-1 remains met via S2 would not fool it
    // (the old AC-level `!mapMd.includes('✓ **AC-1**')` would).
    const results = computeThreeFoldCoverage('AC-1', 'S1', events, dir, MOTIVE)
    expect(results.compile).toBe(false)
    expect(results.graphFold).toBe(false)
    expect(results.map).toBe(false)
  })

  it('compile and regenerateMotiveMap both show unretracted AC-2 as still covered', () => {
    const events = [
      acCovEvent('AC-1', 'S1', TS1),
      acCovEvent('AC-2', 'S2', TS2),
      tcEvent('S1', TS3),
      tcEvent('S2', TS4),
      acRetractEvent('AC-1', 'S1', 'D-23 rejected this requirement'),
    ]
    writeCharter(dir, MOTIVE, ['AC-1', 'AC-2'])
    // The map arm checks specifically that S2 is listed in AC-2's "covered by:"
    // clause — the old AC-level `mapMd.includes('✓ **AC-2**')` would pass even
    // if the rendering listed the wrong slice (e.g. "covered by: S3").
    const results = computeThreeFoldCoverage('AC-2', 'S2', events, dir, MOTIVE)
    expect(results.compile).toBe(true)
    expect(results.graphFold).toBe(true)
    expect(results.map).toBe(true)
  })

  it('all THREE folds agree on the same event stream: retracted (AC-1, S1) is not covered', () => {
    // Single event stream fed to all three folds — no per-fold branching.
    const events = [
      acCovEvent('AC-1', 'S1'),
      tcEvent('S1'),
      acRetractEvent('AC-1', 'S1', 'D-23 rejected this requirement'),
    ]
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', events, dir, MOTIVE)
    expect(results.compile).toBe(false)
    expect(results.graphFold).toBe(false)
    expect(results.map).toBe(false)
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).not.toThrow()
  })

  it('two slices cover one AC: retracted slice (S1) is not covered even though AC remains met via S2', () => {
    // AC-1 is covered by both S1 and S2.  Only S1 is retracted.
    // (AC-1, S1) must be false in all three folds after retraction.
    // AC-1 remains "met" overall because S2 still covers it, so an AC-level map
    // arm would spuriously return true for (AC-1, S1) — the (ac, slice)-level arm
    // must return false to agree with compile and graph.
    const events = [
      acCovEvent('AC-1', 'S1', TS1),
      acCovEvent('AC-1', 'S2', TS2),
      tcEvent('S1', TS3),
      tcEvent('S2', TS4),
      acRetractEvent('AC-1', 'S1', 'S1 retracted; S2 still covers AC-1', '2026-01-01T00:04:00.000Z'),
    ]
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', events, dir, MOTIVE)
    expect(results.compile).toBe(false)
    expect(results.graphFold).toBe(false)
    expect(results.map).toBe(false)
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).not.toThrow()
  })

  it('positive control: unretracted (AC-1, S1) is covered in all three folds via real rendering', () => {
    // No AC_RETRACTION — the claim is intact.  All three folds must agree: true.
    // The map arm result comes from REAL regenerateMotiveMap output — no override,
    // no injected string, no hardcoded MAP.md content.  This test turns RED if
    // the "covered by:" wording at motive-map.mjs:988 drifts, catching vacuous-guard
    // scenarios where the regex silently stops matching.
    const events = [
      acCovEvent('AC-1', 'S1'),
      tcEvent('S1'),
    ]
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', events, dir, MOTIVE)
    expect(results.compile).toBe(true)
    expect(results.graphFold).toBe(true)
    expect(results.map).toBe(true)
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// R-AC4-BITE — executable bite proof: parity assertion fails per disabled fold
// ---------------------------------------------------------------------------
//
// Each test simulates ONE fold's retraction handler being a no-op while the
// other two folds run correctly — using output-injection wrappers, not input
// filtering.  All three folds receive the SAME full event stream (including the
// AC_RETRACTION event); the wrapper intercepts the fold's output and injects
// back the retracted coverage as if the handler had never fired.
//
// Why output-injection and not input filtering:
//   Input filtering (removing AC_RETRACTION from one fold's events) would not
//   catch a future production bug where the fold RECEIVES the event but
//   mis-handles it.  Output injection proves sensitivity to the fold's
//   retraction step — the fold sees the event, but the wrapper represents
//   what it would return if that step were a no-op.
//
// Three independent RED cases, one per fold:
//   broken compile  → compile returns coverage that still includes S1
//   broken graphFold → assembleGraphFold returns edges that still include the
//                      covers_ac edge for (AC-1, S1)
//   broken map      → MAP.md text still contains ✓ **AC-1** (re-injected after
//                      regeneration, simulating slicesMap.delete being a no-op)

describe('R-AC4-BITE: parity assertion bites when one fold ignores retraction', () => {
  let dir: string

  beforeEach(() => {
    dir = tmp()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // Single event stream used for ALL three folds in every bite test.
  const EVENTS = () => [
    acCovEvent('AC-1', 'S1'),
    tcEvent('S1'),
    acRetractEvent('AC-1', 'S1', 'D-23 rejected this requirement'),
  ]

  it('fails when compile fold ignores retraction (compile post-pass is a no-op)', () => {
    // Broken compile wrapper: receives full events, but injects S1 back into
    // AC-1's covering — simulating the AC_RETRACTION post-pass being a no-op.
    const brokenCompile = (evts: any[], opts: any) => {
      const result = compile(evts, opts)
      const allAcs = [...result.agent.ac_coverage.met, ...result.agent.ac_coverage.unmet]
      const ac1 = allAcs.find((a: any) => a.id === 'AC-1')
      if (ac1) ac1.covering = [...(ac1.covering ?? []), 'S1']
      return result
    }
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', EVENTS(), dir, MOTIVE, {
      compileFn: brokenCompile,
    })
    expect(results.compile).toBe(true)    // broken: S1 injected back
    expect(results.graphFold).toBe(false) // correct
    expect(results.map).toBe(false)       // correct
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).toThrow('Three-fold parity failure')
  })

  it('fails when graph-fold ignores retraction (edgeRetire in handleAcRetraction is a no-op)', () => {
    // Broken graph-fold wrapper: receives full events, but re-injects the
    // covers_ac edge — simulating edgeRetire(:366) being a no-op.
    const brokenGraphFold = (evts: any[]) => {
      const result = assembleGraphFold(evts)
      return {
        ...result,
        edges: [...result.edges, { kind: 'covers_ac', from: 'slice:S1', to: 'ac:AC-1' }],
      }
    }
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', EVENTS(), dir, MOTIVE, {
      graphFoldFn: brokenGraphFold,
    })
    expect(results.compile).toBe(false)  // correct
    expect(results.graphFold).toBe(true) // broken: retired edge injected back
    expect(results.map).toBe(false)      // correct
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).toThrow('Three-fold parity failure')
  })

  it('fails when map fold ignores retraction (slicesMap.delete at :676 is a no-op)', () => {
    // Broken map post-processor: the full shard (with AC_RETRACTION) is
    // written and regenerateMotiveMap runs correctly; we then re-inject
    // "✓ **AC-1**" into the MAP.md text — simulating the delete(:676) that
    // clears slicesMap never executing.
    const brokenMapPostProcess = (mapMd: string) =>
      mapMd + '\n- ✓ **AC-1** — met (covered by: S1)\n'
    writeCharter(dir, MOTIVE, ['AC-1'])
    const results = computeThreeFoldCoverage('AC-1', 'S1', EVENTS(), dir, MOTIVE, {
      mapPostProcess: brokenMapPostProcess,
    })
    expect(results.compile).toBe(false)   // correct
    expect(results.graphFold).toBe(false) // correct
    expect(results.map).toBe(true)        // broken: ✓ marker re-injected
    expect(() => assertThreeFoldParity(results, 'AC-1', 'S1')).toThrow('Three-fold parity failure')
  })
})

// ---------------------------------------------------------------------------
// R-AC6 — CLI records AC_RETRACTION event
// ---------------------------------------------------------------------------

describe('R-AC6: CLI ac-retract records AC_RETRACTION event', () => {
  let dir: string

  beforeEach(() => {
    dir = tmp()
    writeCharter(dir, MOTIVE, ['AC-1'])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('journal ac-retract writes an AC_RETRACTION event to the shard', () => {
    const env = makeJournalEnv(dir)
    const r = runJournal([
      'ac-retract',
      '--motive', MOTIVE,
      '--ac', 'AC-1',
      '--slice', 'S10',
      '--reason', 'D-23 rejected this requirement',
    ], env)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('AC_RETRACTION recorded')

    // Find the shard and verify event was written
    const journalDir = join(dir, '.groundwork', 'journal')
    const shards = readdirSync(journalDir).filter((f: string) => f.endsWith('.jsonl'))
    expect(shards.length).toBeGreaterThan(0)
    const shard = readFileSync(join(journalDir, shards[0]), 'utf8')
    const events = shard
      .split('\n')
      .filter((l: string) => l.trim())
      .map((l: string) => JSON.parse(l))
    const ev = events.find((e: any) => e.type === 'AC_RETRACTION')
    expect(ev).toBeDefined()
    expect(ev.data.ac).toBe('AC-1')
    expect(ev.data.slice).toBe('S10')
    expect(ev.data.reason).toBe('D-23 rejected this requirement')
  })

  it('journal ac-retract exits 2 without required flags', () => {
    const env = makeJournalEnv(dir)
    const r = runJournal(['ac-retract', '--motive', MOTIVE, '--ac', 'AC-1'], env)
    expect(r.status).toBe(2)
  })
})
