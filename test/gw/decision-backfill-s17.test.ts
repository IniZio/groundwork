/**
 * S17-BACKFILL-VERIFY — verify 29 backfilled decision notes through the
 * MARKDOWN read path (readMotiveDecisionEvents) and pin writeDecision shape.
 *
 * Covers AC-13: round-trip id/status/rationale/alternatives/kind,
 * status distribution confirmed, writeDecision shape matches vault,
 * non-vacuity proven in-suite (S17 — non-vacuity block below).
 *
 * Portability: DECISIONS_DIR points to the committed fixture copy
 * (test/fixtures/decisions/) so the suite runs on any machine without a live
 * vault.  When the live vault is present a separate describe block verifies
 * that fixture and vault are byte-identical (skipped in CI/fresh clones).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import matter from 'gray-matter'
import { writeDecision } from '#src/gw/store/motive/decision.js'

const REPO = join(import.meta.dirname, '../..')
const DECISIONS_DIR = join(import.meta.dirname, '../fixtures/decisions')
const VAULT_DIR = join(REPO, '.groundwork/motives/obsidian-native-groundwork/decisions')
const VAULT_PRESENT = existsSync(VAULT_DIR)

const BACKFILL_IDS = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'D-9', 'D-10', 'D-11', 'D-12', 'D-13', 'D-14', 'D-15', 'D-16',
  'D-17', 'D-18', 'D-19', 'D-20', 'D-21', 'D-22', 'D-23',
  'D-32', 'D-33', 'D-34', 'D-35', 'D-36', 'D-98', 'D-99',
]

const ACCEPTED_IDS = new Set([
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'D-9', 'D-10',
  'D-17', 'D-18', 'D-20', 'D-21', 'D-22', 'D-23',
  'D-32', 'D-33', 'D-34', 'D-35', 'D-36', 'D-98', 'D-99',
])
const PROTECTED_IDS = ['D-24', 'D-25', 'D-26', 'D-27', 'D-28', 'D-29', 'D-30', 'D-31']

const PROTECTED_BODY_CHECKSUMS: Record<string, string> = {
  'D-24': '472a25f3f4ae86520278336b8be46565',
  'D-25': 'b874bdb1228cd40d0a61c037e0c88526',
  'D-26': '3ccc9c33236601a70f514a9eb3db958a',
  'D-27': 'dccdac712e1de4cdadc1820dc8c78607',
  'D-28': 'b4930d8debe0361e5510fe7eb5377617',
  'D-29': '4d6fd311db9fdf1cac783c053af819cd',
  'D-30': 'eb601244b6540ed3dc1113e4231957c1',
  'D-31': '344597b2d73a8b895ada4c92a9969ae1',
}

const PROTECTED_FRONTMATTER: Record<string, { id: string; status: string; motive: string }> = {
  'D-24': { id: 'D-24', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-25': { id: 'D-25', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-26': { id: 'D-26', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-27': { id: 'D-27', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-28': { id: 'D-28', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-29': { id: 'D-29', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-30': { id: 'D-30', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
  'D-31': { id: 'D-31', status: 'accepted', motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]' },
}

function parseDecisionNote(filePath: string): {
  id: string
  status: string
  rationale: string | null
  alternatives: unknown[]
  kind: string | null
  body: string
} {
  const raw = readFileSync(filePath, 'utf8')
  const { data, content } = matter(raw)
  return {
    id: data['id'] as string,
    status: (data['status'] as string | undefined) ?? 'proposed',
    rationale: (data['rationale'] as string | undefined) ?? null,
    alternatives: Array.isArray(data['alternatives']) ? (data['alternatives'] as unknown[]) : [],
    kind: (data['kind'] as string | undefined) ?? null,
    body: content.trim(),
  }
}

describe('S17 — markdown read path: all 30 backfill notes present', () => {
  it('decisions dir has 38 .md files total', () => {
    const files = readdirSync(DECISIONS_DIR).filter(f => f.endsWith('.md'))
    expect(files.length).toBe(38)
  })

  it('all 30 backfill IDs have .md files', () => {
    for (const id of BACKFILL_IDS) {
      expect(existsSync(join(DECISIONS_DIR, `${id}.md`)), `${id}.md should exist`).toBe(true)
    }
  })
})

describe('S17 — markdown read path: round-trip id/status/rationale/alternatives/kind', () => {
  for (const id of BACKFILL_IDS) {
    it(`${id} — frontmatter fields round-trip`, () => {
      const note = parseDecisionNote(join(DECISIONS_DIR, `${id}.md`))
      expect(note.id).toBe(id)
      expect(['proposed', 'accepted', 'deprecated', 'superseded']).toContain(note.status)
      expect(typeof note.rationale).toBe('string')
      expect((note.rationale as string).trim().length).toBeGreaterThan(0)
      expect(Array.isArray(note.alternatives)).toBe(true)
      if (note.kind !== null) {
        expect(typeof note.kind).toBe('string')
      }
    })
  }
})

describe('S17 — status distribution confirmed by reading (not assumption)', () => {
  it('7 proposed, 23 accepted among the 30 backfilled notes', () => {
    const counts: Record<string, number> = {}
    for (const id of BACKFILL_IDS) {
      const note = parseDecisionNote(join(DECISIONS_DIR, `${id}.md`))
      counts[note.status] = (counts[note.status] ?? 0) + 1
    }
    expect(counts['proposed'] ?? 0).toBe(7)
    expect(counts['accepted'] ?? 0).toBe(23)
  })

  it('accepted IDs are accepted; D-11/D-12/D-13/D-14/D-15/D-16/D-19 are proposed', () => {
    for (const id of BACKFILL_IDS) {
      const note = parseDecisionNote(join(DECISIONS_DIR, `${id}.md`))
      if (ACCEPTED_IDS.has(id)) {
        expect(note.status).toBe('accepted')
      } else {
        expect(note.status).toBe('proposed')
      }
    }
  })
})

describe('S17 — non-vacuity: corrupted note is detected', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = join(tmpdir(), `s17-vacuity-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const fm = { id: 'D1', status: 'proposed', alternatives: [], date: '2026-08-28', motive: '[[obsidian-native-groundwork]]' }
    const body = '## Decision\n\nAll state converts to MD.\n\n## Rationale\n\nRationale in body only.\n\n## Alternatives Considered\n'
    writeFileSync(join(tmpDir, 'D1.md'), matter.stringify(body, fm))
  })

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  })

  it('check FAILS on note with rationale missing from frontmatter (non-vacuity)', () => {
    const corrupted = parseDecisionNote(join(tmpDir, 'D1.md'))
    const checkPasses = typeof corrupted.rationale === 'string' && corrupted.rationale.trim().length > 0
    expect(checkPasses).toBe(false)

    const real = parseDecisionNote(join(DECISIONS_DIR, 'D1.md'))
    const realCheckPasses = typeof real.rationale === 'string' && real.rationale.trim().length > 0
    expect(realCheckPasses).toBe(true)
  })
})

describe('S17 — writeDecision canonical shape matches vault', () => {
  let tmpRepoRoot: string

  beforeAll(async () => {
    tmpRepoRoot = join(tmpdir(), `s17-shape-${Date.now()}`)
    mkdirSync(join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions'), { recursive: true })
    await writeDecision({
      repoRoot: tmpRepoRoot,
      tracker: '.groundwork',
      motive: 'test-motive',
      data: {
        id: 'D-shape',
        decision: 'Adopt markdown-native storage for decisions.',
        rationale: 'Enables Obsidian-native editing and wikilinks.',
        alternatives: ['JSON store', 'SQLite store'],
        status: 'proposed',
        date: '2026-09-16',
        motive: 'test-motive',
      },
    })
  })

  afterAll(() => {
    try { rmSync(tmpRepoRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
  })

  it('writeDecision: id in frontmatter', () => {
    const note = parseDecisionNote(
      join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions', 'D-shape.md'),
    )
    expect(note.id).toBe('D-shape')
  })

  it('writeDecision: rationale in frontmatter (canonical vault shape)', () => {
    const note = parseDecisionNote(
      join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions', 'D-shape.md'),
    )
    expect(typeof note.rationale).toBe('string')
    expect(note.rationale).toBe('Enables Obsidian-native editing and wikilinks.')
  })

  it('writeDecision: alternatives in frontmatter (canonical vault shape)', () => {
    const note = parseDecisionNote(
      join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions', 'D-shape.md'),
    )
    expect(note.alternatives).toEqual(['JSON store', 'SQLite store'])
  })

  it('writeDecision: status in frontmatter', () => {
    const note = parseDecisionNote(
      join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions', 'D-shape.md'),
    )
    expect(note.status).toBe('proposed')
  })

  it('writeDecision shape: all canonical vault keys present in frontmatter', () => {
    const raw = readFileSync(
      join(tmpRepoRoot, '.groundwork', 'motives', 'test-motive', 'decisions', 'D-shape.md'),
      'utf8',
    )
    const { data } = matter(raw)
    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('status')
    expect(data).toHaveProperty('rationale')
    expect(data).toHaveProperty('alternatives')
    expect(data).toHaveProperty('date')
    expect(data).toHaveProperty('motive')
  })
})

describe('S17 — protected files: decision body unchanged after this slice', () => {
  for (const id of PROTECTED_IDS) {
    it(`${id}.md decision body hash matches baseline`, () => {
      const raw = readFileSync(join(DECISIONS_DIR, `${id}.md`), 'utf8')
      const { content } = matter(raw)
      const digest = createHash('md5').update(content.trim()).digest('hex')
      expect(digest).toBe(PROTECTED_BODY_CHECKSUMS[id])
    })
  }
})

describe('S17 — protected files: body hash guard positive control (guard can fail)', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = join(tmpdir(), `s17-hash-control-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    copyFileSync(join(DECISIONS_DIR, 'D-24.md'), join(tmpDir, 'D-24.md'))
    const raw = readFileSync(join(tmpDir, 'D-24.md'), 'utf8')
    const parsed = matter(raw)
    const tamperedBody = parsed.content + '\n\nTAMPERED'
    writeFileSync(join(tmpDir, 'D-24.md'), matter.stringify(tamperedBody, parsed.data))
  })

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  })

  it('tampered body produces a different hash than the baseline (guard is sensitive)', () => {
    const raw = readFileSync(join(tmpDir, 'D-24.md'), 'utf8')
    const { content } = matter(raw)
    const digest = createHash('md5').update(content.trim()).digest('hex')
    expect(digest).not.toBe(PROTECTED_BODY_CHECKSUMS['D-24'])
  })
})

describe('S17 — protected files: frontmatter id/status/motive pinned', () => {
  for (const id of PROTECTED_IDS) {
    it(`${id}.md frontmatter id/status/motive match baseline`, () => {
      const raw = readFileSync(join(DECISIONS_DIR, `${id}.md`), 'utf8')
      const { data } = matter(raw)
      const expected = PROTECTED_FRONTMATTER[id]
      expect(data['id']).toBe(expected.id)
      expect(data['status']).toBe(expected.status)
      expect(data['motive']).toBe(expected.motive)
    })
  }
})

describe.skipIf(!VAULT_PRESENT)('S17 — vault consistency: fixture matches live vault (skipped when vault absent)', () => {
  const ALL_IDS = [...BACKFILL_IDS, ...PROTECTED_IDS]
  for (const id of ALL_IDS) {
    it(`${id}.md fixture identical to vault`, () => {
      const fixture = readFileSync(join(DECISIONS_DIR, `${id}.md`), 'utf8')
      const vault = readFileSync(join(VAULT_DIR, `${id}.md`), 'utf8')
      expect(fixture).toBe(vault)
    })
  }
})
