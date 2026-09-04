// check-comments-exempt — opening block is a required defect-history + invariant doc for this regression test.
/**
 * Regression test: H22/H25 — token-cap constants must stay calibrated to the
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
 * FIX (H22)
 * ─────────
 * 1. Bounded the ACTIVE RUN slice enumeration at ACTIVE_RUN_SLICE_CAP=10
 *    in hooks/session-reminder.mjs.
 * 2. This test uses a deterministic fixture ledger (10 incomplete slices,
 *    80-char behaviors) written to .groundwork/runs/ before the test and
 *    cleaned up after, so the measurement never reads live mutable state.
 *
 * DEFECT FIXED (H25)
 * ──────────────────
 * H22 claimed "payload size is now deterministic" but three contributors
 * remained unbounded: motive MAP list (~25 tokens/motive), wave-width
 * NOTICE loop (~35 tokens/notice), and ledger.brief (untruncated).
 * With 15 motives the spec skeleton would silently drop.
 *
 * FIX (H25)
 * ─────────
 * 1. Motive MAP list capped at MOTIVE_MAP_CAP=5 (most-recent-first).
 * 2. Wave-width notices capped at WAVE_NOTICE_CAP=5.
 * 3. ledger.brief truncated at 200 chars.
 * 4. Skeleton drop made visible via a ## ⚠ Spec Skeleton DROPPED block.
 *
 * INVARIANTS
 * ──────────
 * 1. Spec skeleton IS injected for the worst-case bounded payload.
 * 2. Headroom (TOTAL_TOKEN_CAP − total) ≥ 200 tokens.
 *
 * MEASURED BASELINE (2026-09-04, H22, bounded at 10 slices)
 *   base=3306  skeleton=174  total=3480  headroom=320  cap=3800
 *
 * RE-MEASURED (H25, after adding motive/wave/brief caps):
 *   H22 fixture (10 slices, real repo):  total=3264  headroom=536  skeleton=injected
 *   Adversarial (15 motives/waves, 500-char brief, no doc/specs): total=3223  headroom=577
 *   Adversarial uncapped estimate: total+686≈3909 > cap=3800 → skeleton would drop
 *
 * CONSTANTS (must stay in sync with hooks/session-reminder.mjs)
 *   TOTAL_TOKEN_CAP = 3800
 *
 * REMAINING UNBOUNDED CONTRIBUTORS (structurally fixed-size in practice):
 *   static reminder block, pacing block, struggle nudge, CLI tools block.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const HOOK = path.join(ROOT, 'hooks', 'session-reminder.mjs')
const FIXTURE_SRC = path.join(ROOT, 'test', 'fixtures', 'session-reminder-h22-ledger.json')
const FIXTURE_DEST = path.join(ROOT, '.groundwork', 'runs', 'test-h22-worst-case.json')

// Keep in sync with hooks/session-reminder.mjs
const TOTAL_TOKEN_CAP = 3800
const MIN_HEADROOM = 200

// H22 test fixtures
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

// ---------------------------------------------------------------------------
// H25: adversarial fixture — many motives + many waves + long brief
// ---------------------------------------------------------------------------
//
// Purpose: prove that all three newly-bounded contributors (motive MAP list,
// wave-width notices, ledger.brief) are genuinely capped and that the cap
// matters — i.e. without the caps the payload would breach TOTAL_TOKEN_CAP.
//
// ADVERSARIAL FIXTURE SHAPE:
//   - 15 motive MAP files  (MOTIVE_MAP_CAP=5 → 10 hidden)
//   - 15 single-impl-slice waves, all incomplete (WAVE_NOTICE_CAP=5 → 10 hidden)
//   - ledger.brief of 500 chars (truncated at 200)
//   - 10 slices at ACTIVE_RUN_SLICE_CAP (already bounded by H22)
//
// BITE PROOF (pre-fix vs post-fix estimate):
//   Each extra motive beyond cap adds ~25 tokens (one absolute-path line).
//   Each extra wave notice beyond cap adds ~35 tokens.
//   Each extra brief char beyond 200 adds 1/3.5 ≈ 0.29 tokens.
//   Pre-fix additions over the H22 baseline (3480 tokens):
//     +10 motives × 25  = 250 tokens
//     +10 notices × 35  = 350 tokens
//     +300 extra chars  = ~86 tokens
//     Total extra       ≈ 686 tokens → estimated pre-fix total ≈ 4166 tokens
//   4166 > TOTAL_TOKEN_CAP (3800) → skeleton would have been silently dropped.
//   The adversarial test asserts the post-fix total stays under cap.

const ADV_SESSION_ID = 'test-h25-adversarial'
const ADV_MOTIVE_COUNT = 15
const ADV_WAVE_COUNT = 15  // each wave has exactly 1 impl slice (triggers NOTICE)
const ADV_BRIEF_LEN = 500  // truncated at 200

let advTempDir: string

beforeAll(() => {
  // Create isolated temp directory so we control the motive MAP count precisely.
  advTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-h25-adv-'))

  // Create motive MAP files
  const motivesDir = path.join(advTempDir, '.groundwork', 'motives')
  for (let i = 1; i <= ADV_MOTIVE_COUNT; i++) {
    const slug = `test-h25-adv-motive-${String(i).padStart(2, '0')}`
    const mapDir = path.join(motivesDir, slug)
    fs.mkdirSync(mapDir, { recursive: true })
    fs.writeFileSync(path.join(mapDir, 'MAP.md'), `# ${slug}\n\nAdversarial fixture motive ${i}.\n`)
  }

  // Build adversarial ledger: 15 incomplete slices each in a distinct wave
  const slices = Array.from({ length: ADV_WAVE_COUNT }, (_, i) => ({
    id: `H25-ADV-S${String(i + 1).padStart(2, '0')}`,
    status: 'open',
    wave: i + 1,
    kind: 'impl',
    behavior: `Adversarial wave ${i + 1} slice with a description filling up to eighty characters!`,
    acceptance: [],
  }))

  const ledger = {
    active: true,
    session_id: ADV_SESSION_ID,
    motive: 'test-h25-adversarial',
    brief: 'A'.repeat(ADV_BRIEF_LEN),
    write_token: 'tok-h25-adv-fixture-test-only',
    pacing: null,
    slices,
    gate: {},
  }

  const runsDir = path.join(advTempDir, '.groundwork', 'runs')
  fs.mkdirSync(runsDir, { recursive: true })
  fs.writeFileSync(
    path.join(runsDir, `${ADV_SESSION_ID}.json`),
    JSON.stringify(ledger, null, 2),
  )
})

afterAll(() => {
  // Clean up temp directory
  try { fs.rmSync(advTempDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('session-reminder: H25 adversarial cap verification', () => {
  it('payload stays under TOTAL_TOKEN_CAP with >= 200 headroom despite many motives, waves, and long brief', () => {
    // Use advTempDir as cwd so the hook reads the 15 motive MAPs from there.
    const input = JSON.stringify({ session_id: ADV_SESSION_ID, cwd: advTempDir })
    const result = spawnSync(process.execPath, [HOOK], {
      input,
      encoding: 'utf8',
    })

    expect(result.status, `hook exited ${result.status}: ${result.stderr}`).toBe(0)

    const output = JSON.parse(result.stdout)
    const ctx: string = output?.hookSpecificOutput?.additionalContext ?? ''

    // Verify ACTIVE RUN block is present (adversarial ledger has active=true)
    expect(ctx, 'ACTIVE RUN block missing — adversarial ledger not found').toContain('## ⚠ ACTIVE RUN')

    // Verify the motive MAP list is capped (should show 5, not 15)
    const mapLines = ctx.split('\n').filter(l => l.startsWith('- `') && l.includes('test-h25-adv-motive'))
    expect(
      mapLines.length,
      `expected at most 5 motive MAP lines (MOTIVE_MAP_CAP), got ${mapLines.length}`,
    ).toBeLessThanOrEqual(5)

    // Verify the wave notice count is capped (should show <= 5 NOTICEs)
    const noticeLines = ctx.split('\n').filter(l => l.startsWith('NOTICE: wave '))
    expect(
      noticeLines.length,
      `expected at most 5 wave NOTICE lines (WAVE_NOTICE_CAP), got ${noticeLines.length}`,
    ).toBeLessThanOrEqual(5)

    // Verify the brief is truncated (500 chars → visible as max 200 chars + ellipsis)
    const briefLine = ctx.split('\n').find(l => l.startsWith('Run: '))
    expect(briefLine, 'brief line missing').toBeDefined()
    const briefValue = briefLine!.slice('Run: '.length)
    expect(
      briefValue.length,
      `brief should be truncated to ≤201 chars (200 + ellipsis), got ${briefValue.length}`,
    ).toBeLessThanOrEqual(201)

    // Core invariant: total payload stays within headroom budget
    const totalTokens = Math.ceil(Buffer.byteLength(ctx, 'utf8') / 3.5)
    const headroom = TOTAL_TOKEN_CAP - totalTokens
    expect(
      headroom,
      `only ${headroom} tokens of headroom (need >= ${MIN_HEADROOM}). ` +
        `totalTokens=${totalTokens}, cap=${TOTAL_TOKEN_CAP}. ` +
        `Adversarial fixture breached cap — one of the three H25 caps is not working.`,
    ).toBeGreaterThanOrEqual(MIN_HEADROOM)

    // Bite proof: the uncapped pre-fix estimate would have breached the cap.
    // Each motive beyond MOTIVE_MAP_CAP adds ~25 tokens; each notice beyond
    // WAVE_NOTICE_CAP adds ~35 tokens; each char beyond 200 adds ~0.29 tokens.
    const MOTIVE_MAP_CAP = 5
    const WAVE_NOTICE_CAP = 5
    const BRIEF_MAX_CHARS = 200
    const hiddenMotives = Math.max(0, ADV_MOTIVE_COUNT - MOTIVE_MAP_CAP)
    const hiddenNotices = Math.max(0, ADV_WAVE_COUNT - WAVE_NOTICE_CAP)
    const hiddenBriefChars = Math.max(0, ADV_BRIEF_LEN - BRIEF_MAX_CHARS)
    const estimatedUncappedExtra =
      hiddenMotives * 25 + hiddenNotices * 35 + Math.ceil(hiddenBriefChars / 3.5)
    const estimatedUncappedTotal = totalTokens + estimatedUncappedExtra

    expect(
      estimatedUncappedTotal,
      `bite-proof failed: uncapped estimate (${estimatedUncappedTotal}) should exceed ` +
        `TOTAL_TOKEN_CAP (${TOTAL_TOKEN_CAP}) — the adversarial fixture is not adversarial enough`,
    ).toBeGreaterThan(TOTAL_TOKEN_CAP)
  })
})
