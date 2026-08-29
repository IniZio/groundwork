import { describe, it, expect } from 'vitest'
import { wikilink, escapeTarget, escapeAlias } from '../../src/gw/fm/wikilink.js'
import { setPropertyInContent } from '../../src/gw/fm/set-property.js'

// ============================================================
// AC6: Wikilink formatter
// ============================================================
describe('AC6 — escapeTarget (direct)', () => {
  it('escapes ^ in target as %5E', () => {
    expect(escapeTarget('a^b')).toBe('a%5Eb')
  })
  it('escapes [ in target as %5B', () => {
    expect(escapeTarget('a[b')).toBe('a%5Bb')
  })
  it('escapes ] in target as %5D', () => {
    expect(escapeTarget('a]b')).toBe('a%5Db')
  })
})

describe('AC6 — escapeAlias (direct)', () => {
  it('escapes # in alias as %23', () => {
    expect(escapeAlias('a#b')).toBe('a%23b')
  })
  it('escapes | in alias as %7C', () => {
    expect(escapeAlias('a|b')).toBe('a%7Cb')
  })
  it('escapes ^ in alias as %5E', () => {
    expect(escapeAlias('a^b')).toBe('a%5Eb')
  })
  it('escapes [ in alias as %5B', () => {
    expect(escapeAlias('a[b')).toBe('a%5Bb')
  })
  it('escapes ] in alias as %5D', () => {
    expect(escapeAlias('a]b')).toBe('a%5Db')
  })
})

describe('AC6 — wikilink', () => {
  // Strip cases
  it('strips .md extension from target', () => {
    expect(wikilink('note.md')).toBe('[[note]]')
  })

  it('strips .txt extension from target', () => {
    expect(wikilink('note.txt')).toBe('[[note]]')
  })

  // Escape chars in target (^, [, ])
  it('escapes ^ in target as %5E', () => {
    expect(wikilink('note^block')).toBe('[[note%5Eblock]]')
  })

  it('escapes [ in target as %5B', () => {
    expect(wikilink('note[sub')).toBe('[[note%5Bsub]]')
  })

  it('escapes ] in target as %5D', () => {
    expect(wikilink('note]sub')).toBe('[[note%5Dsub]]')
  })

  // Escape chars in alias (all 5: #, |, ^, [, ])
  it('escapes # in alias as %23', () => {
    expect(wikilink('note', 'heading#anchor')).toBe('[[note|heading%23anchor]]')
  })

  it('escapes | in alias as %7C', () => {
    expect(wikilink('note', 'alias|pipe')).toBe('[[note|alias%7Cpipe]]')
  })

  it('escapes ^ in alias as %5E', () => {
    expect(wikilink('note', 'ref^block')).toBe('[[note|ref%5Eblock]]')
  })

  it('escapes [ in alias as %5B', () => {
    expect(wikilink('note', 'text[inner')).toBe('[[note|text%5Binner]]')
  })

  it('escapes ] in alias as %5D', () => {
    expect(wikilink('note', 'text]end')).toBe('[[note|text%5Dend]]')
  })

  // No alias
  it('produces [[target]] when no alias given', () => {
    expect(wikilink('my-note')).toBe('[[my-note]]')
  })

  // With alias
  it('produces [[target|alias]] when alias given', () => {
    expect(wikilink('my-note', 'My Note')).toBe('[[my-note|My Note]]')
  })
})

// ============================================================
// AC5: set-property — surgical frontmatter write
// ============================================================
describe('AC5 — setPropertyInContent', () => {
  const BASE = `---
# comment preserved
id: original-id
title: "My Title"
tags:
  - alpha
  - beta
status: open
---

# Body

Body content here.
`

  it('replace: changes only the target key; all other lines byte-identical', () => {
    const result = setPropertyInContent(BASE, 'status', 'done')
    const originalLines = BASE.split('\n')
    const resultLines = result.split('\n')

    // Find the status line in result
    const statusIdx = resultLines.findIndex(l => l.startsWith('status:'))
    expect(resultLines[statusIdx]).toBe('status: done')

    // Every line NOT the status line must be byte-identical
    const originalStatusIdx = originalLines.findIndex(l => l.startsWith('status:'))
    for (let i = 0; i < Math.max(originalLines.length, resultLines.length); i++) {
      if (i === originalStatusIdx) continue  // this is the changed line
      expect(resultLines[i], `Line ${i} changed unexpectedly`).toBe(originalLines[i])
    }
  })

  it('replace: replaces multi-line value (list) with scalar', () => {
    const result = setPropertyInContent(BASE, 'tags', 'single-tag')
    // tags was a multi-line list; now should be single scalar
    expect(result).toContain('tags: single-tag')
    // Old list items must be gone
    expect(result).not.toContain('  - alpha')
    expect(result).not.toContain('  - beta')
  })

  it('add-new-key: inserts key before closing --- when key absent', () => {
    const result = setPropertyInContent(BASE, 'wave', 2)
    expect(result).toContain('wave: 2')
    // Comment and other lines still present
    expect(result).toContain('# comment preserved')
    expect(result).toContain('id: original-id')
    expect(result).toContain('title: "My Title"')
  })

  it('delete: removes key and its lines; other lines byte-identical', () => {
    const result = setPropertyInContent(BASE, 'tags', undefined)
    // tags key and its list items gone
    expect(result).not.toContain('tags:')
    expect(result).not.toContain('  - alpha')
    // Other lines preserved
    expect(result).toContain('# comment preserved')
    expect(result).toContain('id: original-id')
    expect(result).toContain('title: "My Title"')
    expect(result).toContain('status: open')
  })

  it('delete: no-op when key absent', () => {
    const result = setPropertyInContent(BASE, 'nonexistent', undefined)
    expect(result).toBe(BASE)
  })

  it('add-new-key: list value serialized as YAML block list', () => {
    const result = setPropertyInContent(BASE, 'decisions', ['D-1', 'D-2'])
    expect(result).toContain('decisions:')
    expect(result).toContain('  - D-1')
    expect(result).toContain('  - D-2')
  })

  it('wikilink value is quoted to prevent YAML parse error', () => {
    const result = setPropertyInContent(BASE, 'concept', '[[orchestration/index]]')
    expect(result).toContain('concept: "[[orchestration/index]]"')
  })
})
