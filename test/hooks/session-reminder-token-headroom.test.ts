/**
 * Regression test: H22 — token-cap constants must stay calibrated to the
 * real worst-case payload (session with an active ledger holding bounded
 * incomplete slices).
 *
 * DEFECT FIXED (H22)
 * ──────────────────
 * H18 used session_id 'test-headroom-h18' which has no ledger, so the
 * ## ⚠ ACTIVE RUN block (appended before the cap check) was absent.
 * That inflated headroom to 504 while the real path measured only 202.
 * A few more incomplete-slice lines would have silently dropped the
 * spec skeleton without the test catching it.
 *
 * FIX
 * ───
 * 1. Bounded the ACTIVE RUN slice enumeration at ACTIVE_RUN_SLICE_CAP=10
 *    in hooks/session-reminder.mjs — payload size is now deterministic.
 * 2. This test uses a deterministic fixture ledger (10 incomplete slices,
 *    80-char behaviors) written to .groundwork/runs/ before the test and
 *    cleaned up after, so the measurement never reads live mutable state.
 *
 * INVARIANTS
 * ──────────
 * 1. Spec skeleton IS injected for the worst-case payload.
 * 2. Headroom (TOTAL_TOKEN_CAP − total) ≥ 200 tokens.
 *
 * MEASURED BASELINE (2026-09-04, H22, bounded at 10 slices)
 *   base=3306  skeleton=174  total=3480  headroom=320  cap=3800
 *
 * CONSTANTS (must stay in sync with hooks/session-reminder.mjs)
 *   TOTAL_TOKEN_CAP = 3800
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const HOOK = path.join(ROOT, 'hooks', 'session-reminder.mjs')
const FIXTURE_SRC = path.join(ROOT, 'test', 'fixtures', 'session-reminder-h22-ledger.json')
const FIXTURE_DEST = path.join(ROOT, '.groundwork', 'runs', 'test-h22-worst-case.json')

// Keep in sync with hooks/session-reminder.mjs
const TOTAL_TOKEN_CAP = 3800
const MIN_HEADROOM = 200

beforeAll(() => {
  fs.mkdirSync(path.dirname(FIXTURE_DEST), { recursive: true })
  fs.copyFileSync(FIXTURE_SRC, FIXTURE_DEST)
})

afterAll(() => {
  try { fs.unlinkSync(FIXTURE_DEST) } catch { /* ignore */ }
})

describe('session-reminder: token headroom regression (H22)', () => {
  it('spec skeleton injected and headroom >= 200 tokens for worst-case bounded payload', () => {
    const input = JSON.stringify({ session_id: 'test-h22-worst-case', cwd: ROOT })
    const result = spawnSync(process.execPath, [HOOK], {
      input,
      encoding: 'utf8',
    })

    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0)

    const output = JSON.parse(result.stdout)
    const ctx: string = output?.hookSpecificOutput?.additionalContext ?? ''

    // Invariant 1: ACTIVE RUN block must be present (fixture has active=true)
    expect(ctx, 'ACTIVE RUN block missing — fixture ledger not found').toContain('## ⚠ ACTIVE RUN')

    // Invariant 2: spec skeleton must be injected (not dropped)
    expect(ctx, 'spec skeleton dropped — TOTAL_TOKEN_CAP too low for worst-case payload').toContain('## Spec Skeleton')

    // Invariant 3: headroom >= MIN_HEADROOM
    const totalTokens = Math.ceil(Buffer.byteLength(ctx, 'utf8') / 3.5)
    const headroom = TOTAL_TOKEN_CAP - totalTokens
    expect(
      headroom,
      `only ${headroom} tokens of headroom (need >= ${MIN_HEADROOM}). ` +
        `totalTokens=${totalTokens}, cap=${TOTAL_TOKEN_CAP}. ` +
        `Re-scale TOTAL_TOKEN_CAP in hooks/session-reminder.mjs or reduce payload.`,
    ).toBeGreaterThanOrEqual(MIN_HEADROOM)
  })
})
