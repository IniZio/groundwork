import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeDecision, fromLegacyDecision } from '../../../../src/gw/store/motive/decision.js'

describe('writeDecision — extras collision guard (S31-EXTRAS-COLLISION, AC-4)', () => {
  it('throws when an extras key diverges from a canonically-written frontmatter field', async () => {
    // data.date="2020-01-01" goes into extras (not in CANONICAL_DATA_KEYS),
    // but writeDecision derives fm.date from data.date which fromLegacyDecision
    // sets from event.ts — the two values diverge, so the write must throw.
    const event = {
      ts: '2025-06-15T00:00:00Z',
      motive: 'test-motive',
      data: {
        id: 'D-99',
        decision: 'Some decision',
        rationale: 'Some rationale',
        alternatives: [] as string[],
        date: '2020-01-01',
      },
    }
    const noteData = fromLegacyDecision(event)
    expect(noteData.date).toBe('2025-06-15')
    expect(noteData.extras?.date).toBe('2020-01-01')

    const tmp = mkdtempSync(path.join(tmpdir(), 'gw-collision-test-'))
    try {
      await expect(
        writeDecision({ repoRoot: tmp, tracker: '.groundwork', motive: 'test-motive', data: noteData })
      ).rejects.toThrow(/extras key "date" collides/)
    } finally {
      rmSync(tmp, { recursive: true })
    }
  })

  it('does NOT throw when an extras key matches the canonical value (idempotent)', async () => {
    // data.date matches the date derived from ts — idempotent, no data loss.
    const event = {
      ts: '2025-06-15T00:00:00Z',
      motive: 'test-motive',
      data: {
        id: 'D-100',
        decision: 'Idempotent decision',
        rationale: 'Same date',
        alternatives: [] as string[],
        date: '2025-06-15',
      },
    }
    const noteData = fromLegacyDecision(event)
    expect(noteData.extras?.date).toBe('2025-06-15')

    const tmp = mkdtempSync(path.join(tmpdir(), 'gw-collision-test-'))
    try {
      await expect(
        writeDecision({ repoRoot: tmp, tracker: '.groundwork', motive: 'test-motive', data: noteData })
      ).resolves.toBeUndefined()
    } finally {
      rmSync(tmp, { recursive: true })
    }
  })

  it('non-canonical extras key with no collision writes through normally', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'gw-collision-test-'))
    try {
      await expect(
        writeDecision({
          repoRoot: tmp,
          tracker: '.groundwork',
          motive: 'test-motive',
          data: {
            id: 'D-101',
            decision: 'Decision',
            rationale: 'Rationale',
            alternatives: [],
            extras: { resolves: 'TBD-42', blast: 'low' },
          },
        })
      ).resolves.toBeUndefined()
    } finally {
      rmSync(tmp, { recursive: true })
    }
  })
})
