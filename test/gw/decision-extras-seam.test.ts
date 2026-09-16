/**
 * S40-COLLISION-SEAM — proves the single checkDecisionExtrasCollision implementation
 * is shared by both writeDecision (throws) and the dry-run migrate path (returns string).
 *
 * C1: checkDecisionExtrasCollision is exported from decision.ts (import succeeds)
 * C2: writeDecision throws with the identical string checkDecisionExtrasCollision returns
 * C3: all canonical fm fields covered — status, kind, date, rationale, alternatives,
 *     supersedes, related, motive (and id via buildDecisionFm internals)
 * C4: idempotent case (same value) never triggers a collision
 * C5: non-canonical extras key passes without collision
 * C6: dry-run migrate writes no decision file and reports the collision
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDecisionExtrasCollision, fromLegacyDecision, writeDecision } from '#src/gw/store/motive/decision.js'
import { migrate } from '#src/gw/migrate/index.js'

const BASE = {
  id: 'D-seam',
  decision: 'Use one implementation.',
  rationale: 'Reduces drift.',
  alternatives: ['Keep two copies'],
  status: 'accepted' as const,
  kind: 'impl',
  date: '2026-09-16',
  motive: 'test-seam',
}

describe('S40-COLLISION-SEAM: checkDecisionExtrasCollision unit (C1–C5)', () => {
  it('C5: non-canonical extras key → undefined', () => {
    expect(checkDecisionExtrasCollision({ ...BASE, extras: { rfc: '42' } })).toBeUndefined()
  })

  it('C4: extras.date matches canonical → undefined (idempotent)', () => {
    expect(checkDecisionExtrasCollision({ ...BASE, extras: { date: '2026-09-16' } })).toBeUndefined()
  })

  it('no extras → undefined', () => {
    expect(checkDecisionExtrasCollision({ ...BASE })).toBeUndefined()
  })

  it('C3: extras.date diverges → collision on "date"', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { date: '1970-01-01' } })
    expect(msg).toMatch(/extras key "date"/)
    expect(msg).toMatch(/collides/)
  })

  it('C3: extras.rationale diverges → collision on "rationale"', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { rationale: 'wrong' } })
    expect(msg).toMatch(/extras key "rationale"/)
  })

  it('C3: extras.status diverges → collision on "status"', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { status: 'proposed' } })
    expect(msg).toMatch(/extras key "status"/)
  })

  it('C3: extras.kind diverges → collision on "kind"', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { kind: 'wrong' } })
    expect(msg).toMatch(/extras key "kind"/)
  })

  it('C3: extras.alternatives diverges → collision on "alternatives"', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { alternatives: ['other'] } })
    expect(msg).toMatch(/extras key "alternatives"/)
  })

  it('C3: extras.supersedes diverges when canonical field is set', () => {
    const data = { ...BASE, supersedes: 'D-old', extras: { supersedes: 'D-other' } }
    const msg = checkDecisionExtrasCollision(data)
    expect(msg).toMatch(/extras key "supersedes"/)
  })

  it('C3: extras.related diverges when canonical field is set', () => {
    const data = { ...BASE, related: ['D-1'], extras: { related: ['D-2'] } }
    const msg = checkDecisionExtrasCollision(data)
    expect(msg).toMatch(/extras key "related"/)
  })

  it('C3: extras.motive diverges (plain vs wikilink-resolved canonical)', () => {
    const msg = checkDecisionExtrasCollision({ ...BASE, extras: { motive: 'test-seam' } })
    expect(msg).toMatch(/extras key "motive"/)
  })
})

describe('S40-COLLISION-SEAM: writeDecision uses same check (C2)', () => {
  it('writeDecision throws with identical string checkDecisionExtrasCollision returns', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gw-seam-write-'))
    mkdirSync(join(tmpDir, '.groundwork', 'motives', 'test-seam', 'decisions'), { recursive: true })
    const data = { ...BASE, extras: { date: '1970-01-01' } }
    const expected = checkDecisionExtrasCollision(data)
    expect(expected).toBeDefined()
    let thrown: string | undefined
    try {
      await writeDecision({ repoRoot: tmpDir, tracker: '.groundwork', motive: 'test-seam', data })
    } catch (err) {
      thrown = (err as Error).message
    }
    rmSync(tmpDir, { recursive: true, force: true })
    expect(thrown).toBe(expected)
  })
})

describe('S40-COLLISION-SEAM: dry-run migrate uses same check, writes no file (C6)', () => {
  const NEXT = '.groundwork/next'
  let dryDir: string

  beforeAll(() => {
    dryDir = mkdtempSync(join(tmpdir(), 'gw-seam-dry-'))
    const moDir = join(dryDir, '.groundwork', 'motives', 'seam-dry')
    const journalDir = join(dryDir, '.groundwork', 'journal')
    mkdirSync(moDir, { recursive: true })
    mkdirSync(journalDir, { recursive: true })
    const ev = JSON.stringify({
      type: 'DECISION',
      ts: '2026-09-16T10:00:00Z',
      motive: 'seam-dry',
      data: { id: 'D-seam-dry', decision: 'x', rationale: 'y', alternatives: [], status: 'proposed', date: '1970-01-01' },
    })
    writeFileSync(join(journalDir, 'seam.jsonl'), ev, 'utf8')
  })

  afterAll(async () => {
    if (dryDir) await rm(dryDir, { recursive: true, force: true })
  })

  it('C6: dry-run reports collision in errors', async () => {
    const noteData = fromLegacyDecision({
      ts: '2026-09-16T10:00:00Z',
      motive: 'seam-dry',
      data: { id: 'D-seam-dry', decision: 'x', rationale: 'y', alternatives: [], status: 'proposed', date: '1970-01-01' },
    })
    const collision = checkDecisionExtrasCollision(noteData)
    expect(collision).toBeDefined()
    const expected = `decision event ts=2026-09-16T10:00:00Z: Error: ${collision}`
    const result = await migrate({ repoRoot: dryDir, nextTracker: NEXT, dryRun: true })
    const mo = result.motives.find(m => m.slug === 'seam-dry')
    expect(mo).toBeDefined()
    expect(mo!.errors).toContain(expected)
  })

  it('C6: dry-run writes no decision file', async () => {
    const decisionsDir = join(dryDir, NEXT, 'motives', 'seam-dry', 'decisions')
    expect(existsSync(decisionsDir)).toBe(false)
  })
})
