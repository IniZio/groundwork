// test/motive-graduation.test.ts
// Tests for TBD→ticket graduation semantics (D-75, D-76).
//
// D-75-AC1  A TBD declaring graduated-to:<id> surfaces a graduated_to field in
//           the parsed open-item; the item REMAINS in the open register.
// D-75-AC2  graduated-to: declared in the body (continuation lines) is also parsed.
// D-76-AC1  The open-item drill-down (open-items/) contains a link to tickets/<id>.md.
// D-76-AC2  tickets/ is never written; open-items/ and tickets/ coexist.
// COMPILE   compiled open_item carries graduated_to through the whitelist (not dropped).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readCharter } from '../hooks/lib/motive-charter.mjs'
import { regenerateMotiveTickets } from '../hooks/lib/motive-tickets.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp() {
  const dir = join(tmpdir(), `gw-grad-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Create a minimal motive.md charter at <projectDir>/.groundwork/motives/<slug>/motive.md
 * and return the { projectDir, motive } used by readCharter.
 */
function writeCharter(projectDir: string, slug: string, openItemsSection: string): void {
  const motiveDir = join(projectDir, '.groundwork', 'motives', slug)
  mkdirSync(motiveDir, { recursive: true })
  const charterMd = `# motive: ${slug}\n\n## Objective\n\nTest motive.\n\n## Open items\n\n${openItemsSection}\n`
  writeFileSync(join(motiveDir, 'motive.md'), charterMd, 'utf8')
}

// ---------------------------------------------------------------------------
// D-75-AC1  handle-line graduation → graduated_to field + stays in register
// ---------------------------------------------------------------------------

describe('D-75-AC1 — graduated-to on handle line', () => {
  let projectDir: string
  const slug = 'grad-test'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('surfaces graduated_to on the parsed open-item', () => {
    writeCharter(projectDir, slug, '- TBD-1: Which approach? graduated-to:T-42')
    const charter = readCharter({ projectDir, motive: slug })
    expect(charter).not.toBeNull()
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-42')
  })

  it('strips graduated-to: from the statement text', () => {
    writeCharter(projectDir, slug, '- TBD-1: Which approach? graduated-to:T-42')
    const charter = readCharter({ projectDir, motive: slug })
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item!.statement).not.toContain('graduated-to:')
    expect(item!.statement).toContain('Which approach?')
  })

  it('TBD remains in the open register after graduation (not resolved)', () => {
    writeCharter(projectDir, slug, '- TBD-1: Which approach? graduated-to:T-42\n- TBD-2: Another')
    const charter = readCharter({ projectDir, motive: slug })
    // TBD-1 must still be in open_items
    const ids = charter!.open_items.map((i: any) => i.id)
    expect(ids).toContain('TBD-1')
    expect(ids).toContain('TBD-2')
  })

  it('a resolved (strikethrough) item is still excluded from register', () => {
    writeCharter(projectDir, slug, '- TBD-1: ~~Which approach?~~ CLOSED graduated-to:T-42')
    const charter = readCharter({ projectDir, motive: slug })
    // Resolved (strikethrough) items must NOT appear in open_items
    const ids = charter!.open_items.map((i: any) => i.id)
    expect(ids).not.toContain('TBD-1')
  })
})

// ---------------------------------------------------------------------------
// D-75-AC2  body-declared graduation
// ---------------------------------------------------------------------------

describe('D-75-AC2 — graduated-to declared in continuation body', () => {
  let projectDir: string
  const slug = 'grad-body'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('parses graduated-to from a continuation line body', () => {
    writeCharter(
      projectDir,
      slug,
      '- TBD-3: Long open item with rich body.\n  This decision needs input. graduated-to:T-99',
    )
    const charter = readCharter({ projectDir, motive: slug })
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-3')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-99')
  })

  it('handle-line graduation takes precedence over body graduation', () => {
    writeCharter(
      projectDir,
      slug,
      '- TBD-4: Primary. graduated-to:T-10\n  Body also mentions graduated-to:T-99',
    )
    const charter = readCharter({ projectDir, motive: slug })
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-4')
    expect(item!.graduated_to).toBe('T-10')
  })
})

// ---------------------------------------------------------------------------
// SPACED FORMAT — human-first charter writes "graduated-to: T-42" with a space
// These cases were silently broken before \s* was added to GRADUATED_TO_RE.
// ---------------------------------------------------------------------------

