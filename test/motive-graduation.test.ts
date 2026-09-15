import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readCharter } from '../hooks/lib/motive-charter.mjs'

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
    const ids = charter!.open_items.map((i: any) => i.id)
    expect(ids).toContain('TBD-1')
    expect(ids).toContain('TBD-2')
  })

  it('a resolved (strikethrough) item is still excluded from register', () => {
    writeCharter(projectDir, slug, '- TBD-1: ~~Which approach?~~ CLOSED graduated-to:T-42')
    const charter = readCharter({ projectDir, motive: slug })
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
// SPACED FORMAT — graduated-to: T-42 (space after colon)
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
// COMPILE — graduated_to passes through compile whitelist
// ---------------------------------------------------------------------------

describe('compile — graduated_to is not dropped by the open_items whitelist', () => {
  let projectDir: string
  const slug = 'grad-compile'

  beforeEach(() => { projectDir = makeTmp() })
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }) })

  it('compiled open_item carries graduated_to field', async () => {
    const { compile } = await import('../hooks/lib/motive-compile.mjs')

    writeCharter(projectDir, slug, '- TBD-8: Compile test. graduated-to:T-55')
    const charter = readCharter({ projectDir, motive: slug })
    expect(charter).not.toBeNull()

    const result = compile([], { charter, groundTruth: null })

    const item = result.agent?.open_items?.find((i: any) => i.id === 'TBD-8')
    expect(item).toBeDefined()
    expect(item!.graduated_to).toBe('T-55')
  })
})
