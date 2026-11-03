import { describe, test, expect } from 'bun:test'
import { checkProse } from './prose.js'

const reasons = (md: string, pr = false) => checkProse(md, { pr }).map((f) => f.reason)
const hasReason = (md: string, part: string, pr = false) => reasons(md, pr).some((r) => r.includes(part))
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('checkProse', () => {
  test('a sentence of 25 words passes and one of 26 reports its count', () => {
    expect(reasons(`${words(25)}.`)).toEqual([])
    const f = checkProse(`${words(26)}.`, { pr: false })
    expect(f).toHaveLength(1)
    expect(f[0]?.reason).toContain('26 words')
    expect(f[0]?.quote).toBe(`${words(26)}.`)
  })

  test('a code span counts as one word', () => {
    expect(reasons(`${words(24)} \`a b c d e f\`.`)).toEqual([])
  })

  test('a semicolon in prose is flagged and one inside code is not', () => {
    expect(hasReason('The log is read; the frame is sent.', 'semicolon')).toBe(true)
    expect(hasReason('Run `a; b` now.', 'semicolon')).toBe(false)
    expect(hasReason('```\na; b\n```', 'semicolon')).toBe(false)
  })

  test('a mid-sentence colon is flagged and a colon before a list is not', () => {
    expect(hasReason('One thing changed: the count.', 'colon')).toBe(true)
    expect(reasons('Two things changed:\n\n- one\n- two')).toEqual([])
    expect(hasReason('Open http://example.com now.', 'colon')).toBe(false)
  })

  test('a table, fenced code and a link target are skipped', () => {
    const md = `| a | b |\n|---|---|\n| x; y | ${words(40)} |\n\n\`\`\`\n${words(40)};\n\`\`\`\n\nSee [the doc](https://example.com/a;b/c:d).`
    expect(reasons(md)).toEqual([])
  })

  test('only the link label words count toward the limit', () => {
    expect(reasons(`See [${words(5)}](https://example.com/${words(40).replaceAll(' ', '/')}).`)).toEqual([])
  })

  test('bare path:line and a backticked path outside a link label are flagged', () => {
    expect(hasReason('See src/a.rs:12 for it.', 'path:line')).toBe(true)
    expect(hasReason('See src/a.rs@11fb9fe7:12 for it.', 'path:line')).toBe(true)
    expect(hasReason('See `src/a.rs` for it.', 'backticked path')).toBe(true)
    expect(reasons('See [`src/a.rs`](https://github.com/o/r/blob/11fb9fe7/src/a.rs#L1) for it.')).toEqual([])
    expect(reasons('Run `moor run <box>` and read `runs/<id>.log`.')).toEqual([])
  })

  test('a backticked git ref is not a path, but a nested file or directory is', () => {
    expect(reasons('It diffs against `origin/HEAD` and `refs/heads/main`.')).toEqual([])
    expect(reasons('The base is `origin/develop` now.')).toEqual([])
    expect(hasReason('Edit `.claude-plugin/plugin.json` too.', 'backticked path')).toBe(true)
    expect(hasReason('Everything under `src/hooks/` moved.', 'backticked path')).toBe(true)
  })

  test('a blob link needs a commit sha ref', () => {
    expect(hasReason('See [x](https://github.com/o/r/blob/main/a.rs).', 'not a commit sha')).toBe(true)
    expect(hasReason('See [x](https://github.com/o/r/blob/abc12/a.rs).', 'not a commit sha')).toBe(true)
    expect(hasReason('See [x](https://github.com/o/r/blob/11fb9fe7/a.rs).', 'not a commit sha')).toBe(false)
    expect(hasReason('See https://github.com/o/r/blob/main/a.rs now.', 'not a commit sha')).toBe(true)
  })

  test('PR bodies need Why and Scope and may use only the allowed headings', () => {
    expect(reasons('## Why\n\nA.\n\n## Scope\n\nB.', true)).toEqual([])
    expect(hasReason('## Why\n\nA.', 'no "## Scope"', true)).toBe(true)
    expect(hasReason('## Scope\n\nA.', 'no "## Why"', true)).toBe(true)
    expect(hasReason('## Why\n\nA.\n\n## Scope\n\nB.\n\n## Notes\n\nC.', 'not allowed', true)).toBe(true)
    expect(reasons('## Notes\n\nA.', false)).toEqual([])
  })

  test('headings never count as prose sentences', () => {
    expect(reasons(`## Why\n\nA.\n\n## Scope\n\nB.\n\n### ${words(40)}`, true)).toEqual([])
  })
})
