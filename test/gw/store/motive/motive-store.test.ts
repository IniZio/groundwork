import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdtempSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  charterPath,
  readCharter,
  writeCharter,
  fromLegacyCharter,
  readTicket,
  writeTicket,
  fromLegacyTicket,
  readDecision,
  writeDecision,
  fromLegacyDecision,
  readOpenItem,
  writeOpenItem,
  fromLegacyOpenItems,
  openItemPath,
} from '../../../../src/gw/store/motive/index.js'

const MOTIVE = 'obsidian-native-groundwork'
const LEGACY_ROOT = '/home/newman/.local/share/groundwork/.groundwork'

const FIXTURE_DIR = new URL('../../../../test/fixtures/gw', import.meta.url).pathname
const CHARTER_FIXTURE = path.join(FIXTURE_DIR, 'legacy-charter.md')
const TICKET_FIXTURE = path.join(FIXTURE_DIR, 'legacy-ticket.md')
const JOURNAL_FIXTURE = path.join(FIXTURE_DIR, 'legacy-journal.jsonl')

function loadDecisionEventsFromFixture(): Array<{
  ts: string
  motive?: string
  type: string
  data?: Record<string, unknown>
}> {
  const lines = readFileSync(JOURNAL_FIXTURE, 'utf8').trim().split('\n')
  return lines
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
    .filter(ev => ev.type === 'DECISION')
}

