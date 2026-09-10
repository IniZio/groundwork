/**
 * Regression: _dedupeDecisions — retiring decision must not exclude itself via token-overlap.
 *
 * Invariant (hooks/lib/motive-map.mjs line ~372):
 *   The `id == null` guard on the token-overlap branch ensures a structured
 *   (id-bearing) decision D that carries `data.retires` is never excluded by its
 *   own retires ref — even when D's msg overlaps the ref enough to trip the matcher.
 *
 * Corpus:
 *   D-99 (id-bearing, retires "legacy schema migration approach"):
 *     msg contains all 4 sig-tokens of the retires ref → matchCount=4 ≥ required=3.
 *     Without `id == null`, D-99 would self-exclude (BUG).
 *   E (id-less): msg matches the same ref → correctly suppressed.
 *   D-100 (sentinel): unrelated id-bearing decision; proves decisions section is populated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

function tmp() {
  return mkdtempSync(join(tmpdir(), 'motive-map-self-excl-test-'))
}

function makeCharter(dir: string, motive: string) {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), '## Objective\nTest objective.\n', 'utf8')
}

function writeDecisionEvents(dir: string, motive: string, events: object[]) {
  const journalDir = join(dir, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(journalDir, '2026-01-01-self-excl.jsonl'), lines + '\n', 'utf8')
}

function writeLedger(dir: string, motive: string) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, 'run-self-excl.json'), JSON.stringify({ motive, active: true, slices: [] }), 'utf8')
}

function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

const MOTIVE = 'self-excl-motive'

const DECISION_D99 = {
  type: 'DECISION', motive: MOTIVE, ts: '2026-01-02T00:00:00Z',
  msg: 'D-99: Adopt new migration approach for legacy schema.',
  data: {
    id: 'D-99',
    decision: 'Adopt new migration approach for legacy schema.',
    retires: 'legacy schema migration approach',
    status: 'accepted',
  },
}

const DECISION_E_IDLESS = {
  type: 'DECISION', motive: MOTIVE, ts: '2026-01-01T00:00:00Z',
  msg: 'Legacy schema migration approach must be superseded.',
  data: { decision: 'Legacy schema migration approach must be superseded.', status: 'accepted' },
}

const DECISION_D100_SENTINEL = {
  type: 'DECISION', motive: MOTIVE, ts: '2026-01-03T00:00:00Z',
  msg: 'D-100: Unrelated sentinel decision for positive control.',
  data: { id: 'D-100', decision: 'Unrelated sentinel decision for positive control.', status: 'accepted' },
}

describe('_dedupeDecisions — retiring decision must not exclude itself', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('keeps D-99 (retiring, id-bearing) in MAP even when its msg overlaps its own retires ref', () => {
    makeCharter(dir, MOTIVE)
    writeDecisionEvents(dir, MOTIVE, [DECISION_E_IDLESS, DECISION_D99, DECISION_D100_SENTINEL])
    writeLedger(dir, MOTIVE)

    regenerateMotiveMap(dir, MOTIVE)
    const map = readMap(dir, MOTIVE)

    expect(map).toContain('D-100: Unrelated sentinel decision')
    expect(map).not.toContain('Legacy schema migration approach must be superseded')
    expect(map).toContain('D-99: Adopt new migration approach')
  })
})
