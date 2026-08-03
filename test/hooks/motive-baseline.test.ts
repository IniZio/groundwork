/**
 * S4 — Baseline resolver tests.
 *
 * AC coverage:
 *  S4-AC1 — Known name resolves to (ord, ts, data.shard)
 *  S4-AC2 — Duplicate names: latest (highest ord) wins
 *  S4-AC3 — Unknown name, empty stream, no data.name → null (never throws)
 *  S4-AC4 — compile(events, {at: resolveBaseline(…).ord}) folds up to and
 *            including the baseline event
 *  S4-AC5 — Zero imports in motive-baseline.mjs (purity guard)
 *  S4-AC6 — End-to-end write→read round-trip via library writer (appendEvent +
 *            readOrderedEvents); CLI path (journal baseline) is owned by S1
 *            and is not yet available, so we use appendEvent directly.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ordered event stream with ord pre-assigned (as readOrderedEvents does). */
function makeEvents(overrides: object[] = []): object[] {
  return overrides.map((e, i) => ({ ord: i + 1, ...e }))
}

// ---------------------------------------------------------------------------
// S4-AC1 — Known name resolves
// ---------------------------------------------------------------------------

describe('S4-AC1 — resolveBaseline: known name', () => {
  it('returns the pin {name, ord, ts, shard} for a matching BASELINE event', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const ts = '2026-08-01T10:00:00.000Z'
    const events = makeEvents([
      { type: 'DECISION', motive: 'demo', ts: '2026-08-01T09:00:00.000Z', data: { title: 'd1' } },
      { type: 'BASELINE', motive: 'demo', ts, data: { name: 'beta', shard: 'shard-abc.jsonl' } },
    ])

    const pin = resolveBaseline(events, 'beta')
    expect(pin).not.toBeNull()
    expect(pin?.name).toBe('beta')
    expect(pin?.ord).toBe(2)
    expect(pin?.ts).toBe(ts)
    expect(pin?.shard).toBe('shard-abc.jsonl')
  })
})

// ---------------------------------------------------------------------------
// S4-AC2 — Duplicate names: latest (highest ord) wins
// ---------------------------------------------------------------------------

describe('S4-AC2 — resolveBaseline: duplicate names', () => {
  it('returns the highest-ord BASELINE when the same name appears twice', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const ts1 = '2026-08-01T10:00:00.000Z'
    const ts2 = '2026-08-01T11:00:00.000Z'
    const events = makeEvents([
      { type: 'BASELINE', motive: 'demo', ts: ts1, data: { name: 'v1', shard: 'shard-1.jsonl' } },
      { type: 'DECISION', motive: 'demo', ts: ts1, data: { title: 'd' } },
      { type: 'BASELINE', motive: 'demo', ts: ts2, data: { name: 'v1', shard: 'shard-2.jsonl' } },
    ])

    const pin = resolveBaseline(events, 'v1')
    expect(pin?.ord).toBe(3)
    expect(pin?.shard).toBe('shard-2.jsonl')
    expect(pin?.ts).toBe(ts2)
  })
})

// ---------------------------------------------------------------------------
// S4-AC3 — Unknown name / empty stream / missing data.name → null
// ---------------------------------------------------------------------------

