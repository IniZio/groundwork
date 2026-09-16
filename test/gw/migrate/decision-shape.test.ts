import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { writeDecision, readDecision, fromLegacyDecision } from '#src/gw/store/motive/decision.js'
import { migrateMotive } from '#src/gw/migrate/runner.js'

const TRACKER = '.groundwork'
const SLUG = 'shape-test-motive'
const DEC_ID = 'D-001'

describe('decision shape identity: migrateMotive output matches writeDecision', () => {
  const temps: string[] = []
  const mkTemp = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'dec-shape-'))
    temps.push(d)
    return d
  }

  afterEach(() => {
    for (const d of temps.splice(0)) {
      try { rmSync(d, { recursive: true }) } catch { /* ignore */ }
    }
  })

  it('frontmatter key sets are equal and required headings appear in both', async () => {
    const rootA = mkTemp()
    const rootB = mkTemp()

    await writeDecision({
      repoRoot: rootA,
      tracker: TRACKER,
      motive: SLUG,
      data: {
        id: DEC_ID,
        decision: 'Reuse canonical writer',
        rationale: 'Consistency with vault shape',
        alternatives: ['Keep private emitter'],
        status: 'accepted',
        date: '2024-01-01',
        motive: SLUG,
      },
    })

    const sourceDir = mkTemp()
    writeFileSync(
      path.join(sourceDir, 'motive.md'),
      '---\ntitle: Shape Test\n---\n\n# Shape Test\n',
    )
    await migrateMotive({
      slug: SLUG,
      kind: 'active',
      sourceDir,
      repoRoot: rootB,
      nextTracker: TRACKER,
      decisionEvents: [
        {
          ts: '2024-01-01T00:00:00Z',
          motive: SLUG,
          session: 'test-session',
          data: {
            id: DEC_ID,
            decision: 'Reuse canonical writer',
            rationale: 'Consistency with vault shape',
            alternatives: ['Keep private emitter'],
            status: 'accepted',
            date: '2024-01-01',
          },
        },
      ],
      dryRun: false,
    })

    const decisionsA = path.join(rootA, TRACKER, 'motives', SLUG, 'decisions')
    const decisionsB = path.join(rootB, TRACKER, 'motives', SLUG, 'decisions')

    expect(existsSync(decisionsA), 'writeDecision must create decisions dir').toBe(true)
    expect(existsSync(decisionsB), 'migrateMotive must create decisions dir').toBe(true)

    const filesA = readdirSync(decisionsA).filter(f => f.endsWith('.md'))
    const filesB = readdirSync(decisionsB).filter(f => f.endsWith('.md'))

    expect(filesA).toHaveLength(1)
    expect(filesB).toHaveLength(1)

    const rawA = readFileSync(path.join(decisionsA, filesA[0]!), 'utf8')
    const rawB = readFileSync(path.join(decisionsB, filesB[0]!), 'utf8')

    const keysA = Object.keys(matter(rawA).data).sort()
    const keysB = Object.keys(matter(rawB).data).sort()
    expect(keysA).toEqual(keysB)

    for (const raw of [rawA, rawB]) {
      expect(raw).toContain('## Decision')
      expect(raw).toContain('## Rationale')
      expect(raw).toContain('## Alternatives Considered')
    }
  })
})

