import { describe, it, expect } from 'vitest'
import { classifyLines, fileMetrics } from '../../hooks/lib/comment-scan.mjs'

describe('classifyLines', () => {
  it('blank line → blank', () => {
    expect(classifyLines('')).toEqual(['blank'])
  })

  it('whitespace-only line → blank', () => {
    expect(classifyLines('   ')).toEqual(['blank'])
  })

  it('// comment → line-comment', () => {
    expect(classifyLines('// hello world')).toEqual(['line-comment'])
  })

  it('#! shebang → line-comment', () => {
    expect(classifyLines('#!/usr/bin/env node')).toEqual(['line-comment'])
  })

  it('/* block */ on one line → block-comment', () => {
    expect(classifyLines('/* inline block */')).toEqual(['block-comment'])
  })

  it('multi-line /* ... */ block: opener, body, closer all → block-comment', () => {
    const src = '/*\n * body line\n */'
    expect(classifyLines(src)).toEqual(['block-comment', 'block-comment', 'block-comment'])
  })

  it('/** JSDoc */ multi-line → all block-comment', () => {
    const src = '/**\n * JSDoc body.\n */'
    expect(classifyLines(src)).toEqual(['block-comment', 'block-comment', 'block-comment'])
  })

  it('export const x = 1 → code', () => {
    expect(classifyLines('export const x = 1')).toEqual(['code'])
  })

  it('mixed: returns correct per-line kinds', () => {
    const src = [
      'export const x = 1', // code
      '// a comment',        // line-comment
      '',                    // blank
      '/* block */',         // block-comment
    ].join('\n')
    expect(classifyLines(src)).toEqual(['code', 'line-comment', 'blank', 'block-comment'])
  })

  it('trailing newline produces a trailing blank entry', () => {
    const kinds = classifyLines('const x = 1\n')
    expect(kinds).toEqual(['code', 'blank'])
  })
})

describe('fileMetrics', () => {
  it('pure code file → ratio=0, largestBlock=0', () => {
    const src = 'const x = 1\nconst y = 2\nconst z = 3\n'
    const m = fileMetrics(src)
    expect(m.ratio).toBe(0)
    expect(m.commentLines).toBe(0)
    expect(m.codeLines).toBe(3)
    expect(m.largestBlock).toBe(0)
    expect(m.largestBlockStart).toBe(0)
    expect(m.blockShare).toBe(0)
  })

  it('all line-comments → ratio=1', () => {
    const src = '// a\n// b\n// c\n'
    const m = fileMetrics(src)
    expect(m.ratio).toBe(1)
    expect(m.commentLines).toBe(3)
    expect(m.codeLines).toBe(0)
  })

  it('50% ratio file → ratio ≈ 0.5', () => {
    const src = '// comment\nconst x = 1\n// comment\nconst y = 2\n'
    const m = fileMetrics(src)
    expect(m.ratio).toBeCloseTo(0.5)
    expect(m.commentLines).toBe(2)
    expect(m.codeLines).toBe(2)
  })

  it('blank lines do NOT count in ratio denominator', () => {
    // 1 comment + 1 code + 3 blanks → nonBlankLines=2, ratio=0.5
    const src = '// comment\n\n\n\nconst x = 1\n'
    const m = fileMetrics(src)
    expect(m.ratio).toBeCloseTo(0.5)
    expect(m.commentLines).toBe(1)
    expect(m.codeLines).toBe(1)
  })

  it('blockShare: 6-line block comment after 5 code lines has correct largestBlock, largestBlockStart, blockShare', () => {
    // Lines 1-5: code; lines 6-11: block comment (/* through */)
    const codeLines = ['const x0 = 0', 'const x1 = 1', 'const x2 = 2', 'const x3 = 3', 'const x4 = 4'].join('\n')
    const blockComment = '/*\n * line 1\n * line 2\n * line 3\n * line 4\n */'
    const src = codeLines + '\n' + blockComment + '\n'
    const m = fileMetrics(src)
    // 5 code + 6 block-comment = 11 non-blank lines
    expect(m.codeLines).toBe(5)
    expect(m.commentLines).toBe(6)
    expect(m.largestBlock).toBe(6)
    expect(m.largestBlockStart).toBe(6) // 1-based: block starts at line 6
    expect(m.blockShare).toBeCloseTo(6 / 11)
  })

  it('largestBlockStart is 0 when no block-comment lines exist', () => {
    const src = '// line comment\nconst x = 1\n'
    const m = fileMetrics(src)
    expect(m.largestBlock).toBe(0)
    expect(m.largestBlockStart).toBe(0)
  })

  it('blockShare = largestBlock / (commentLines + codeLines)', () => {
    // 4 code lines, then a 4-line block comment → blockShare = 4/8 = 0.5
    const src = 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\n/*\n * x\n * y\n */'
    const m = fileMetrics(src)
    expect(m.codeLines).toBe(4)
    expect(m.largestBlock).toBe(4)
    expect(m.blockShare).toBeCloseTo(4 / 8)
  })
})