describe('S4-AC3 — resolveBaseline: null cases', () => {
  it('returns null for empty stream', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    expect(resolveBaseline([], 'anything')).toBeNull()
  })

  it('returns null when no BASELINE event matches the name', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const events = makeEvents([
      { type: 'BASELINE', motive: 'demo', ts: '2026-08-01T10:00:00.000Z', data: { name: 'other', shard: 's.jsonl' } },
    ])
    expect(resolveBaseline(events, 'unknown-name')).toBeNull()
  })

  it('returns null when BASELINE event has no data.name', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const events = makeEvents([
      { type: 'BASELINE', motive: 'demo', ts: '2026-08-01T10:00:00.000Z', data: { shard: 's.jsonl' } },
    ])
    expect(resolveBaseline(events, 'any')).toBeNull()
  })

  it('never throws for null/undefined inputs', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    expect(() => (resolveBaseline as (e: unknown, n: string) => unknown)(null, 'x')).not.toThrow()
    expect((resolveBaseline as (e: unknown, n: string) => unknown)(null, 'x')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// S4-AC4 — compile(events, {at: pin.ord}) folds up to and including the baseline
// ---------------------------------------------------------------------------

describe('S4-AC4 — compile with at=resolveBaseline().ord', () => {
  it('folds exactly the events up to and including the baseline', async () => {
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')
    const { compile } = await import('../../hooks/lib/motive-compile.mjs')

    const now = new Date().toISOString()
    const events = makeEvents([
      { type: 'DECISION', motive: 'demo', ts: now, data: { title: 'dec1', status: 'ACCEPTED', rationale: 'r' } },
      { type: 'BASELINE', motive: 'demo', ts: now, data: { name: 'snap1', shard: 's.jsonl' } },
      { type: 'DECISION', motive: 'demo', ts: now, data: { title: 'dec2', status: 'ACCEPTED', rationale: 'r' } },
    ])

    const pin = resolveBaseline(events, 'snap1')
    expect(pin).not.toBeNull()
    expect(pin?.ord).toBe(2)

    const view = compile(events, { at: pin!.ord })
    // provenance.at_ord should equal the baseline's ordinal
    expect(view.provenance.at_ord).toBe(2)
    // Only 2 events folded (up to and including ord=2); the third is excluded
    expect(view.provenance.events_folded).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// S4-AC5 — Zero imports in motive-baseline.mjs (purity guard)
// ---------------------------------------------------------------------------

describe('S4-AC5 — purity guard: zero imports in motive-baseline.mjs', () => {
  it('has no import or require statements', () => {
    const source = readFileSync(
      new URL('../../hooks/lib/motive-baseline.mjs', import.meta.url),
    ).toString()
    const lines = source.split('\n').filter((l) => {
      const trimmed = l.trimStart()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false
      return /^import\s/.test(trimmed) || /\brequire\s*\(/.test(trimmed)
    })
    expect(lines).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S4-AC6 — End-to-end write→read round-trip (library writer path)
//
// journal baseline CLI is owned by S1 and not yet available.
// We use appendEvent (journal-io.mjs) + resolveShardPath to write, then
// readOrderedEvents (journal-order.mjs) to read, proving the pin round-trips.
// ---------------------------------------------------------------------------

describe('S4-AC6 — write→read end-to-end via library writer', () => {
  it('resolves a BASELINE written via appendEvent', async () => {
    const { appendEvent, resolveShardPath } = await import('../../hooks/lib/journal-io.mjs')
    const { readOrderedEvents } = await import('../../hooks/lib/journal-order.mjs')
    const { resolveBaseline } = await import('../../hooks/lib/motive-baseline.mjs')

    const projectDir = mkdtempSync(path.join(os.tmpdir(), 'motive-baseline-test-'))
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    try {
      const motive = 'test-motive'
      const sessionId = 'ses-e2e-1'
      const shardPath = resolveShardPath(projectDir, sessionId)
      const shardBasename = path.basename(shardPath)

      const ts = new Date().toISOString()

      // Write a non-BASELINE event first (ord=1 after filter)
      appendEvent(shardPath, {
        ts,
        session: sessionId,
        motive,
        type: 'DECISION',
        msg: 'initial decision',
        source: 'test',
        data: { title: 'D1', status: 'ACCEPTED', rationale: 'reason' },
      })

      // Write the BASELINE event (ord=2 after filter), recording its shard basename
      const baselineTs = new Date().toISOString()
      appendEvent(shardPath, {
        ts: baselineTs,
        session: sessionId,
        motive,
        type: 'BASELINE',
        msg: 'baseline snap',
        source: 'test',
        data: { name: 'release-1', shard: shardBasename },
      })

      // Write a later event (should not appear in the pin)
      appendEvent(shardPath, {
        ts: new Date().toISOString(),
        session: sessionId,
        motive,
        type: 'DECISION',
        msg: 'later decision',
        source: 'test',
        data: { title: 'D2', status: 'ACCEPTED', rationale: 'later' },
      })

      const { events } = readOrderedEvents(journalDir, { motive })
      expect(events.length).toBeGreaterThanOrEqual(2)

      const pin = resolveBaseline(events, 'release-1')
      expect(pin).not.toBeNull()
      expect(pin?.name).toBe('release-1')
      expect(pin?.ts).toBe(baselineTs)
      expect(pin?.shard).toBe(shardBasename)
      expect(typeof pin?.ord).toBe('number')
      expect(pin!.ord).toBeGreaterThan(0)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
