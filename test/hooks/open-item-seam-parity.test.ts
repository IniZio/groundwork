/**
 * Open-item seam-parity test.
 *
 * Guards the contract "statement = short handle, body = detail" across three
 * files simultaneously:
 *   - hooks/lib/motive-charter.mjs  (parser: produces {statement, body})
 *   - hooks/lib/motive-tickets.mjs  (ticket renderer: title line = handle only)
 *   - hooks/lib/motive-map.mjs      (MAP renderer: ## Open items list line = handle only)
 *
 * A single edit that reverts any one renderer to leaking body into a title
 * or list line turns this test red — even if that renderer's own tests stay green.
 *
 * Core invariant (asserted explicitly in the final describe block):
 *   BODY token NEVER appears in any title line (#…) or any MAP list line (- …<id>…).
 *   HANDLE token ALWAYS appears in every such position.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-ignore
import { readCharter } from '../../hooks/lib/motive-charter.mjs'
// @ts-ignore
import { regenerateMotiveTickets, sanitizeId } from '../../hooks/lib/motive-tickets.mjs'
// @ts-ignore
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ─── Unique sentinel tokens ───────────────────────────────────────────────────
// Chosen to be globally unique strings that cannot appear incidentally
// in generated prose, file headers, or section titles.
const HANDLE = 'SEAMHANDLE_marker'
const BODY   = 'SEAMBODY_detail_marker'
const ITEM_ID = 'TBD-SEAM'

// ─── Charter fixture ──────────────────────────────────────────────────────────
// Multi-line open item: statement line + indented continuation (→ body).
// The indented line below the bullet is collected into item.body by parseOpenItems.
const CHARTER_MD = `# motive: seam-test

## Objective

Test the seam contract.

## Open items

- ${ITEM_ID}: ${HANDLE}
  ${BODY}

## Out of scope

<!-- none -->
`

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'seam-parity-'))
}

function makeCharter(dir: string, motive: string): void {
  const motiveDir = join(dir, '.groundwork', 'motives', motive)
  mkdirSync(motiveDir, { recursive: true })
  writeFileSync(join(motiveDir, 'motive.md'), CHARTER_MD, 'utf8')
}

function readOpenItemFile(motiveDir: string, id: string): string {
  const safe = sanitizeId(id)
  return readFileSync(join(motiveDir, 'open-items', `${safe}.md`), 'utf8')
}

function readMap(dir: string, motive: string): string {
  return readFileSync(join(dir, '.groundwork', 'motives', motive, 'MAP.md'), 'utf8')
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('open-item seam parity — handle/body contract', () => {
  const MOTIVE = 'seam-test'
  let dir: string
  let motiveDir: string

  beforeEach(() => {
    dir = tmp()
    motiveDir = join(dir, '.groundwork', 'motives', MOTIVE)
    makeCharter(dir, MOTIVE)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── 1. Parser (motive-charter.mjs) ────────────────────────────────────────
  describe('parser (motive-charter.mjs)', () => {
    it('item.statement contains HANDLE and NOT BODY', () => {
      const charter = readCharter({ projectDir: dir, motive: MOTIVE })!
      const item = charter.open_items.find((i: any) => i.id === ITEM_ID)
      expect(item, `${ITEM_ID} not found in parsed open_items`).toBeTruthy()
      expect(item!.statement).toContain(HANDLE)
      expect(item!.statement).not.toContain(BODY)
    })

    it('item.body contains BODY token', () => {
      const charter = readCharter({ projectDir: dir, motive: MOTIVE })!
      const item = charter.open_items.find((i: any) => i.id === ITEM_ID)!
      expect(item.body).toContain(BODY)
    })
  })

  // ── 2. Ticket renderer (motive-tickets.mjs) ───────────────────────────────
  describe('ticket renderer (motive-tickets.mjs)', () => {
    it('title line (# TBD-SEAM: …) contains HANDLE and NOT BODY', () => {
      const charter = readCharter({ projectDir: dir, motive: MOTIVE })!

      regenerateMotiveTickets(motiveDir, {
        openItems: charter.open_items,
        events: [],
      })

      const content = readOpenItemFile(motiveDir, ITEM_ID)
      const lines = content.split('\n')
      const titleLine = lines.find((l) => l.startsWith(`# ${ITEM_ID}`))

      expect(titleLine, 'title line not found in open-item drill-down file').toBeTruthy()
      expect(titleLine).toContain(HANDLE)
      expect(titleLine).not.toContain(BODY)

      // Confirm body token does appear somewhere below the title
      const afterTitle = lines.slice(lines.indexOf(titleLine!) + 1).join('\n')
      expect(afterTitle).toContain(BODY)
    })
  })

  // ── 3. MAP renderer (motive-map.mjs) ──────────────────────────────────────
  describe('MAP renderer (motive-map.mjs)', () => {
    it('## Open items list line contains HANDLE and NOT BODY', () => {
      regenerateMotiveMap(dir, MOTIVE)

      const map = readMap(dir, MOTIVE)
      const lines = map.split('\n')

      // The list line starts with "- " and references the item id (as a link or plain text)
      const listLine = lines.find(
        (l) => l.startsWith('- ') && l.includes(ITEM_ID),
      )

      expect(listLine, `list line for ${ITEM_ID} not found in MAP ## Open items`).toBeTruthy()
      expect(listLine).toContain(HANDLE)
      expect(listLine).not.toContain(BODY)
    })
  })

  // ── 4. Cross-seam invariant (the guard) ───────────────────────────────────
  //
  // Core invariant, asserted explicitly:
  //   The BODY token never appears in any title line or any MAP list line.
  //   The HANDLE token appears in every such position.
  //
  // This single test spans all three files so drift in ANY renderer fails it.
  describe('cross-seam invariant', () => {
    it('BODY token never appears in any title or list line; HANDLE appears in all', () => {
      // regenerateMotiveMap internally calls regenerateMotiveTickets,
      // so one call produces both output files.
      regenerateMotiveMap(dir, MOTIVE)

      const ticketContent = readOpenItemFile(motiveDir, ITEM_ID)
      const mapContent    = readMap(dir, MOTIVE)

      // ── Ticket file: every heading line must be free of BODY ──────────────
      const ticketHeadings = ticketContent.split('\n').filter((l) => l.startsWith('#'))
      for (const heading of ticketHeadings) {
        expect(
          heading,
          `BODY token leaked into ticket heading: "${heading}"`,
        ).not.toContain(BODY)
      }

      // ── MAP file: every list line that references the item must be free of BODY ──
      const mapListLines = mapContent.split('\n').filter(
        (l) => l.startsWith('- ') && l.includes(ITEM_ID),
      )
      for (const listLine of mapListLines) {
        expect(
          listLine,
          `BODY token leaked into MAP list line: "${listLine}"`,
        ).not.toContain(BODY)
      }

      // ── HANDLE must appear in the ticket title and MAP list line ──────────
      const ticketTitle = ticketContent.split('\n').find((l) => l.startsWith(`# ${ITEM_ID}`))
      const mapListLine = mapContent.split('\n').find(
        (l) => l.startsWith('- ') && l.includes(ITEM_ID),
      )

      expect(ticketTitle, 'ticket title line must contain HANDLE').toContain(HANDLE)
      expect(mapListLine, 'MAP list line must contain HANDLE').toContain(HANDLE)

      // ── BODY must still appear in the ticket body section (below title) ───
      const afterTitle = ticketContent
        .split('\n')
        .slice(ticketContent.split('\n').indexOf(ticketTitle!) + 1)
        .join('\n')
      expect(afterTitle, 'BODY token must appear in ticket body section').toContain(BODY)
    })
  })
})