describe('spaced graduated-to format — handle line', () => {
  let projectDir: string
  const slug = 'grad-spaced-handle'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('parses graduated_to when there is a space after the colon (handle line)', () => {
    writeCharter(projectDir, slug, '- TBD-1: Which approach? graduated-to: T-42')
    const charter = readCharter({ projectDir, motive: slug })
    expect(charter).not.toBeNull()
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-42')
  })

  it('strips spaced graduated-to: from statement text', () => {
    writeCharter(projectDir, slug, '- TBD-1: Which approach? graduated-to: T-42')
    const charter = readCharter({ projectDir, motive: slug })
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-1')
    expect(item!.statement).not.toContain('graduated-to:')
    expect(item!.statement).toContain('Which approach?')
  })
})

describe('spaced graduated-to format — body continuation line', () => {
  let projectDir: string
  const slug = 'grad-spaced-body'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('parses graduated_to from a body line with space after colon', () => {
    writeCharter(
      projectDir,
      slug,
      '- TBD-3: Long open item.\n  refs: D-1 · graduated-to: T-99',
    )
    const charter = readCharter({ projectDir, motive: slug })
    const item = charter!.open_items.find((i: any) => i.id === 'TBD-3')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-99')
  })
})

// ---------------------------------------------------------------------------
// D-76-AC1  drill-down contains cross-link to tickets/<id>.md
// ---------------------------------------------------------------------------

describe('D-76-AC1 — open-item drill-down links to graduated ticket', () => {
  let motiveDir: string

  beforeEach(() => { motiveDir = makeTmp() })
  afterEach(() => { rmSync(motiveDir, { recursive: true, force: true }) })

  it('drill-down contains a link to tickets/<id>.md when graduated_to is set', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-5', kind: 'TBD', statement: 'Which approach?', graduated_to: 'T-42' },
      ],
      events: [],
    })

    const content = readFileSync(join(motiveDir, 'open-items', 'tbd-5.md'), 'utf8')
    expect(content).toContain('tickets/T-42.md')
    expect(content).toContain('../tickets/T-42.md')
  })

  it('drill-down has no graduated-to section when graduated_to is absent', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-6', kind: 'TBD', statement: 'No graduation' },
      ],
      events: [],
    })

    const content = readFileSync(join(motiveDir, 'open-items', 'tbd-6.md'), 'utf8')
    expect(content).not.toContain('Graduated to')
    expect(content).not.toContain('tickets/')
  })
})

// ---------------------------------------------------------------------------
// D-76-AC2  tickets/ is never written; coexistence preserved
// ---------------------------------------------------------------------------

describe('D-76-AC2 — tickets/ untouched even when graduation is present', () => {
  let motiveDir: string

  beforeEach(() => { motiveDir = makeTmp() })
  afterEach(() => { rmSync(motiveDir, { recursive: true, force: true }) })

  it('does not create or modify tickets/ when graduated open items are present', () => {
    const ticketsDir = join(motiveDir, 'tickets')
    mkdirSync(ticketsDir, { recursive: true })
    const ticketPath = join(ticketsDir, 'T-42.md')
    const original = '# T-42: My hand-authored ticket\n\nOriginates from TBD-5.\n'
    writeFileSync(ticketPath, original, 'utf8')

    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-5', kind: 'TBD', statement: 'Which approach?', graduated_to: 'T-42' },
      ],
      events: [],
    })

    // Hand-authored ticket must survive byte-identical
    expect(readFileSync(ticketPath, 'utf8')).toBe(original)
    // open-items/ drill-down must still be written
    expect(existsSync(join(motiveDir, 'open-items', 'tbd-5.md'))).toBe(true)
  })

  it('does not create tickets/ when it did not exist', () => {
    regenerateMotiveTickets(motiveDir, {
      slices: [],
      openItems: [
        { id: 'TBD-7', kind: 'TBD', statement: 'Graduated item', graduated_to: 'T-99' },
      ],
      events: [],
    })

    expect(existsSync(join(motiveDir, 'tickets'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// COMPILE — graduated_to passes through compile whitelist
// ---------------------------------------------------------------------------

describe('compile — graduated_to is not dropped by the open_items whitelist', () => {
  let projectDir: string
  const slug = 'grad-compile'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('compiled open_item carries graduated_to field', async () => {
    // Import compile lazily to avoid circular-import side effects in other tests
    const { compile } = await import('../hooks/lib/motive-compile.mjs')

    writeCharter(projectDir, slug, '- TBD-8: Compile test. graduated-to:T-55')
    const charter = readCharter({ projectDir, motive: slug })
    expect(charter).not.toBeNull()

    // compile(events, opts) — events is first positional arg
    const result = compile([], { charter, groundTruth: null })

    const item = result.agent?.open_items?.find((i: any) => i.id === 'TBD-8')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-55')
  })
})