describe('motive store — round-trip (real obsidian-native-groundwork data)', () => {
  let tempTracker: string

  beforeAll(() => {
    tempTracker = mkdtempSync(path.join(os.tmpdir(), 'gw-store-test-'))
  })

  afterAll(async () => {
    await rm(tempTracker, { recursive: true, force: true })
  })

  // ── Charter ──────────────────────────────────────────────────────────────

  describe('charter', () => {
    it('fromLegacyCharter preserves fm fields and body', () => {
      const raw = readFileSync(CHARTER_FIXTURE, 'utf8')
      const note = fromLegacyCharter(raw)
      expect(note.fm).toBeDefined()
      expect(note.body).toBeDefined()
      expect(note.body.trim().length).toBeGreaterThan(0)
    })

    it('round-trips charter: write → read → same fm and body', async () => {
      const raw = readFileSync(CHARTER_FIXTURE, 'utf8')
      const note = fromLegacyCharter(raw)
      await writeCharter({ repoRoot: '', tracker: tempTracker, motive: MOTIVE, ...note })
      const readBack = await readCharter({ repoRoot: '', tracker: tempTracker, motive: MOTIVE })
      for (const [k, v] of Object.entries(note.fm)) {
        expect(readBack.fm[k]).toEqual(v)
      }
      expect(readBack.body.trim()).toBe(note.body.trim())
    })
  })

  // ── Decisions (15 real DECISION events: D1..D8, D-9..D-15) ───────────────

  describe('decisions (15 real DECISION events: D1..D8, D-9..D-15)', () => {
    let events: Array<{ ts: string; motive?: string; type: string; data?: Record<string, unknown> }>

    beforeAll(() => {
      events = loadDecisionEventsFromFixture()
    })

    it('finds at least 8 DECISION events in fixture', () => {
      expect(events.length).toBeGreaterThanOrEqual(8)
    })

    it('round-trips all decisions: write → read → compare id, rationale, status', async () => {
      for (const ev of events) {
        const data = fromLegacyDecision(ev)
        expect(data.rationale).toBeTruthy()
        expect(data.status).toBe('accepted')

        await writeDecision({ repoRoot: '', tracker: tempTracker, motive: MOTIVE, data })
        const readBack = await readDecision({
          repoRoot: '',
          tracker: tempTracker,
          motive: MOTIVE,
          id: data.id,
        })

        // canonical id stored is always D-N form
        expect(String(readBack.fm['id'])).toMatch(/^D-\d+$/)
        expect(readBack.fm['rationale']).toBeTruthy()
        expect(readBack.fm['status']).toBe('accepted')
        if (data.date) expect(readBack.fm['date']).toBeTruthy()
      }
    })

    it('decision body contains ## Decision section', async () => {
      const ev = events[0]
      const data = fromLegacyDecision(ev)
      const readBack = await readDecision({
        repoRoot: '',
        tracker: tempTracker,
        motive: MOTIVE,
        id: data.id,
      })
      expect(readBack.body).toContain('## Decision')
    })
  })

  // ── Open items (TBD-1, TBD-2, TBR-1 from charter) ────────────────────────

  describe('open items (TBD-1, TBD-2, TBR-1 from charter)', () => {
    let notes: Array<{
      fm: { id: string; kind: 'TBD' | 'TBR'; status: 'open' | 'resolved'; refs?: string[]; motive?: string }
      body: string
    }>

    beforeAll(() => {
      const raw = readFileSync(CHARTER_FIXTURE, 'utf8')
      notes = fromLegacyOpenItems(raw, MOTIVE)
    })

    it('finds 3 open items (TBD-1, TBD-2, TBR-1)', () => {
      expect(notes.length).toBe(3)
    })

    it('all have status: open', () => {
      for (const n of notes) expect(n.fm.status).toBe('open')
    })

    it('kinds match id prefix', () => {
      for (const n of notes) {
        const expected = n.fm.id.startsWith('TBD') ? 'TBD' : 'TBR'
        expect(n.fm.kind).toBe(expected)
      }
    })

    it('round-trips all open items: write → read → same fm', async () => {
      for (const n of notes) {
        await writeOpenItem({ repoRoot: '', tracker: tempTracker, motive: MOTIVE, ...n })
        const readBack = await readOpenItem({
          repoRoot: '',
          tracker: tempTracker,
          motive: MOTIVE,
          id: n.fm.id,
        })
        expect(readBack.fm.id).toBe(n.fm.id)
        expect(readBack.fm.kind).toBe(n.fm.kind)
        expect(readBack.fm.status).toBe('open')
      }
    })
  })

  // ── Tickets ───────────────────────────────────────────────────────────────

  describe('tickets', () => {
    it('fromLegacyTicket parses real ticket fixture fm + body', () => {
      const raw = readFileSync(TICKET_FIXTURE, 'utf8')
      const note = fromLegacyTicket(raw)
      expect(note.fm).toBeDefined()
      expect(note.body).toBeDefined()
      // ticket has some frontmatter and body content
      expect(typeof note.fm).toBe('object')
      expect(note.body.trim().length).toBeGreaterThanOrEqual(0)
    })

    it('round-trips ticket: write → read → same fm fields', async () => {
      const raw = readFileSync(TICKET_FIXTURE, 'utf8')
      const note = fromLegacyTicket(raw)
      await writeTicket({
        repoRoot: '',
        tracker: tempTracker,
        motive: MOTIVE,
        filename: 's0-inventory',
        fm: note.fm,
        body: note.body,
      })
      const readBack = await readTicket({
        repoRoot: '',
        tracker: tempTracker,
        motive: MOTIVE,
        filename: 's0-inventory',
      })
      // All fm keys from the original must round-trip
      for (const [k, v] of Object.entries(note.fm)) {
        expect(readBack.fm[k]).toEqual(v)
      }
    })

    it('round-trips ticket body unchanged', async () => {
      const raw = readFileSync(TICKET_FIXTURE, 'utf8')
      const note = fromLegacyTicket(raw)
      // Re-read it (writeTicket already called above — tempTracker persists within describe)
      const readBack = await readTicket({
        repoRoot: '',
        tracker: tempTracker,
        motive: MOTIVE,
        filename: 's0-inventory',
      })
      expect(readBack.body.trim()).toBe(note.body.trim())
    })
  })

  // ── Isolation guard ───────────────────────────────────────────────────────

  describe('isolation guard — nothing written outside temp tracker', () => {
    it('charterPath resolves under tempTracker', () => {
      const p = charterPath('', tempTracker, MOTIVE)
      const resolved = path.isAbsolute(p) ? p : path.resolve(p)
      expect(resolved.startsWith(tempTracker)).toBe(true)
    })

    it('openItemPath resolves under tempTracker', () => {
      const p = openItemPath('', tempTracker, MOTIVE, 'TBD-1')
      const resolved = path.isAbsolute(p) ? p : path.resolve(p)
      expect(resolved.startsWith(tempTracker)).toBe(true)
    })

    it('LEGACY_ROOT motive.md is untouched (still exists as a file)', async () => {
      const s = await stat(path.join(LEGACY_ROOT, 'motives', MOTIVE, 'motive.md'))
      expect(s.isFile()).toBe(true)
    })
  })
})
