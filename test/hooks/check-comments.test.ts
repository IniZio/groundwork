import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

describe('check-comments — advisory contract', () => {
  it('exits 0 (advisory only, build not failed)', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
  })

  it('output contains the summary line in expected format', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const summary = result.stdout
      .split('\n')
      .find((l) => l.startsWith('check-comments:'))
    expect(summary).toBeDefined()
    expect(summary).toMatch(
      /check-comments: \d+ ratio finding\(s\), \d+ block-share finding\(s\) — advisory only, build not failed/,
    )
  })

  it('reports ≥1 ratio findings (repo always has some comment-heavy files)', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const summary = result.stdout
      .split('\n')
      .find((l) => l.startsWith('check-comments:'))!
    const match = summary.match(
      /check-comments: (\d+) ratio finding\(s\), (\d+) block-share finding\(s\)/,
    )
    expect(match).not.toBeNull()
    const ratioCount = parseInt(match![1], 10)
    expect(ratioCount).toBeGreaterThanOrEqual(1)
  })

  it('reports ≥1 block-share findings (repo always has large block-comment regions)', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const summary = result.stdout
      .split('\n')
      .find((l) => l.startsWith('check-comments:'))!
    const match = summary.match(
      /check-comments: (\d+) ratio finding\(s\), (\d+) block-share finding\(s\)/,
    )
    expect(match).not.toBeNull()
    const blockCount = parseInt(match![2], 10)
    expect(blockCount).toBeGreaterThanOrEqual(1)
  })
})
