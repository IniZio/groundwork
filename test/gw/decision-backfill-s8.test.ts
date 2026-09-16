import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const REPO = join(import.meta.dirname, '../..')
const DECISIONS_DIR = join(REPO, '.groundwork/motives/obsidian-native-groundwork/decisions')
const PROTECTED = new Set(['D-24', 'D-25', 'D-26', 'D-27', 'D-28', 'D-29', 'D-30', 'D-31'])

const BACKFILL_IDS = [
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'D-9', 'D-10', 'D-11', 'D-12', 'D-13', 'D-14', 'D-15', 'D-16',
  'D-17', 'D-18', 'D-19', 'D-20', 'D-21', 'D-22', 'D-23',
  'D-32', 'D-33', 'D-34', 'D-35', 'D-98', 'D-99',
]

const ACCEPTED_IDS = new Set(['D-32', 'D-33', 'D-34', 'D-35'])

function readDecision(id: string): string {
  return readFileSync(join(DECISIONS_DIR, `${id}.md`), 'utf8')
}

describe('S8-DECISION-BACKFILL — all 29 files present', () => {
  it('decisions dir contains exactly the 8 protected + 29 backfill files', () => {
    const files = readdirSync(DECISIONS_DIR).filter(f => f.endsWith('.md'))
    expect(files.length).toBe(37)
  })

  for (const id of BACKFILL_IDS) {
    it(`${id}.md exists`, () => {
      expect(existsSync(join(DECISIONS_DIR, `${id}.md`))).toBe(true)
    })
  }
})

describe('S8-DECISION-BACKFILL — protected files untouched', () => {
  for (const id of PROTECTED) {
    it(`${id}.md still exists`, () => {
      expect(existsSync(join(DECISIONS_DIR, `${id}.md`))).toBe(true)
    })
  }
})

describe('S8-DECISION-BACKFILL — note shape matches D-24 template', () => {
  for (const id of BACKFILL_IDS) {
    it(`${id}.md has required frontmatter keys`, () => {
      const content = readDecision(id)
      expect(content).toMatch(/^---\n/)
      expect(content).toContain(`id: ${id}`)
      expect(content).toContain('status:')
      expect(content).toContain("date: '")
      expect(content).toContain('rationale:')
      expect(content).toContain('alternatives:')
      expect(content).toContain("motive: '[[motives/obsidian-native-groundwork/motive|obsidian-native-groundwork]]'")
    })

    it(`${id}.md has required body sections`, () => {
      const content = readDecision(id)
      expect(content).toContain('## Decision')
      expect(content).toContain('## Rationale')
      expect(content).toContain('## Alternatives Considered')
    })
  }
})

describe('S8-DECISION-BACKFILL — status preserved from source', () => {
  for (const id of BACKFILL_IDS) {
    it(`${id} status is accepted or proposed (never forced to accepted)`, () => {
      const content = readDecision(id)
      const match = content.match(/^status:\s*(\S+)/m)
      expect(match).not.toBeNull()
      const status = match![1]
      expect(['accepted', 'proposed']).toContain(status)
      if (ACCEPTED_IDS.has(id)) {
        expect(status).toBe('accepted')
      } else {
        expect(status).toBe('proposed')
      }
    })
  }
})
