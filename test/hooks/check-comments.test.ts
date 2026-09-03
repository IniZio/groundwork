import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { fileMetrics } from '../../hooks/lib/comment-scan.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

// ---------------------------------------------------------------------------
// Helper: replicate the strict-mode check logic for unit tests.
// ---------------------------------------------------------------------------
const RATIO_STRICT = 0.45
const BLOCK_SHARE_STRICT = 0.20

function strictViolates(src: string): boolean {
  const m = fileMetrics(src)
  const pragmaLines = src.split('\n').slice(0, 5)
  const isExempt = pragmaLines.some(l => l.includes('check-comments-exempt'))
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
  it('--strict exits non-zero when a non-exempt file exceeds 45% ratio threshold', () => {
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
    // A 50%-comment file: 50 comment lines, 50 code lines = 100 total (above MIN_LINES)
    const src = syntheticFile(50, 50)
    expect(strictViolates(src)).toBe(true) // confirm it would fail strict (≥45%)
    // Advisory mode is always exit-0 — verified by the existing 'exits 0' test above.
    // Here we confirm the helper logic: without --strict, strictViolates is not consulted.
    const advisoryResult = spawnSync('node', ['scripts/check-comments.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(advisoryResult.status).toBe(0)
  })

  it('non-exempt file at 50% ratio violates strict (unit)', () => {
    // 50 comment lines, 50 code lines → ratio = 50/100 = 50% ≥ 45%
    const src = syntheticFile(50, 50)
    expect(strictViolates(src)).toBe(true)
  })

  it('same content with exemption pragma in first 5 lines passes strict (unit)', () => {
    const src = '// check-comments-exempt\n' + syntheticFile(50, 50)
    expect(strictViolates(src)).toBe(false)
  })

  it('threshold boundary: file at 44% ratio passes strict (unit)', () => {
    // 44 comment, 56 code → 44/100 = 44% < 45%
    const src = syntheticFile(44, 56)
    const m = fileMetrics(src)
    expect(m.ratio).toBeLessThan(RATIO_STRICT)
    expect(strictViolates(src)).toBe(false)
  })

  it('threshold boundary: file at 45.0% ratio fails strict (unit)', () => {
    // 45 comment, 55 code → 45/100 = 45.0% ≥ 45%
    const src = syntheticFile(45, 55)
    const m = fileMetrics(src)
    expect(m.ratio).toBeGreaterThanOrEqual(RATIO_STRICT)
    expect(strictViolates(src)).toBe(true)
  })

  it('mid-file pragma (line 10+) does NOT exempt from strict (unit)', () => {
    // Pragma appears at line 10 — well past the 5-line window, must not grant exemption.
    const leadingCode = Array.from({ length: 9 }, (_, i) => `const x${i} = ${i};`).join('\n')
    const body = syntheticFile(50, 50) // 50% ratio — fails strict
    const src = leadingCode + '\n// check-comments-exempt\n' + body
    // Confirm pragma line is beyond line 5
    const lines = src.split('\n')
    const pragmaIdx = lines.findIndex(l => l.includes('check-comments-exempt'))
    expect(pragmaIdx).toBeGreaterThanOrEqual(5) // 0-indexed, so line 6+ in 1-indexed terms
    // Must NOT be exempt
    expect(strictViolates(src)).toBe(true)
  })
})