describe('extras lossless preservation (AC-4 / S24-MIGRATE-LOSSLESS)', () => {
  const temps: string[] = []
  const mkTemp = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'dec-extras-'))
    temps.push(d)
    return d
  }
  afterEach(() => {
    for (const d of temps.splice(0)) {
      try { rmSync(d, { recursive: true }) } catch { /* ignore */ }
    }
  })

  it('resolves field (real event: D-7, motive plugin-cleanup, 2026-08-03) survives migrate + readDecision', async () => {
    const root = mkTemp()
    const sourceDir = mkTemp()
    writeFileSync(path.join(sourceDir, 'motive.md'), '---\ntitle: Plugin Cleanup\n---\n')
    await migrateMotive({
      slug: 'plugin-cleanup',
      kind: 'active',
      sourceDir,
      repoRoot: root,
      nextTracker: '.groundwork',
      decisionEvents: [{
        ts: '2026-08-03T11:51:00.309Z',
        motive: 'plugin-cleanup',
        session: 'test-session',
        data: { id: 'D-7', status: 'accepted', title: 'frontier query command shipped', resolves: 'Q14' },
      }],
      dryRun: false,
    })
    const note = await readDecision({ repoRoot: root, tracker: '.groundwork', motive: 'plugin-cleanup', id: 'D-7' })
    expect(note.fm['resolves']).toBe('Q14')
  })

  it('rfc field (real value R-20260726-K4M2QX from journal) survives migrate + readDecision', async () => {
    const root = mkTemp()
    const sourceDir = mkTemp()
    writeFileSync(path.join(sourceDir, 'motive.md'), '---\ntitle: RFC Test\n---\n')
    await migrateMotive({
      slug: 'rfc-test-motive',
      kind: 'active',
      sourceDir,
      repoRoot: root,
      nextTracker: '.groundwork',
      decisionEvents: [{
        ts: '2026-07-26T11:13:37.607Z',
        motive: 'rfc-test-motive',
        session: 'test-session',
        rfc: 'R-20260726-K4M2QX',
        data: { id: 'D-1', decision: 'No Wave 3 run may carry rfc_ref', rationale: 'RFC lifecycle', alternatives: [] },
      }],
      dryRun: false,
    })
    const note = await readDecision({ repoRoot: root, tracker: '.groundwork', motive: 'rfc-test-motive', id: 'D-1' })
    expect(note.fm['rfc']).toBe('R-20260726-K4M2QX')
  })

  it('generic mechanism: invented key x_workflow_ref survives with no code change', async () => {
    const root = mkTemp()
    const sourceDir = mkTemp()
    writeFileSync(path.join(sourceDir, 'motive.md'), '---\ntitle: Generic\n---\n')
    await migrateMotive({
      slug: 'generic-test',
      kind: 'active',
      sourceDir,
      repoRoot: root,
      nextTracker: '.groundwork',
      decisionEvents: [{
        ts: '2024-06-01T00:00:00Z',
        motive: 'generic-test',
        session: 'test-session',
        data: { id: 'D-1', decision: 'Generic', rationale: 'Test', alternatives: [], x_workflow_ref: 'WF-9999' },
      }],
      dryRun: false,
    })
    const note = await readDecision({ repoRoot: root, tracker: '.groundwork', motive: 'generic-test', id: 'D-1' })
    expect(note.fm['x_workflow_ref']).toBe('WF-9999')
  })

  it('fromLegacyDecision: canonical keys excluded from extras, non-canonical preserved', () => {
    const result = fromLegacyDecision({
      ts: '2024-01-01T00:00:00Z',
      motive: 'test',
      data: { id: 'D-1', decision: 'D', rationale: 'R', alternatives: [], status: 'accepted', kind: 'arch', resolves: 'TBD-5', blast: 'medium' },
    })
    expect(result.extras).toEqual({ resolves: 'TBD-5', blast: 'medium' })
    expect(result.id).toBe('D-1')
    expect(result.status).toBe('accepted')
  })

  it('canonical vault shape unchanged: no extra keys when extras is empty', async () => {
    const root = mkTemp()
    await writeDecision({ repoRoot: root, tracker: '.groundwork', motive: 'shape-check', data: {
      id: 'D-1', decision: 'D', rationale: 'R', alternatives: [], status: 'accepted', date: '2024-01-01', motive: 'shape-check',
    }})
    const note = await readDecision({ repoRoot: root, tracker: '.groundwork', motive: 'shape-check', id: 'D-1' })
    expect(note.fm['resolves']).toBeUndefined()
    expect(note.fm['x_workflow_ref']).toBeUndefined()
    expect(note.body).toContain('## Decision')
    expect(note.body).toContain('## Rationale')
    expect(note.body).toContain('## Alternatives Considered')
  })
})
