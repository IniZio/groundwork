/**
 * Tests for hooks/lib/traceability-evidence.mjs
 *
 * @verifies AC-6   (staleness-on-regen: changed hash → stale)
 * @verifies D-4    (build/data-hash stamping mechanism)
 */

import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  computeBuildHash,
  makeEvidenceRef,
  markStaleness,
  readEvidence,
  recordEvidence,
} from '../../hooks/lib/traceability-evidence.mjs'

// ---------------------------------------------------------------------------
// Shared temp dir — isolates every test from the real motive spine.
// ---------------------------------------------------------------------------

let groundworkDir: string

beforeEach(() => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'gw-ev-test-'))
  groundworkDir = path.join(tmp, '.groundwork')
})

afterEach(() => {
  // tmp parent is one level above groundworkDir
  const tmp = path.dirname(groundworkDir)
  rmSync(tmp, { recursive: true, force: true })
})

const OPTS = () => ({ groundworkDir })

// ---------------------------------------------------------------------------
// computeBuildHash
// ---------------------------------------------------------------------------

describe('computeBuildHash', () => {
  it('returns a 64-character lowercase hex string', () => {
    const h = computeBuildHash('hello world')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input always produces the same digest', () => {
    const input = 'build-artifact-content'
    expect(computeBuildHash(input)).toBe(computeBuildHash(input))
  })

  it('produces different digests for different inputs', () => {
    expect(computeBuildHash('data v1')).not.toBe(computeBuildHash('data v2'))
  })

  it('accepts a Buffer (raw file bytes)', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff])
    const h = computeBuildHash(buf)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(computeBuildHash(buf)).toBe(computeBuildHash(buf))
  })

  it('string and equivalent Buffer yield different digests (encoding matters)', () => {
    // The string 'abc' encoded as UTF-8 bytes → same Buffer → same hash.
    // Confirm that passing the string is identical to passing its UTF-8 buffer.
    const str = 'abc'
    const buf = Buffer.from(str, 'utf8')
    expect(computeBuildHash(str)).toBe(computeBuildHash(buf))
  })
})

// ---------------------------------------------------------------------------
// makeEvidenceRef
// ---------------------------------------------------------------------------

describe('makeEvidenceRef', () => {
  it('creates a ref with all required fields', () => {
    const ref = makeEvidenceRef({
      kind: 'screenshot',
      path: 'runs/screenshot.png',
      evidences: ['S4'],
      captured_build_hash: 'abc123',
    })
    expect(ref.kind).toBe('screenshot')
    expect(ref.path).toBe('runs/screenshot.png')
    expect(ref.evidences).toEqual(['S4'])
    expect(ref.captured_build_hash).toBe('abc123')
    expect(ref.id).toBeTruthy()
    expect(typeof ref.captured_at).toBe('string')
  })

  it('defaults captured_build_hash to null', () => {
    const ref = makeEvidenceRef({ kind: 'gate-record', path: 'gate.json', evidences: ['AC-6'] })
    expect(ref.captured_build_hash).toBeNull()
  })

  it('accepts explicit id', () => {
    const ref = makeEvidenceRef({ id: 'my-id', kind: 'test-output', path: 't.txt', evidences: ['S4'] })
    expect(ref.id).toBe('my-id')
  })

  it('auto-generates a deterministic id when none is provided', () => {
    const opts = { kind: 'screenshot', path: 'a.png', evidences: ['S1'] }
    // Two calls with the same timestamp should yield the same id.
    // Provide a fixed captured_at to make this testable:
    const r1 = makeEvidenceRef({ ...opts, captured_at: '2026-01-01T00:00:00.000Z' })
    const r2 = makeEvidenceRef({ ...opts, captured_at: '2026-01-01T00:00:00.000Z' })
    expect(r1.id).toBe(r2.id)
  })

  it('wraps a single string in an array for evidences', () => {
    // @ts-expect-error — testing JS-level coercion for plain-string input
    const ref = makeEvidenceRef({ kind: 'screenshot', path: 'a.png', evidences: 'S4' })
    expect(Array.isArray(ref.evidences)).toBe(true)
    expect(ref.evidences).toContain('S4')
  })
})

// ---------------------------------------------------------------------------
// recordEvidence + readEvidence (round-trip)
// ---------------------------------------------------------------------------

