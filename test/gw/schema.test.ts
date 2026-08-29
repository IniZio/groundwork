import { describe, it, expect } from 'vitest'
import matter from 'gray-matter'
import {
  // AC1: all schema exports present
  MotiveSchema,
  SliceSchema,
  GateSchema,
  DecisionSchema,
  TicketSchema,
  RequirementSchema,
  ConceptIndexSchema,
  DesignNoteKind,
  JournalEventSchema,
  // layout
  DEFAULT_TRACKER_PATH,
  motiveDir,
  sliceNotePath,
  gateNotePath,
  ticketPath,
  conceptIndexPath,
  requirementPath,
  designDir,
  designMocPath,
  specDecisionPath,
  glossaryPath,
  resolveTracker,
} from '../../src/gw/schema/index.js'

// ============================================================
// AC1: All note-kind schemas are exported from the barrel
// ============================================================
describe('AC1 — barrel exports', () => {
  it('exports all required Zod schemas', () => {
    expect(MotiveSchema).toBeDefined()
    expect(SliceSchema).toBeDefined()
    expect(GateSchema).toBeDefined()
    expect(DecisionSchema).toBeDefined()
    expect(TicketSchema).toBeDefined()
    expect(RequirementSchema).toBeDefined()
    expect(ConceptIndexSchema).toBeDefined()
    expect(DesignNoteKind).toBeDefined()
    expect(JournalEventSchema).toBeDefined()
  })

  it('exports all layout utilities', () => {
    expect(DEFAULT_TRACKER_PATH).toBe('.groundwork')
    expect(motiveDir).toBeTypeOf('function')
    expect(sliceNotePath).toBeTypeOf('function')
    expect(gateNotePath).toBeTypeOf('function')
    expect(ticketPath).toBeTypeOf('function')
    expect(conceptIndexPath).toBeTypeOf('function')
    expect(requirementPath).toBeTypeOf('function')
    expect(designDir).toBeTypeOf('function')
    expect(designMocPath).toBeTypeOf('function')
    expect(specDecisionPath).toBeTypeOf('function')
    expect(glossaryPath).toBeTypeOf('function')
    expect(resolveTracker).toBeTypeOf('function')
  })
})

// ============================================================
// AC3: Decision-id normalization
// ============================================================
describe('AC3 — decision-id normalization', () => {
  it('passes canonical D-n unchanged', () => {
    const r = DecisionSchema.parse({ id: 'D-1' })
    expect(r.id).toBe('D-1')
  })

  it('passes canonical D-13 unchanged', () => {
    const r = DecisionSchema.parse({ id: 'D-13' })
    expect(r.id).toBe('D-13')
  })

  it('normalizes legacy D1 → D-1', () => {
    const r = DecisionSchema.parse({ id: 'D1' })
    expect(r.id).toBe('D-1')
  })

  it('normalizes legacy D8 → D-8', () => {
    const r = DecisionSchema.parse({ id: 'D8' })
    expect(r.id).toBe('D-8')
  })

  it('normalizes legacy D15 → D-15 (beyond original D1..D8 range)', () => {
    const r = DecisionSchema.parse({ id: 'D15' })
    expect(r.id).toBe('D-15')
  })

  it('passes unknown id format unchanged', () => {
    const r = DecisionSchema.parse({ id: 'SOME-OTHER' })
    expect(r.id).toBe('SOME-OTHER')
  })
})

// ============================================================
// AC4: gray-matter round-trip with unusual YAML
// ============================================================
describe('AC4 — gray-matter round-trip', () => {
  const fixture = `---
id: "my-concept: special"
title: 'quoted with colon: inside'
summary: |
  Multi-line
  value here
links:
  - "[[note-one]]"
  - "[[note-two]]"
tags:
  - alpha
  - beta
date_updated: 2026-08-29
status: draft
nested:
  key: value
  list:
    - a
    - b
---

# Body content

This body is preserved exactly.
`

  it('parses unusual YAML without data loss', () => {
    const parsed = matter(fixture)
    expect(parsed.data.id).toBe('my-concept: special')
    expect(parsed.data.title).toBe('quoted with colon: inside')
    expect(parsed.data.summary).toContain('Multi-line')
    expect(parsed.data.links).toEqual(['[[note-one]]', '[[note-two]]'])
    expect(parsed.data.tags).toEqual(['alpha', 'beta'])
    expect(parsed.data.status).toBe('draft')
    expect(parsed.data.nested).toEqual({ key: 'value', list: ['a', 'b'] })
  })

  it('body content is byte-identical after round-trip', () => {
    const parsed = matter(fixture)
    // Stringify back and re-parse — body must survive
    const stringified = matter.stringify(parsed.content, parsed.data)
    const reparsed = matter(stringified)
    expect(reparsed.content).toBe(parsed.content)
  })

  it('data values survive re-parse (semantic round-trip)', () => {
    const parsed = matter(fixture)
    const stringified = matter.stringify(parsed.content, parsed.data)
    const reparsed = matter(stringified)
    // Wikilink strings survive as strings
    expect(reparsed.data.links).toEqual(['[[note-one]]', '[[note-two]]'])
    // Nested structures survive
    expect(reparsed.data.nested).toEqual({ key: 'value', list: ['a', 'b'] })
    // id with colon survives
    expect(reparsed.data.id).toBe('my-concept: special')
  })
})

// ============================================================
// AC8: No frontmatter z.object() definitions outside src/gw/schema/
// ============================================================
describe('AC8 — frontmatter schema monopoly', () => {
  it('no z.object( definitions exist outside src/gw/schema/', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const repoRoot = '/home/newman/.local/share/groundwork'
    const srcDir = join(repoRoot, 'src')

    // Allowlist: these paths may contain z.object() legitimately
    const ALLOWLIST = [
      join(srcDir, 'gw', 'schema'),
    ]

    async function* walkTs(dir: string): AsyncGenerator<string> {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) yield* walkTs(full)
        else if (e.name.endsWith('.ts')) yield full
      }
    }

    const violations: string[] = []
    for await (const file of walkTs(srcDir)) {
      // Skip allowlisted paths
      if (ALLOWLIST.some(p => file.startsWith(p))) continue
      const content = await readFile(file, 'utf8')
      if (content.includes('z.object(')) {
        violations.push(file.replace(repoRoot + '/', ''))
      }
    }

    expect(violations, `Found z.object() frontmatter defs outside schema/: ${violations.join(', ')}`).toEqual([])
  })
})
