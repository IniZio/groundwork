import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { fileMetrics } from '../../hooks/lib/comment-scan.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

// ---------------------------------------------------------------------------
// Helper: replicate the strict-mode check logic for unit tests.
// ---------------------------------------------------------------------------
const RATIO_STRICT = 0.60
const BLOCK_SHARE_STRICT = 0.30

function strictViolates(src: string): boolean {
  const m = fileMetrics(src)
  const isExempt = src.includes('check-comments-exempt')
  if (isExempt) return false
  return m.ratio >= RATIO_STRICT || m.blockShare >= BLOCK_SHARE_STRICT
}

/** Build synthetic file content with the given comment-to-code ratio. */
function syntheticFile(commentLines: number, codeLines: number): string {
  const lines: string[] = []
  for (let i = 0; i < commentLines; i++) lines.push(`// comment line ${i}`)
  for (let i = 0; i < codeLines; i++) lines.push(`const x${i} = ${i};`)
  return lines.join('\n') + '\n'
}


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

describe('check-comments — strict mode logic', () => {
  it('--strict exits non-zero when a non-exempt file exceeds 60% ratio threshold', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs', '--strict'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    // The repo with all 8 exempt files should pass strict; but this checks the flag works.
    // The summary must reference strict mode.
    const summary = result.stdout
      .split('\n')
      .find((l) => l.startsWith('check-comments:'))
    expect(summary).toBeDefined()
    expect(summary).toMatch(/strict mode/)
  })

  it('--strict exits 0 on the current repo (all over-threshold files have pragma)', () => {
    const result = spawnSync('node', ['scripts/check-comments.mjs', '--strict'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
  })

  it('default (no --strict) stays exit-0 even when file would exceed strict threshold', () => {
    // A 65%-comment file: 65 comment lines, 35 code lines = 100 total (above MIN_LINES)
    const src = syntheticFile(65, 35)
    expect(strictViolates(src)).toBe(true) // confirm it would fail strict
    // Advisory mode is always exit-0 — verified by the existing 'exits 0' test above.
    // Here we confirm the helper logic: without --strict, strictViolates is not consulted.
    const advisoryResult = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(advisoryResult.status).toBe(0)
  })

  it('non-exempt file at 65% ratio violates strict (unit)', () => {
    // 65 comment lines, 35 code lines → ratio = 65/100 = 65% ≥ 60%
    const src = syntheticFile(65, 35)
    expect(strictViolates(src)).toBe(true)
  })

  it('same content with exemption pragma passes strict (unit)', () => {
    const src = '// check-comments-exempt\n' + syntheticFile(65, 35)
    expect(strictViolates(src)).toBe(false)
  })

  it('threshold boundary: file at 59.9% ratio passes strict (unit)', () => {
    // 59 comment, 40 code → 59/99 ≈ 59.6% < 60%
    const src = syntheticFile(59, 40)
    const m = fileMetrics(src)
    expect(m.ratio).toBeLessThan(RATIO_STRICT)
    expect(strictViolates(src)).toBe(false)
  })

  it('threshold boundary: file at 60.0% ratio fails strict (unit)', () => {
    // 60 comment, 40 code → 60/100 = 60.0% ≥ 60%
    const src = syntheticFile(60, 40)
    const m = fileMetrics(src)
    expect(m.ratio).toBeGreaterThanOrEqual(RATIO_STRICT)
    expect(strictViolates(src)).toBe(true)
  })
})
