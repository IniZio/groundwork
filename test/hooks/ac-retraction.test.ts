/**
 * AC_RETRACTION — append-only coverage retraction tests
 *
 * V11: a mistaken AC_COVERAGE claim (e.g. S9→AC-11, S10→AC-10) can be corrected
 * by appending an AC_RETRACTION event.  The journal is never mutated; both folds
 * (motive-compile and motive-map) honour the retraction in an order-independent
 * post-loop pass.
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
// R-AC4 — PARITY: both folds honour AC_RETRACTION
// ---------------------------------------------------------------------------
//
// The parity test proves that a retraction honoured by motive-compile but
// IGNORED by motive-map (or vice versa) causes this test to fail.
//
// Bite proof is in the report: see the RED run (motive-map retraction loop
// removed) and the GREEN run after revert.

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

    // ── motive-compile fold ──────────────────────────────────────────────────
    const view = compile(events.filter((e: any) => e.motive === MOTIVE), {})
    const all: any[] = [...view.agent.ac_coverage.met, ...view.agent.ac_coverage.unmet]
    const compileEntry = all.find((a: any) => a.id === 'AC-1')
    const compileCovering: string[] = compileEntry?.covering ?? []
    const compileRetracted = !compileCovering.includes('S1')

    // ── motive-map fold (via regenerateMotiveMap) ────────────────────────────
    writeCharter(dir, MOTIVE, ['AC-1'])
    writeJournalShard(dir, events)
    regenerateMotiveMap(dir, MOTIVE)
    const mapMd = readMap(dir, MOTIVE)
    // AC-1 should NOT render as "met (covered by: S1)"
    const mapRetracted = !mapMd.includes('✓ **AC-1**')

    // PARITY ASSERTION: both folds must agree
    expect(compileRetracted).toBe(true)
    expect(mapRetracted).toBe(true)
  })

  it('compile and regenerateMotiveMap both show unretracted AC-2 as still covered', () => {
    const events = [
      acCovEvent('AC-1', 'S1', TS1),
      acCovEvent('AC-2', 'S2', TS2),
      tcEvent('S1', TS3),
      tcEvent('S2', TS4),
      acRetractEvent('AC-1', 'S1', 'D-23 rejected this requirement'),
    ]

    // ── motive-compile fold ──────────────────────────────────────────────────
    const view = compile(events.filter((e: any) => e.motive === MOTIVE), {})
    const met: any[] = view.agent.ac_coverage.met
    const compileAc2 = met.find((a: any) => a.id === 'AC-2')
    const compileAc2Covered = compileAc2?.covering?.includes('S2') ?? false

    // ── motive-map fold ──────────────────────────────────────────────────────
    writeCharter(dir, MOTIVE, ['AC-1', 'AC-2'])
    writeJournalShard(dir, events)
    regenerateMotiveMap(dir, MOTIVE)
    const mapMd = readMap(dir, MOTIVE)
    const mapAc2Covered = mapMd.includes('✓ **AC-2**')

    // PARITY ASSERTION: both folds preserve unretracted coverage
    expect(compileAc2Covered).toBe(true)
    expect(mapAc2Covered).toBe(true)
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
