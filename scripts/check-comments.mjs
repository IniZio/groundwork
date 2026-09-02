#!/usr/bin/env node
/**
 * check-comments.mjs — advisory comment-density checker.
 *
 * Walks all tracked .ts, .mjs, .js files and reports two findings:
 *   (a) Files whose comment-to-code ratio exceeds RATIO_THRESHOLD.
 *   (b) Files whose largest contiguous block-comment dominates BLOCK_SHARE_THRESHOLD.
 *
 * Always exits 0 — advisory only, does not fail the build.
 *
 * Usage:
 *   node scripts/check-comments.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { fileMetrics } from '../hooks/lib/comment-scan.mjs'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

// Calibrated against this repo: 45% ratio → ~21 findings; 20% block-share → ~12 findings.
const RATIO_THRESHOLD = 0.45
const BLOCK_SHARE_THRESHOLD = 0.20

const MIN_LINES = 40

const allFiles = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(f => /\.(ts|mjs|js)$/.test(f))

let ratioFindings = 0
let blockShareFindings = 0

for (const relpath of allFiles) {
  const abs = resolve(REPO_ROOT, relpath)
  let src
  try {
    src = readFileSync(abs, 'utf8')
  } catch {
    continue
  }

  const m = fileMetrics(src)
  if (m.commentLines + m.codeLines < MIN_LINES) continue

  if (m.ratio >= RATIO_THRESHOLD) {
    const pct = (m.ratio * 100).toFixed(1)
    console.log(`${relpath}: comment ratio ${pct}% (threshold 45%)`)
    ratioFindings++
  }

  if (m.blockShare >= BLOCK_SHARE_THRESHOLD) {
    const pct = (m.blockShare * 100).toFixed(1)
    console.log(
      `${relpath}: largest block-comment is ${m.largestBlock} lines (${pct}% of file) starting at line ${m.largestBlockStart} (threshold 20%)`
    )
    blockShareFindings++
  }
}

console.log(
  `check-comments: ${ratioFindings} ratio finding(s), ${blockShareFindings} block-share finding(s) — advisory only, build not failed`
)
process.exit(0)
