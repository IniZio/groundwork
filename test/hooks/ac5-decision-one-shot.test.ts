// check-comments-exempt — test; inline setup comments document fixture logic
/**
 * AC-5 — DECISION one-shot compile
 *
 * Criterion (verbatim from motive.md):
 *   "A decision appended with `journal append --type DECISION` appears in the
 *   next `journal compile --json` `decision_log` without any additional
 *   invocation — one command is sufficient for the decision to become visible
 *   in compiled output, with no intermediate sync or regeneration step."
 *
 * ONE-SHOT STRUCTURAL GUARANTEE
 * ─────────────────────────────
 * Between the single append call and the single compile call below, this test
 * executes ZERO other commands.  If the implementation required an intermediate
 * sync or regeneration step, the compile call would not perform it, so
 * `decision_log` would be absent and the assertion would fail.  The test is
 * therefore structurally incapable of passing under a two-step flow.
 *
 * FAILABILITY PROOF (see bottom of this file for instructions)
 * ─────────────────────────────────────────────────────────────
 * Break hooks/journal.mjs line 602 by commenting out `appendEvent(shardPath, event)`.
 * The event is never written to disk; compile sees nothing; decision_log is empty;
 * the assertion fails.  Restore the line to make the test pass again.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createMotiveFixture, type MotiveFixture } from '../helpers/motive-fixture.js'

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')

// Real dirs that must stay byte-identical after the test run
const REAL_JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')
const REAL_MOTIVE_DIR = path.join(ROOT, '.groundwork', 'motives', 'groundwork-development')

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stable SHA-256 snapshot of every file under `dir`, sorted for consistency.
 * Returns "<absent>" if the directory does not exist.
 */
function dirHash(dir: string): string {
  if (!existsSync(dir)) return '<absent>'
  const h = createHash('sha256')
  function walk(d: string): void {
    const entries = readdirSync(d, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else {
        h.update(full)
        h.update(readFileSync(full))
      }
    }
  }
  walk(dir)
  return h.digest('hex')
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe('AC-5 — DECISION one-shot compile', () => {
  let fix: MotiveFixture

  beforeEach(() => {
    fix = createMotiveFixture({ slug: 'ac5-decision-one-shot' })
  })

  afterEach(() => {
    fix.cleanup()
  })

  it('appended DECISION id appears in decision_log after exactly one append + one compile with no commands between them', () => {
    // Snapshot real dirs before any mutations
    const journalHashBefore = dirHash(REAL_JOURNAL_DIR)
    const motiveHashBefore = dirHash(REAL_MOTIVE_DIR)

    const DECISION_ID = 'D-AC5-one-shot'

    // ── COMMAND 1 OF 2: append DECISION ──────────────────────────────────────
    //
    // This is the ONLY write operation in this test.  No sync, no regeneration,
    // no intermediate command of any kind follows before compile.  That absence
    // is what proves the one-shot property: if an extra step were required, the
    // compile that immediately follows would lack the event and the assertion
    // would fail.
    const appendResult = spawnSync(
      process.execPath,
      [
        JOURNAL_MJS, 'append',
        '--motive', fix.motiveSlug,
        '--type', 'DECISION',
        '--msg', 'AC-5 one-shot test decision',
        '--data', JSON.stringify({
          id: DECISION_ID,
          decision: 'One append must be sufficient for visibility in compile output',
          rationale: 'AC-5 mandates no intermediate sync or regeneration step between append and compile',
          alternatives: [],
        }),
      ],
      { encoding: 'utf8', env: fix.env },
    )

    expect(
      appendResult.status,
      `journal append failed.\nstdout: ${appendResult.stdout}\nstderr: ${appendResult.stderr}`,
    ).toBe(0)

    // ── COMMAND 2 OF 2: compile ───────────────────────────────────────────────
    //
    // Executed immediately after append with ZERO intermediate commands.
    // --json      → output as JSON on stdout
    // --stdout    → do not write compiled files to disk (keeps fixture clean)
    // --no-ground-truth → no ledger scan needed in the isolated temp fixture
    const compileResult = spawnSync(
      process.execPath,
      [JOURNAL_MJS, 'compile', fix.motiveSlug, '--json', '--stdout', '--no-ground-truth'],
      { encoding: 'utf8', env: fix.env },
    )

    expect(
      compileResult.status,
      `journal compile failed.\nstdout: ${compileResult.stdout}\nstderr: ${compileResult.stderr}`,
    ).toBe(0)

    // ── ONE-SHOT ASSERTION ────────────────────────────────────────────────────
    //
    // The compiled view must contain DECISION_ID in agent.decision_log.
    // If appendEvent was not called (the failability break), decision_log is
    // empty and this assertion fails.
    const view = JSON.parse(compileResult.stdout) as {
      agent?: { decision_log?: Array<{ id: string }> }
    }
    const decisionLog = view.agent?.decision_log ?? []

    expect(
      decisionLog.some((entry) => entry.id === DECISION_ID),
      `Expected "${DECISION_ID}" in agent.decision_log after one append + one compile.\n` +
      `decision_log contents: ${JSON.stringify(decisionLog, null, 2)}`,
    ).toBe(true)

    // ── Real journal isolation guards ─────────────────────────────────────────
    expect(
      dirHash(REAL_JOURNAL_DIR),
      'Real .groundwork/journal/ was mutated — fixture isolation failed',
    ).toBe(journalHashBefore)

    expect(
      dirHash(REAL_MOTIVE_DIR),
      'Real .groundwork/motives/groundwork-development/ was mutated — fixture isolation failed',
    ).toBe(motiveHashBefore)
  })
})

/*
 * FAILABILITY PROOF INSTRUCTIONS
 * ─────────────────────────────────
 * 1. In hooks/journal.mjs, find line 602:
 *
 *      appendEvent(shardPath, event)
 *
 *    Comment it out:
 *
 *      // appendEvent(shardPath, event)   // FAILABILITY BREAK — restore after testing
 *
 * 2. Run:  npx vitest run test/hooks/ac5-decision-one-shot.test.ts
 *    The test fails with:
 *      Expected "D-AC5-one-shot" in agent.decision_log after one append + one compile.
 *      decision_log contents: []
 *
 * 3. Restore the line:  appendEvent(shardPath, event)
 *
 * 4. Run again:  npx vitest run test/hooks/ac5-decision-one-shot.test.ts
 *    The test passes.
 *
 * 5. Verify:  git diff hooks/journal.mjs  → empty (no uncommitted changes).
 */