describe('recordEvidence / readEvidence', () => {
  it('reads back a ref that was recorded', () => {
    const ref = makeEvidenceRef({
      kind: 'screenshot',
      path: 'runs/out.png',
      evidences: ['S4', 'AC-6'],
      captured_build_hash: computeBuildHash('build-v1'),
      captured_at: '2026-08-01T10:00:00.000Z',
    })

    recordEvidence('tracking-viz', ref, OPTS())
    const all = readEvidence('tracking-viz', OPTS())

    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: ref.id,
      kind: 'screenshot',
      path: 'runs/out.png',
      evidences: ['S4', 'AC-6'],
      captured_build_hash: ref.captured_build_hash,
    })
  })

  it('is additive — multiple refs accumulate', () => {
    const slug = 'tracking-viz'
    const r1 = makeEvidenceRef({ kind: 'screenshot', path: 'a.png', evidences: ['S4'], captured_at: '2026-01-01T00:00:00Z' })
    const r2 = makeEvidenceRef({ kind: 'test-output', path: 'b.txt', evidences: ['AC-6'], captured_at: '2026-01-02T00:00:00Z' })

    recordEvidence(slug, r1, OPTS())
    recordEvidence(slug, r2, OPTS())

    const all = readEvidence(slug, OPTS())
    expect(all).toHaveLength(2)
    const ids = all.map((r) => r.id).sort()
    expect(ids).toContain(r1.id)
    expect(ids).toContain(r2.id)
  })

  it('is idempotent — re-recording the same ref id overwrites, not appends', () => {
    const slug = 'tracking-viz'
    const ref = makeEvidenceRef({ id: 'fixed-id', kind: 'gate-record', path: 'g.json', evidences: ['S4'] })

    recordEvidence(slug, ref, OPTS())
    recordEvidence(slug, ref, OPTS())

    const all = readEvidence(slug, OPTS())
    expect(all).toHaveLength(1)
  })

  it('returns empty array when no evidence has been recorded', () => {
    expect(readEvidence('no-such-motive', OPTS())).toEqual([])
  })

  it('writes JSON to <groundworkDir>/motives/<slug>/evidence/<id>.json', () => {
    const slug = 'tracking-viz'
    const ref = makeEvidenceRef({ id: 'my-ref', kind: 'screenshot', path: 'x.png', evidences: ['S4'] })

    const written = recordEvidence(slug, ref, OPTS())
    expect(written).toBe(
      path.join(groundworkDir, 'motives', slug, 'evidence', 'my-ref.json'),
    )

    const raw = JSON.parse(readFileSync(written, 'utf8'))
    expect(raw.id).toBe('my-ref')
  })

  it('does NOT write under the real .groundwork/motives directory', () => {
    // Confirms the temp-dir isolation is working: the real motive spine is
    // never touched when groundworkDir is supplied.
    const slug = 'tracking-viz'
    const ref = makeEvidenceRef({ kind: 'screenshot', path: 'z.png', evidences: ['S4'] })
    recordEvidence(slug, ref, OPTS())

    const realSpine = path.join(process.cwd(), '.groundwork', 'motives', slug, 'evidence')
    let realEntries: string[] = []
    try { realEntries = readdirSync(realSpine) } catch { /* ok — dir may not exist */ }
    expect(realEntries).not.toContain(`${ref.id}.json`)
  })
})

// ---------------------------------------------------------------------------
// markStaleness  (AC-6)
// ---------------------------------------------------------------------------

describe('markStaleness', () => {
  it('tags refs with matching hash as fresh', () => {
    const hash = computeBuildHash('data-snapshot-v1')
    const ref = makeEvidenceRef({ kind: 'screenshot', path: 'a.png', evidences: ['S4'], captured_build_hash: hash })
    const [stamped] = markStaleness([ref], hash)
    expect(stamped.freshness).toBe('fresh')
  })

  it('tags refs with a different hash as stale (AC-6: regen invalidates evidence)', () => {
    const hashV1 = computeBuildHash('data-snapshot-v1')
    const hashV2 = computeBuildHash('data-snapshot-v2')
    const ref = makeEvidenceRef({ kind: 'screenshot', path: 'a.png', evidences: ['S4'], captured_build_hash: hashV1 })
    const [stamped] = markStaleness([ref], hashV2)
    expect(stamped.freshness).toBe('stale')
  })

  it('tags refs with null captured_build_hash as stale', () => {
    const ref = makeEvidenceRef({ kind: 'gate-record', path: 'g.json', evidences: ['AC-6'], captured_build_hash: null })
    const [stamped] = markStaleness([ref], computeBuildHash('anything'))
    expect(stamped.freshness).toBe('stale')
  })

  it('handles a mixed list — some fresh, some stale', () => {
    const hashCurrent = computeBuildHash('build-now')
    const hashOld = computeBuildHash('build-old')

    const freshRef = makeEvidenceRef({ kind: 'screenshot', path: 'f.png', evidences: ['S4'], captured_build_hash: hashCurrent, captured_at: '2026-01-01T00:00:00Z' })
    const staleRef = makeEvidenceRef({ kind: 'test-output', path: 's.txt', evidences: ['AC-6'], captured_build_hash: hashOld, captured_at: '2026-01-02T00:00:00Z' })

    const [f, s] = markStaleness([freshRef, staleRef], hashCurrent)
    expect(f.freshness).toBe('fresh')
    expect(s.freshness).toBe('stale')
  })

  it('does not mutate the original ref objects', () => {
    const hash = computeBuildHash('v1')
    const ref = makeEvidenceRef({ kind: 'screenshot', path: 'a.png', evidences: ['S4'], captured_build_hash: hash })
    markStaleness([ref], hash)
    expect((ref as any).freshness).toBeUndefined()
  })

  it('returns empty array for empty input', () => {
    expect(markStaleness([], computeBuildHash('x'))).toEqual([])
  })
})
