import { describe, test, expect } from 'bun:test'
import { checkProse } from './prose.js'
import { cases } from './cases.js'

const reasons = (md: string, pr = true) => checkProse(md, { pr }).map((f) => f.reason)
const body = (why: string, changed?: string) =>
  `## Why\n\n${why}\n\n${changed === undefined ? '' : `## What changed\n\n${changed}\n\n`}## Scope\n\nOne file.`
const bullets = (n: number) => Array.from({ length: n }, (_, i) => `- Item ${i}.`).join('\n')

describe('## Why holds 1-3 sentences', () => {
  test('3 sentences pass and 4 report the count in the existing format', () => {
    expect(reasons(body('One. Two. Three.'))).toEqual([])
    const found = checkProse(body('One. Two. Three. Four.'), { pr: true })
    expect(found).toEqual([{ quote: '## Why', reason: 'section has 4 sentences; the limit is 1-3' }])
  })

  test('sentences add up across paragraphs and list items', () => {
    expect(reasons(body('One. Two.\n\nThree.'))).toEqual([])
    expect(reasons(body('One. Two.\n\nThree.\n\n- Four.'))).toEqual(['section has 4 sentences; the limit is 1-3'])
  })

  test('a repeated heading cannot split the count', () => {
    expect(reasons('## Why\n\nOne. Two.\n\n## Scope\n\nA.\n\n## Why\n\nThree. Four.')).toEqual(['section has 4 sentences; the limit is 1-3'])
  })

  test('a sub-heading stays inside the section', () => {
    expect(reasons('## Why\n\nOne. Two.\n\n### More\n\nThree. Four.\n\n## Scope\n\nA.')).toEqual(['section has 4 sentences; the limit is 1-3'])
  })

  test('fenced code never counts, so a log can sit beside 3 sentences', () => {
    const log = '```\nFirst log line. Second log line.\nThird log line. Fourth log line. Fifth log line.\n```'
    expect(reasons(body(`One. Two.\n\n${log}\n\nThree.`))).toEqual([])
    expect(reasons(body(`One. Two.\n\n${log}\n\nThree. Four.`))).toEqual(['section has 4 sentences; the limit is 1-3'])
  })

  test('an empty section reports 0', () => {
    expect(reasons('## Why\n\n## Scope\n\nA.')).toEqual(['section has 0 sentences; the limit is 1-3'])
  })

  test('applies only with pr: true, and other sections are not counted', () => {
    expect(reasons(body('One. Two. Three. Four.'), false)).toEqual([])
    expect(reasons('## Why\n\nOne.\n\n## Scope\n\nA. B. C. D. E.')).toEqual([])
  })
})

describe('## What changed holds 1-3 bullets', () => {
  test('3 bullets pass and 4 report the count in the existing format', () => {
    expect(reasons(body('One.', bullets(3)))).toEqual([])
    expect(checkProse(body('One.', bullets(4)), { pr: true })).toEqual([{ quote: '## What changed', reason: 'section has 4 bullets; the limit is 1-3' }])
  })

  test('a loose list counts the same as a tight one', () => {
    expect(reasons(body('One.', '- A.\n\n- B.\n\n- C.\n\n- D.'))).toEqual(['section has 4 bullets; the limit is 1-3'])
  })

  test('a numbered list counts as bullets', () => {
    expect(reasons(body('One.', '1. A.\n2. B.\n3. C.\n4. D.'))).toEqual(['section has 4 bullets; the limit is 1-3'])
  })

  test('a nested bullet counts as its own bullet', () => {
    expect(reasons(body('One.', '- A.\n  - B.\n  - C.\n- D.'))).toEqual(['section has 4 bullets; the limit is 1-3'])
  })

  test('a paragraph beside bullets does not count, so a diff link fits', () => {
    expect(reasons(body('One.', `${bullets(3)}\n\n[Files changed](https://github.com/o/r/pull/1/files)`))).toEqual([])
  })

  test('paragraphs with no bullet report 0', () => {
    expect(reasons(body('One.', 'A paragraph instead of bullets.'))).toEqual(['section has 0 bullets; the limit is 1-3'])
  })

  test('the section stays optional', () => {
    expect(reasons(body('One.'))).toEqual([])
  })
})

describe('cases.ts replayed through the real checker', () => {
  for (const c of cases.valid) {
    test(`valid: ${c.why}`, () => {
      expect(reasons(c.code ?? '')).toEqual([])
    })
  }
  for (const c of cases.invalid) {
    test(`invalid: ${c.why}`, () => {
      expect(reasons(c.code ?? '')).toEqual((c.findings ?? []).map((f) => f.message ?? ''))
    })
  }
})
