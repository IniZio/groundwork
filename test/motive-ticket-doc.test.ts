// test/motive-ticket-doc.test.mjs
// Tests for hooks/lib/motive-ticket-doc.mjs (T3-AC1..AC4)
// @verifies ARTIFACT-R-007
// @verifies ARTIFACT-R-009

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  renderTemplate,
  parseTicket,
  writeTicket,
  resolveTicketPath,
  REQUIRED_SECTIONS,
} from '../hooks/lib/motive-ticket-doc.mjs'

// ---------------------------------------------------------------------------
// T3-AC1 — template renderer produces the mattpocock section set
// ---------------------------------------------------------------------------

describe('renderTemplate (T3-AC1)', () => {
  it('includes all required sections', () => {
    const md = renderTemplate({ title: 'Decide: foo' })
    for (const section of REQUIRED_SECTIONS) {
      expect(md).toContain(`## ${section}`)
    }
  })

  it('renders h1 title', () => {
    const md = renderTemplate({ title: 'Decide: foo bar' })
    expect(md).toMatch(/^# Decide: foo bar$/m)
  })

  it('renders metadata header lines', () => {
    const md = renderTemplate({ title: 'T', type: 'grilling', status: 'open', blockedBy: 'T1' })
    expect(md).toMatch(/^Type: grilling$/m)
    expect(md).toMatch(/^Status: open$/m)
    expect(md).toMatch(/^Blocked by: T1$/m)
  })

  it('defaults type=decision, status=open, blockedBy=—', () => {
    const md = renderTemplate({ title: 'T' })
    expect(md).toMatch(/^Type: decision$/m)
    expect(md).toMatch(/^Status: open$/m)
    expect(md).toMatch(/^Blocked by: —$/m)
  })

  it('section bodies are empty for authors to fill', () => {
    const md = renderTemplate({ title: 'T' })
    const { emptySections } = parseTicket(md)
    expect(emptySections).toEqual(REQUIRED_SECTIONS)
  })
})

// ---------------------------------------------------------------------------
// T3-AC2 — parser reports empty sections without rewriting
// ---------------------------------------------------------------------------

describe('parseTicket (T3-AC2)', () => {
  it('reports all sections empty on a fresh template', () => {
    const md = renderTemplate({ title: 'T' })
    const { emptySections } = parseTicket(md)
    expect(emptySections).toEqual(REQUIRED_SECTIONS)
  })

  it('does not report filled sections as empty', () => {
    const md =
      renderTemplate({ title: 'T' }).replace(
        /^## Question\s*$/m,
        '## Question\n\nThis is the question body.',
      )
    const { emptySections } = parseTicket(md)
    expect(emptySections).not.toContain('Question')
  })

  it('reports absent section as empty', () => {
    const md = '# T\n\n## Question\n\nContent\n'
    // No Context section → should be reported empty
    const { emptySections } = parseTicket(md)
    expect(emptySections).toContain('Context')
  })

  it('returns empty array when all sections have content', () => {
    let md = '# T\n\nType: decision\nStatus: open\nBlocked by: —\n\n'
    for (const s of REQUIRED_SECTIONS) {
      md += `## ${s}\n\nSome content here.\n\n`
    }
    const { emptySections } = parseTicket(md)
    expect(emptySections).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// T3-AC3 — writer never overwrites an existing ticket
// ---------------------------------------------------------------------------

describe('writeTicket (T3-AC3)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `gw-ticket-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates file when absent and returns written:true', async () => {
    const path = join(tmpDir, 'new-ticket.md')
    const result = await writeTicket(path, { title: 'New ticket' })
    expect(result.written).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('created file contains the rendered template', async () => {
    const path = join(tmpDir, 'ticket.md')
    await writeTicket(path, { title: 'My ticket' })
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('# My ticket')
    expect(content).toContain('## Question')
  })

  it('does NOT overwrite existing file — hand-written body survives second call', async () => {
    const path = join(tmpDir, 'hand-written.md')
    const handWritten = '# hand-written\n\n## Question\n\nThis is precious content.\n'
    writeFileSync(path, handWritten, 'utf8')

    // Second call — must not overwrite
    const result = await writeTicket(path, { title: 'Different title' })
    expect(result.written).toBe(false)

    const content = readFileSync(path, 'utf8')
    expect(content).toBe(handWritten)
  })

  it('creates parent directories when they do not exist', async () => {
    const path = join(tmpDir, 'nested', 'dir', 'ticket.md')
    await writeTicket(path, { title: 'Nested' })
    expect(existsSync(path)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T3-AC4 — location resolution: charter tickets_dir override + default fallback
// ---------------------------------------------------------------------------

describe('resolveTicketPath (T3-AC4)', () => {
  const motiveDir = '/groundwork/motives/my-motive'

  it('falls back to <motiveDir>/tickets/<id>.md when no charter', () => {
    const path = resolveTicketPath(null, motiveDir, 'T3')
    expect(path).toBe('/groundwork/motives/my-motive/tickets/T3.md')
  })

  it('falls back to <motiveDir>/tickets/<id>.md when charter has no tickets_dir', () => {
    const path = resolveTicketPath({}, motiveDir, 'T3')
    expect(path).toBe('/groundwork/motives/my-motive/tickets/T3.md')
  })

  it('uses charter.tickets_dir override when present', () => {
    const charter = { tickets_dir: '/custom/tickets' }
    const path = resolveTicketPath(charter, motiveDir, 'T3')
    expect(path).toBe('/custom/tickets/T3.md')
  })

  it('sanitizes ticket id — replaces unsafe chars with hyphens', () => {
    const path = resolveTicketPath(null, motiveDir, 'T3/../../evil')
    expect(path).not.toContain('..')
    // dots replaced by hyphens → T3/../../evil → T3--..--..-evil → sanitized
    expect(path).toMatch(/T3-+evil/)
  })
})
