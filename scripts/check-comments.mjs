#!/usr/bin/env node
/**
 * check-comments.mjs — advisory comment-density checker.
 *
 * Walks all tracked .ts, .mjs, .js files and reports two findings:
 *   (a) Files whose comment-to-code ratio exceeds RATIO_THRESHOLD.
 *   (b) Files whose largest contiguous block-comment dominates BLOCK_SHARE_THRESHOLD.
 *
 * Always exits 0 in advisory mode — does not fail the build.
 *
 * Usage:
 *   node scripts/check-comments.mjs            # advisory, always exits 0
 *   node scripts/check-comments.mjs --strict   # exits 1 if any non-exempt file exceeds
 *                                               # RATIO_STRICT or BLOCK_SHARE_STRICT
 *
 * Exemption pragma:
 *   Add the comment  // check-comments-exempt  anywhere in a file to exempt it from
 *   strict enforcement. Use this for hook libs and test files whose high comment density
 *   is intentional (complex invariants, inline documentation, fixture-heavy tests).
 *   Advisory output still prints for exempt files; they just do not cause exit 1.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { fileMetrics } from '../hooks/lib/comment-scan.mjs'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

// Advisory thresholds (unchanged — exits 0 always).
// Calibrated against this repo: 45% ratio → ~21 findings; 20% block-share → ~12 findings.
const RATIO_THRESHOLD = 0.45
const BLOCK_SHARE_THRESHOLD = 0.20

// Strict thresholds — fires only on egregiously over-commented files.
// At 60%+ ratio, only 5 hooks/lib files hit; at 30%+ block-share, only 4 files hit.
// These earn the // check-comments-exempt pragma. Future sloppy files fail without it.
const RATIO_STRICT = 0.60
const BLOCK_SHARE_STRICT = 0.30

const MIN_LINES = 40

const strict = process.argv.includes('--strict')

const allFiles = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(f => /\.(ts|mjs|js)$/.test(f))

let ratioFindings = 0
let blockShareFindings = 0
let strictFailures = 0

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

  const isExempt = src.includes('check-comments-exempt')

  if (m.ratio >= RATIO_THRESHOLD) {
    const pct = (m.ratio * 100).toFixed(1)
    console.log(`${relpath}: comment ratio ${pct}% (threshold 45%)`)
    ratioFindings++
    if (strict && !isExempt && m.ratio >= RATIO_STRICT) {
      console.log(`  [strict] FAIL: ratio ${pct}% >= 60% and no exemption pragma`)
      strictFailures++
    }
  }

  if (m.blockShare >= BLOCK_SHARE_THRESHOLD) {
    const pct = (m.blockShare * 100).toFixed(1)
    console.log(
      `${relpath}: largest block-comment is ${m.largestBlock} lines (${pct}% of file) starting at line ${m.largestBlockStart} (threshold 20%)`
    )
    blockShareFindings++
    if (strict && !isExempt && m.blockShare >= BLOCK_SHARE_STRICT) {
      console.log(`  [strict] FAIL: block-share ${pct}% >= 30% and no exemption pragma`)
      strictFailures++
    }
  }
}

if (strict) {
  console.log(
    `check-comments: ${ratioFindings} ratio finding(s), ${blockShareFindings} block-share finding(s) — strict mode: ${strictFailures} failure(s)`
  )
  process.exit(strictFailures > 0 ? 1 : 0)
} else {
  console.log(
    `check-comments: ${ratioFindings} ratio finding(s), ${blockShareFindings} block-share finding(s) — advisory only, build not failed`
  )
  process.exit(0)
}
