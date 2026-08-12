/**
 * Tests for hooks/lib/traceability-adapter.mjs — NativeSpineAdapter
 *
 * Covers:
 *   D-3 / AC-5 — Classification sourced from recorded verdicts in real .jsonl journal shards.
 *
 * Regression test for the .ndjson → .jsonl bug:
 *   _readJournalEvents() previously filtered for '.ndjson' while journal-io.mjs
 *   writes '.jsonl'. This made every link unclassifiable as proven/stale because
 *   no GATE or VERIFICATION events ever reached the classifier.
 *
 * @verifies TRACEABILITY-R-003
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NativeSpineAdapter, type GateEvent } from '../../hooks/lib/traceability-adapter.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJournalDir(base: string): string {
  const dir = path.join(base, '.groundwork', 'journal')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Write one event as a JSONL line to the given shard path.
 * Naming follows journal-io.mjs resolveShardPath: <date>-<sessionId>.jsonl
 */
function writeShard(journalDir: string, filename: string, events: object[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  writeFileSync(path.join(journalDir, filename), lines, 'utf8')
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'traceability-adapter-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// _readJournalEvents — real .jsonl seam
// ---------------------------------------------------------------------------

describe('NativeSpineAdapter._readJournalEvents — real .jsonl shard seam', () => {
  it('returns GATE events from a .jsonl shard (regression: was filtering .ndjson)', () => {
    // Arrange: write a real .jsonl shard with a GATE APPROVE event.
    // The shard name matches journal-io.mjs's resolveShardPath pattern:
    //   path.join(projectDir, '.groundwork', 'journal', `${d}-${safeId}.jsonl`)
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'advisor gate',
        data: { which: 'advisor', verdict: 'APPROVE', citation: null, rubric: null },
      },
    ])

    // Act: use the real NativeSpineAdapter (not a mock) to read the shard.
    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    // Assert: the GATE event must be present with the correct verdict.
    // FAILS before fix (adapter filtered '.ndjson', found nothing).
    // PASSES after fix (adapter filters '.jsonl', finds the shard).
    expect(gates).toHaveLength(1)
    expect(gates[0].verdict).toBe('APPROVE')
    expect(gates[0].which).toBe('advisor')
  })

  it('filters out events belonging to a different motive (motive-scoping)', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'other-motive',
        type: 'GATE',
        msg: 'gate for another motive',
        data: { which: 'advisor', verdict: 'APPROVE' },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    // Events for a different motive must be excluded.
    expect(gates).toHaveLength(0)
  })

  it('reads VERIFICATION events from a .jsonl shard', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-test-session.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'test-session',
        motive: 'test-motive',
        type: 'VERIFICATION',
        msg: 'live verify',
        data: {
          result: 'pass',
          link_id: 'S1',
          build_hash: 'abc123',
          notes: 'all checks green',
        },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const verifications = adapter.getVerificationEvents()

    expect(verifications).toHaveLength(1)
    expect(verifications[0].result).toBe('pass')
  })

  it('returns empty array when journal dir does not exist', () => {
    // No .groundwork/journal dir created — adapter must not throw.
    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    expect(adapter.getGateEvents()).toEqual([])
    expect(adapter.getVerificationEvents()).toEqual([])
  })

  it('reads events from multiple .jsonl shards in a single call', () => {
    const journalDir = makeJournalDir(tmpDir)
    writeShard(journalDir, '2026-01-01-session-a.jsonl', [
      {
        ts: '2026-01-01T00:00:00.000Z',
        session: 'session-a',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'gate a',
        data: { which: 'advisor', verdict: 'APPROVE' },
      },
    ])
    writeShard(journalDir, '2026-01-02-session-b.jsonl', [
      {
        ts: '2026-01-02T00:00:00.000Z',
        session: 'session-b',
        motive: 'test-motive',
        type: 'GATE',
        msg: 'gate b',
        data: { which: 'advisor', verdict: 'CORRECTION' },
      },
    ])

    const adapter = new NativeSpineAdapter({ projectDir: tmpDir, slug: 'test-motive' })
    const gates = adapter.getGateEvents()

    expect(gates).toHaveLength(2)
    const verdicts = gates.map((g: GateEvent) => g.verdict).sort()
    expect(verdicts).toEqual(['APPROVE', 'CORRECTION'])
  })
})
