import { describe, test, expect } from 'bun:test'
import { checkProse } from './prose.js'
import { MAX_PR_WORDS } from './index.js'

const filler = (n: number) => Array.from({ length: n }, (_, i) => `W${i}${(i + 1) % 20 === 0 ? '.' : ''}`).join(' ')
const CAP = 'body has'
const capFindings = (md: string, pr = true) => checkProse(md, { pr }).filter((f) => f.reason.includes(CAP))
/** `## Why`, `One.` and `## Scope` make 3 words. */
const withWords = (total: number, extra = '') => `## Why\n\nOne.\n\n## Scope\n\n${filler(total - 3)}.\n${extra}`
const atCap = (extra: string) => withWords(200, `\n${extra}\n`)

describe('PR body word cap', () => {
  test('the limit is exported and 200 words pass', () => {
    expect(MAX_PR_WORDS).toBe(200)
    expect(checkProse(withWords(200), { pr: true })).toEqual([])
  })

  test('201 words give one finding with the count and the limit', () => {
    expect(checkProse(withWords(201), { pr: true })).toEqual([{ quote: 'PR body', reason: 'body has 201 words; the limit is 200' }])
  })

  test('applies only with pr: true', () => {
    expect(capFindings(withWords(400), false)).toEqual([])
  })

  test('a long details block with blank lines does not count', () => {
    expect(capFindings(atCap(`<details>\n<summary>Log</summary>\n\n${filler(500)}.\n\n- ${filler(15)}.\n\n</details>`))).toEqual([])
  })

  test('a details block on one line does not count', () => {
    expect(capFindings(atCap(`<details><summary>Log</summary>${filler(500)}</details>`))).toEqual([])
  })

  test('a details block under a bullet does not count, and the bullet does', () => {
    expect(capFindings(atCap(`<details>\n\n${filler(300)}.\n\n</details>`))).toEqual([])
    const nested = `## Why\n\nOne.\n\n## Scope\n\n- Two.\n\n  <details>\n\n  ${filler(300)}.\n\n  </details>\n`
    expect(capFindings(nested)).toEqual([])
    expect(capFindings(`${nested}\n${filler(197)}.\n`).map((f) => f.reason)).toEqual(['body has 201 words; the limit is 200'])
  })

  test('counting resumes after a details block closes', () => {
    expect(capFindings(atCap(`<details>\n\n${filler(50)}.\n\n</details>\n\nExtra.`)).map((f) => f.reason)).toEqual(['body has 201 words; the limit is 200'])
  })

  test('a long URL does not count and a link counts by its label', () => {
    const url = `https://example.com/${filler(300).replaceAll(' ', '/').replaceAll('.', '')}`
    expect(capFindings(`## Why\n\nOne.\n\n## Scope\n\n${filler(195)}.\n\n[two words](${url})\n`)).toEqual([])
    expect(capFindings(`## Why\n\nOne.\n\n## Scope\n\n${filler(195)}.\n\n[three whole words](${url})\n`).map((f) => f.reason)).toEqual(['body has 201 words; the limit is 200'])
  })

  test('fenced code and images do not count', () => {
    expect(capFindings(atCap(`\`\`\`\n${filler(300)}\n\`\`\``))).toEqual([])
    expect(capFindings(atCap(`![${filler(100)}](https://example.com/a.png)`))).toEqual([])
  })

  test('a heading counts', () => {
    expect(capFindings(atCap('### Extra')).map((f) => f.reason)).toEqual(['body has 201 words; the limit is 200'])
  })

  test('a code span counts as one word', () => {
    expect(capFindings(atCap('`a b c d e f g h`')).map((f) => f.reason)).toEqual(['body has 201 words; the limit is 200'])
  })

  test('a table or raw HTML cannot hide prose from the count', () => {
    expect(capFindings(atCap('| Extra |\n|---|\n| More |')).map((f) => f.reason)).toEqual(['body has 202 words; the limit is 200'])
    expect(capFindings(atCap('<div>Extra words</div>')).map((f) => f.reason)).toEqual(['body has 202 words; the limit is 200'])
  })

  test('an HTML comment does not count', () => {
    expect(capFindings(atCap(`<!-- ${filler(50)} -->`))).toEqual([])
  })
})
