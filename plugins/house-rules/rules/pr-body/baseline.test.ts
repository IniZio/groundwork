import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkProse } from './prose.js'

const FIXTURES = resolve(import.meta.dir, '../../test/fixtures/pr-body')
const baseline = (md: string, pr = true) =>
  checkProse(md, { pr }).filter((f) => f.reason.includes('baseline'))
const body = (verification: string) => `## Why\n\nA.\n\n## Scope\n\nB.\n\n## Verification\n\n${verification}`

describe('baseline check findings in a PR body', () => {
  test('the moor 956 body flags both baseline commands reported as passing', () => {
    const found = baseline(readFileSync(resolve(FIXTURES, 'moor-956-dense.md'), 'utf8'))
    expect(found.map((f) => f.quote).some((q) => q.includes('`make lint`: pass.'))).toBe(true)
    expect(found.map((f) => f.quote).some((q) => q.includes('`cargo test -p moor exec` (67)') && q.endsWith('pass.'))).toBe(true)
    expect(found).toHaveLength(2)
    expect(found[0]?.reason).toContain('CI already shows baseline checks')
  })

  test('the re-headed 421 body keeps its commands in a fence and passes', () => {
    expect(checkProse(readFileSync(resolve(FIXTURES, 'moor-421-reheaded.md'), 'utf8'), { pr: true })).toEqual([])
  })

  test('a baseline command in a fence is not flagged even beside a pass word', () => {
    expect(baseline(body('```\nmake test\n```\n\nAll green.'))).toEqual([])
  })

  test('a baseline command with no pass word is not flagged', () => {
    expect(baseline(body('`cargo test` found a race that the live run then confirmed.'))).toEqual([])
  })

  test('each listed baseline command with a pass word is flagged, in prose or in a list', () => {
    expect(baseline(body('`bun test` passes.'))).toHaveLength(1)
    expect(baseline(body('- `go vet` clean.\n- `pytest` ✅'))).toHaveLength(2)
    expect(baseline(body('Running pnpm test was green.'))).toHaveLength(1)
    expect(baseline(body('`tsc` is ok.'))).toHaveLength(1)
  })

  test('the check applies to PR bodies only', () => {
    expect(baseline(body('`make lint`: pass.'), false)).toEqual([])
  })

  test('a pass word without a baseline command is not flagged', () => {
    expect(baseline(body('The live run passed on a separate controller.'))).toEqual([])
  })
})
