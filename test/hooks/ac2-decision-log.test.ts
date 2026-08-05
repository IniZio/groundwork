/**
 * AC-2 failability-proven test: DECISION events with data.id appear in
 * agent.decision_log with non-null decision text.
 *
 * CITATION FINDING
 * ─────────────────
 * The AC-2 criterion text says "non-null `decision` field" in agent.decision_log.
 * The actual compiled field is named `title`, not `decision`.
 * Source: motive-compile.mjs line 182: `title: d.title ?? d.decision ?? null`
 * agent.decision_log entries have keys: id, status, title, rationale, alternatives,
 * ord, ts, supersedes, superseded_by, resolves, slices — no `decision` key.
 * The legacy no-id path (lines 259-265) uses agent.decisions[] with a `decision`
 * field; AC-2 most likely conflates these two structures (charter defect).
 * All assertions below target the real field (`title`).
 *
 * GENUINE FINDING (TBD-3 / TBD-27)
 * ──────────────────────────────────
 * The merge path for same-id DECISION events (motive-compile.mjs lines 211-241)
 * checks `d.title` but NOT `d.decision`.  journal append requires data.decision
 * (validated), so authors always provide it — but the fold ignores it for same-id
 * updates.  When event 2 carries only data.decision (no data.title), the updated
 * text is silently dropped and the initial text from event 1 persists.
 * This is the exact swallowed-signal defect recorded in D-11 and TBD-27.
 * It is encoded via it.fails() below so it will flip to a plain PASS when the
 * merge path is fixed, without locking in the broken behavior.
 *
 * APPROACH
 * ─────────
 * Events are appended via `hooks/journal.mjs append` (the same mechanism tests in
 * test/hooks/motive-fixture.test.ts use), using the shared createMotiveFixture()
 * helper for full temp-tree isolation.  The fixture's pre-seeded fixture.jsonl
 * contains SESSION_START events; DECISION events land in a separate dated shard
 * (same journal dir), both read by `journal compile`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { createMotiveFixture, type MotiveFixture } from '../helpers/motive-fixture.js'

// ── CLI path (same pattern as motive-fixture.test.ts) ─────────────────────────

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const JOURNAL_MJS = path.join(ROOT, 'hooks', 'journal.mjs')

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Append one DECISION event via the journal CLI.
 * `data` must include at minimum: id, decision, rationale (validated by append).
 */
