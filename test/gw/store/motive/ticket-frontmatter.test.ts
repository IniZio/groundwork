import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { readTicket } from '../../../../src/gw/store/motive/index.js'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const TRACKER = '.groundwork'
const MOTIVE = 'obsidian-native-groundwork'
const TICKETS_DIR = path.join(REPO_ROOT, TRACKER, 'motives', MOTIVE, 'tickets')

const TICKET_FILES = readdirSync(TICKETS_DIR)
  .filter(f => f.endsWith('.md'))
  .sort()

describe('ticket frontmatter conversion — obsidian-native-groundwork', () => {
  it('reads exactly 39 ticket files', () => {
    expect(TICKET_FILES).toHaveLength(39)
  })

  it('readTicket succeeds on all 39 files', async () => {
    const results = await Promise.all(
      TICKET_FILES.map(f => readTicket({ repoRoot: REPO_ROOT, tracker: TRACKER, motive: MOTIVE, filename: f }))
    )
    expect(results).toHaveLength(39)
    for (const note of results) {
      expect(note.fm).toBeDefined()
    }
  })

  it('previously-complete tickets read back as done', async () => {
    const completeFiles = ['s0-design-patterns.md', 's0-design-research.md', 's0-inventory.md']
    for (const f of completeFiles) {
      const note = await readTicket({ repoRoot: REPO_ROOT, tracker: TRACKER, motive: MOTIVE, filename: f })
      expect(note.fm.status, `${f} should be done`).toBe('done')
    }
  })

  it('all type values are accepted by TicketSchema', async () => {
    const validTypes = new Set(['build','chore','choose','decision','design','enhancement','feat','fix','grill','model','research','spec'])
    const results = await Promise.all(
      TICKET_FILES.map(f => readTicket({ repoRoot: REPO_ROOT, tracker: TRACKER, motive: MOTIVE, filename: f }))
    )
    for (let i = 0; i < results.length; i++) {
      const { fm } = results[i]
      if (fm.type !== undefined) {
        expect(validTypes.has(fm.type as string), `${TICKET_FILES[i]} type=${fm.type} not in enum`).toBe(true)
      }
    }
  })

  it('file count is exactly 39 after conversion', () => {
    const current = readdirSync(TICKETS_DIR).filter(f => f.endsWith('.md'))
    expect(current).toHaveLength(39)
  })
})
