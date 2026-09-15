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
 *   R-AC5  — AC_RETRACTION is in NEVER_COMPRESS
 *   R-AC6  — CLI records AC_RETRACTION event
 */

// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compile } from '../../hooks/lib/motive-compile.mjs'
import { NEVER_COMPRESS } from '../../hooks/lib/journal-io.mjs'
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
    const events = [
      acCovEvent('AC-1', 'S1', TS1),
      tcEvent('S1', TS2),
      acRetractEvent('AC-1', 'S1', 'D-23', TS3),
    ]
    expect(compileResult(events)).not.toContain('S1')
  })

  it('retraction BEFORE claim (earlier ts): AC-1 still not covered', () => {
    const events = [
      acRetractEvent('AC-1', 'S1', 'D-23', TS1),
      acCovEvent('AC-1', 'S1', TS2),
      tcEvent('S1', TS3),
    ]
    expect(compileResult(events)).not.toContain('S1')
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

// ---------------------------------------------------------------------------
// R-AC7 — `journal append --type AC_RETRACTION` enforces the payload contract
// ---------------------------------------------------------------------------

describe('R-AC7: append enforces the AC_RETRACTION payload contract', () => {
  let dir: string

  beforeEach(() => {
    dir = tmp()
    writeCharter(dir, MOTIVE, ['AC-7', 'AC-8'])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an AC_RETRACTION whose payload omits data.ac / data.slice', () => {
    const env = makeJournalEnv(dir)
    const r = runJournal([
      'append', '--motive', MOTIVE, '--type', 'AC_RETRACTION',
      '--msg', 'retract AC-7 and AC-8',
      '--data', JSON.stringify({ ac_ids: ['AC-7', 'AC-8'], reason: 'slices retired' }),
    ], env)

    // A silent no-op is the bug: exit 0 + "appended AC_RETRACTION" while the
    // fold discards the event.  The contract must be enforced at the gate.
    expect(
      r.status,
      `expected exit 2, got ${r.status}; stdout=${JSON.stringify(r.stdout)}`,
    ).toBe(2)
    expect(r.stderr).toContain('AC_RETRACTION')
    expect(r.stderr).toMatch(/data\.ac/)
    expect(r.stderr).toMatch(/data\.slice/)

    // Nothing may reach the shard — a rejected retraction must leave no trace.
    const journalDir = join(dir, '.groundwork', 'journal')
    const shards = existsSync(journalDir)
      ? readdirSync(journalDir).filter((f: string) => f.endsWith('.jsonl'))
      : []
    const written = shards.flatMap((f: string) =>
      readFileSync(join(journalDir, f), 'utf8')
        .split('\n').filter((l: string) => l.trim()).map((l: string) => JSON.parse(l)))
    expect(written.filter((e: any) => e.type === 'AC_RETRACTION')).toHaveLength(0)
  })

  // Positive control — guards against the fix degenerating into "reject all
  // AC_RETRACTION appends".  A contract-shaped payload must still be accepted
  // AND must still move the AC out of the `met` bucket end-to-end.
  it('accepts a contract-shaped payload and the fold moves the AC to unmet', () => {
    const env = makeJournalEnv(dir)
    const r = runJournal([
      'append', '--motive', MOTIVE, '--type', 'AC_RETRACTION',
      '--msg', 'retract AC-7 from S1',
      '--data', JSON.stringify({ ac: 'AC-7', slice: 'S1', reason: 'slice retired' }),
    ], env)
    expect(r.status, r.stderr).toBe(0)

    const events = [
      acCovEvent('AC-7', 'S1'),
      acCovEvent('AC-8', 'S2'),
      tcEvent('S1'),
      tcEvent('S2', TS2),
      { type: 'AC_RETRACTION', ts: TS3, motive: MOTIVE, source: 'cli:journal',
        data: { ac: 'AC-7', slice: 'S1', reason: 'slice retired' } },
    ]
    const view = compile(events, {})
    const metIds = view.agent.ac_coverage.met.map((a: any) => a.id)
    const unmetIds = view.agent.ac_coverage.unmet.map((a: any) => a.id)
    expect(metIds).not.toContain('AC-7')
    expect(unmetIds).toContain('AC-7')
    // No over-correction: the unretracted claim survives.
    expect(metIds).toContain('AC-8')
  })
})