function appendDecision(fix: MotiveFixture, data: Record<string, unknown>): void {
  const r = spawnSync(
    process.execPath,
    [
      JOURNAL_MJS, 'append',
      '--motive', fix.motiveSlug,
      '--type', 'DECISION',
      '--msg', String(data['id'] ?? 'decision'),
      '--data', JSON.stringify(data),
    ],
    { encoding: 'utf8', env: fix.env },
  )
  if (r.status !== 0) {
    throw new Error(
      `journal append failed (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  }
}

/**
 * Run `journal compile <slug> --json --no-ground-truth` and return
 * the parsed agent.decision_log array.
 */
function compileDecisionLog(fix: MotiveFixture): Array<Record<string, unknown>> {
  const r = spawnSync(
    process.execPath,
    [JOURNAL_MJS, 'compile', fix.motiveSlug, '--json', '--no-ground-truth'],
    { encoding: 'utf8', env: fix.env },
  )
  if (r.status !== 0) {
    throw new Error(
      `journal compile failed (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  }
  const view: Record<string, unknown> = JSON.parse(r.stdout)
  return (view['agent'] as Record<string, unknown>)['decision_log'] as Array<Record<string, unknown>>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AC-2: DECISION events with data.id appear in agent.decision_log with non-null decision text (title field)', () => {
  let fix: MotiveFixture

  beforeEach(() => {
    fix = createMotiveFixture({ slug: 'ac2-decision-log' })
  })

  afterEach(() => {
    fix.cleanup()
  })

  // ── Canonical AC-2: single event, non-null title ──────────────────────────

  it('DECISION with data.id appears in agent.decision_log', () => {
    appendDecision(fix, {
      id: 'D-1',
      decision: 'Adopt approach X for performance',
      rationale: 'benchmarks show 2x gain over alternative',
    })

    const log = compileDecisionLog(fix)
    const entry = log.find(e => e['id'] === 'D-1')
    expect(entry, 'D-1 must appear in decision_log').toBeDefined()
  })

  it('DECISION entry title equals data.decision text — decision text is not swallowed (AC-2)', () => {
    // This is the load-bearing AC-2 assertion.
    // The compiled field is 'title' (motive-compile.mjs line 182: d.title ?? d.decision ?? null).
    // A null title means the decision text was silently dropped — the exact defect from D-11/TBD-27.
    appendDecision(fix, {
      id: 'D-2',
      decision: 'Use TypeScript strict mode everywhere',
      rationale: 'prevents null-ref class of bugs',
    })

    const log = compileDecisionLog(fix)
    const entry = log.find(e => e['id'] === 'D-2')
    expect(entry, 'D-2 must appear in decision_log').toBeDefined()
    // Load-bearing: exact string match ensures the decision text is non-null AND correct.
    // A test that only checks .not.toBeNull() would pass even if the text were wrong.
    expect(entry!['title']).toBe('Use TypeScript strict mode everywhere')
  })

  it('every DECISION event with data.id appears in decision_log with its decision text', () => {
    // AC-2 says "every DECISION event" — test multiple to guard against first-only bugs.
    const decisions = [
      { id: 'D-10', decision: 'Cache responses at the edge', rationale: 'reduces p99 latency' },
      { id: 'D-11', decision: 'Migrate codebase to ESM', rationale: 'aligns with Node 22 native ESM' },
      { id: 'D-12', decision: 'Drop IE11 support', rationale: 'browser share < 0.5%' },
    ]
    for (const d of decisions) appendDecision(fix, d)

    const log = compileDecisionLog(fix)
    for (const expected of decisions) {
      const entry = log.find(e => e['id'] === expected.id)
      expect(entry, `${expected.id} must appear in decision_log`).toBeDefined()
      expect(
        entry!['title'],
        `${expected.id} title must carry the decision text (must not be swallowed)`,
      ).toBe(expected.decision)
    }
  })

  // ── Same-id merge hazard (TBD-3) ─────────────────────────────────────────

  it('same-id merge: later data.decision wins (last non-null field wins semantics)', () => {
    // Two events sharing the same id.  TBD-3 records: "same-id DECISION events are
    // merged (later non-null fields win, earliest ts retained)."
    // With the TBD-27 fix applied, d.decision is now a fallback on the merge path,
    // so event 2's decision text correctly overwrites event 1's.
    //
    // Event 1: creates the entry; title comes from data.decision (no data.title provided)
    appendDecision(fix, {
      id: 'D-20',
      decision: 'initial decision text',
      rationale: 'original rationale',
    })
    // Event 2: same id, also carries data.decision — merge path runs (lines 211-241)
    appendDecision(fix, {
      id: 'D-20',
      decision: 'updated decision text',
      rationale: 'updated rationale',
      revises: 'D-20',
    })

    const log = compileDecisionLog(fix)
    const entry = log.find(e => e['id'] === 'D-20')
    expect(entry, 'D-20 must appear after merge').toBeDefined()
    // "later non-null fields win": event 2's decision text must overwrite event 1's.
    expect(entry!['title']).toBe('updated decision text')
  })

  it(
    'same-id merge: title updates from data.decision on second event (fix for TBD-3/TBD-27 swallowed-signal defect)',
    () => {
      // Defect: motive-compile.mjs merge path (lines 211-241) checks d.title but NOT d.decision.
      // journal append validates data.decision as required, so authors always provide it —
      // but the fold ignores it when merging same-id events.  The updated decision text
      // from event 2 is dropped; only the rationale and other tracked fields win through.
      //
      // This is the swallowed-signal defect recorded in D-11 and TBD-27:
      //   D-1 and D-13 lost their original decision text in production; it survives
      //   only in raw journal shards, absent from the compiled decision_log.
      //
      // Expected correct behavior (TBD-3 "later non-null fields win"):
      //   event 2 carries decision: 'updated decision text'
      //   → entry.title should update to 'updated decision text'
      //
      // Actual current behavior:
      //   entry.title stays 'initial decision text' (event 2's decision text dropped)
      //
      // This test.fails() wrapping will become obsolete once the merge path is patched
      // to apply: `if (d.decision != null && d.title == null) existing.title = d.decision`
      // At that point, unwrap it.fails and the test becomes a plain passing test.
      appendDecision(fix, {
        id: 'D-21',
        decision: 'initial decision text',
        rationale: 'r',
      })
      appendDecision(fix, {
        id: 'D-21',
        decision: 'updated decision text',
        rationale: 'r2',
        revises: 'D-21',
      })

      const log = compileDecisionLog(fix)
      const entry = log.find(e => e['id'] === 'D-21')
      expect(entry, 'D-21 must appear').toBeDefined()
      // Correct expected behavior — currently fails because merge path ignores d.decision.
      expect(entry!['title']).toBe('updated decision text')
    },
  )
})
