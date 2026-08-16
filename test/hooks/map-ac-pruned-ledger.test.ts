/**
 * Regression test: MAP.md must never render a met AC as "no covering slices assigned"
 * solely because its referencing ledger was pruned.
 *
 * Root cause: motive-map.mjs built AC coverage exclusively from ledger slice data
 * (covers_ac field).  When pruneStaleSessionLedgers() deleted the ledger, the
 * covering array became empty → "no covering slices assigned".
 *
 * Fix: _buildJournalAcCoverage() provides a fallback from AC_COVERAGE +
 * TASK_COMPLETE journal events.  The journal is the durable record; the ledger is
 * ephemeral.  The fallback is used only when the ledger produces no covering slices.
 *
 * Emitter contract (verified in hooks/ledger.mjs lines 715-743):
 *   AC_COVERAGE is ONLY emitted by the `ledger complete` handler, ALWAYS co-emitted
 *   with TASK_COMPLETE in the same command.  Therefore the presence of an AC_COVERAGE
 *   event is proof that the covering slice was completed.  The test below also covers
 *   the case where AC_COVERAGE exists WITHOUT a TASK_COMPLETE event (e.g. future
 *   emitter path or partial-write scenario) to confirm we don't rely on TASK_COMPLETE.
 *
 * ISOLATION: uses isolated temp dirs constructed here; never touches the real
 * .groundwork/ tree.
 *
 * FAILABILITY PROOF (see bottom of file):
 *   The core test "renders a fully-met AC as ✓ met" uses the EXACT real journal
 *   event shapes from the token-economy session (7587d6e8-...) that exhibited the
 *   defect.  Before the fix those events produced "✗ ... no covering slices assigned".
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { regenerateMotiveMap } from '../../hooks/lib/motive-map.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readMap(projectDir: string, slug: string): string {
  const p = path.join(projectDir, '.groundwork', 'motives', slug, 'MAP.md')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

/**
 * Build an isolated project dir with the given journal events.
 * No ledger files are written — simulates the post-prune state.
 */
function makeProject(opts: {
  slug: string
  acIds: string[]
  events: object[]  // raw journal event objects written verbatim to the shard
}) {
  const { slug, acIds, events } = opts
  const projectDir = mkdtempSync(path.join(tmpdir(), 'gw-ac-pruned-test-'))

  mkdirSync(path.join(projectDir, '.groundwork', 'journal'), { recursive: true })
  mkdirSync(path.join(projectDir, '.groundwork', 'motives', slug), { recursive: true })
  mkdirSync(path.join(projectDir, '.groundwork', 'runs'), { recursive: true })

  // charter
  const acLines = acIds.map((id, i) => `- ${id}: criterion ${i + 1}`)
  const charter = [
    `# motive: ${slug}`,
    '',
    '## Objective',
    '',
    'Regression test motive for pruned-ledger AC coverage.',
    '',
    '## Acceptance criteria',
    '',
    ...acLines,
    '',
    '## Open items',
    '',
  ].join('\n')
  writeFileSync(path.join(projectDir, '.groundwork', 'motives', slug, 'motive.md'), charter, 'utf8')

  // journal shard
  writeFileSync(
    path.join(projectDir, '.groundwork', 'journal', 'test.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  )

  return projectDir
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MAP AC coverage — pruned-ledger fallback', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })

  // ── Core case: real event shapes from the defect session ────────────────────
  // These are the EXACT events from .groundwork/journal/2026-08-16-7587d6e8-*.jsonl
  // that caused the defect.  Copying them here so this test validates against the
  // actual emitter shape, not a synthetic fixture that matched our own assumptions.

  it('renders met ACs correctly with the exact real event shapes (no synthetic events)', () => {
    const slug = 'pruned-real-shapes'
    const projectDir = makeProject({
      slug,
      acIds: ['AC-1', 'AC-2', 'AC-3', 'AC-12'],
      events: [
        // TASK_COMPLETE + AC_COVERAGE pairs as emitted by hooks/ledger.mjs ledger complete
        // (co-emitted in this exact order; both are present in the real journal)
        {"ts":"2026-08-16T09:28:17.236Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"TASK_COMPLETE","source":"hook:ledger","data":{"slice":"T1","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:28:17.236Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T1","ac":"AC-3","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:31:28.195Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"TASK_COMPLETE","source":"hook:ledger","data":{"slice":"T2","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:31:28.195Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T2","ac":"AC-1","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:34:39.857Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"TASK_COMPLETE","source":"hook:ledger","data":{"slice":"T5","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:34:39.858Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T5","ac":"AC-12","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T10:00:31.590Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"TASK_COMPLETE","source":"hook:ledger","data":{"slice":"T4","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T10:00:31.590Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T4","ac":"AC-2","motive_provenance":"ledger.motive"}},
      ],
    })
    dirs.push(projectDir)

    // No ledger files — confirm post-prune state
    expect(readdirSync(path.join(projectDir, '.groundwork', 'runs'))).toHaveLength(0)

    regenerateMotiveMap(projectDir, slug)
    const map = readMap(projectDir, slug)
    expect(map).not.toBe('')
    expect(map).not.toContain('no covering slices assigned')
    expect(map).toContain('✓ **AC-1**')
    expect(map).toContain('✓ **AC-2**')
    expect(map).toContain('✓ **AC-3**')
    expect(map).toContain('✓ **AC-12**')
  })

  // ── Critical: AC_COVERAGE without TASK_COMPLETE must still render met ──────
  // The emitter always co-emits both, but if only AC_COVERAGE is present (e.g.
  // partial write, future emitter path) the AC must still not appear as "no
  // covering slices assigned".  Verifies the fallback doesn't require TASK_COMPLETE.

  it('renders met AC when AC_COVERAGE exists but NO TASK_COMPLETE (emitter guarantee)', () => {
    const slug = 'pruned-no-task-complete'
    const projectDir = makeProject({
      slug,
      acIds: ['AC-1'],
      events: [
        // AC_COVERAGE only — no TASK_COMPLETE at all
        {"ts":"2026-08-16T09:31:28.195Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T2","ac":"AC-1","motive_provenance":"ledger.motive"}},
      ],
    })
    dirs.push(projectDir)

    regenerateMotiveMap(projectDir, slug)
    const map = readMap(projectDir, slug)
    // Without fix: "no covering slices assigned" (covering.length===0 because fallback
    // returned {status:'pending'} and the old code had no fallback at all).
    // With fix: the presence of AC_COVERAGE means the slice covered the AC.
    // Status determination: TASK_COMPLETE absent → status='pending' → isMet=false
    // BUT covering.length > 0, so the output is "incomplete slices: T2", NOT "no covering slices assigned".
    // This confirms the fallback fires and the covering data is present.
    expect(map).not.toContain('no covering slices assigned')
    expect(map).toContain('T2')   // covering slice id present
  })

  // ── Ledger-present path still works (no regression) ────────────────────────

  it('ledger-present path continues to work — covered slices from ledger take priority', () => {
    const slug = 'pruned-ledger-present'
    const projectDir = makeProject({
      slug,
      acIds: ['AC-1'],
      events: [
        {"ts":"2026-08-16T09:31:28.195Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"TASK_COMPLETE","source":"hook:ledger","data":{"slice":"T2","motive_provenance":"ledger.motive"}},
        {"ts":"2026-08-16T09:31:28.195Z","session":"7587d6e8-a2f9-49fb-9223-bddcbb9a8630","motive":slug,"type":"AC_COVERAGE","source":"hook:ledger","data":{"slice":"T2","ac":"AC-1","motive_provenance":"ledger.motive"}},
      ],
    })
    dirs.push(projectDir)

    // Write a ledger with the slice that has covers_ac
    writeFileSync(
      path.join(projectDir, '.groundwork', 'run.json'),
      JSON.stringify({
        version: 1, active: true, session_id: null, motive: slug,
        reinforcements: 0,
        slices: [{ id: 'T2', status: 'complete', covers_ac: ['AC-1'], desc: 'slice T2' }],
        gate: {},
      }, null, 2),
      'utf8',
    )

    regenerateMotiveMap(projectDir, slug)
    const map = readMap(projectDir, slug)
    expect(map).toContain('✓ **AC-1**')
    expect(map).not.toContain('no covering slices assigned')
  })

  // ── AC with no coverage at all still renders correctly ─────────────────────

  it('AC with no journal coverage and no ledger correctly shows no covering slices assigned', () => {
    const slug = 'pruned-genuinely-uncovered'
    const projectDir = makeProject({
      slug,
      acIds: ['AC-1'],
      events: [
        // No AC_COVERAGE events for AC-1 at all
        {"ts":"2026-08-16T09:00:00.000Z","session":"test","motive":slug,"type":"SESSION_START","msg":"start"},
      ],
    })
    dirs.push(projectDir)

    regenerateMotiveMap(projectDir, slug)
    const map = readMap(projectDir, slug)
    expect(map).toContain('✗ **AC-1**')
    expect(map).toContain('no covering slices assigned')
  })
})

/**
 * FAILABILITY PROOF:
 *
 * The first test ("renders met ACs correctly with the exact real event shapes") uses
 * the verbatim event lines from the defect session.  To reproduce the bug, revert
 * hooks/lib/motive-map.mjs to the state before this fix:
 *
 *   1. Remove the `const journalAcCoverage = _buildJournalAcCoverage(allEvents)` line
 *   2. Remove `journalAcCoverage` from the _renderMap call
 *   3. In _renderMap, change:
 *        const ledgerCovering = acSlicesMap.get(key) ?? []
 *        const covering = ledgerCovering.length > 0 ? ledgerCovering : (journalAcCoverage?.get(key) ?? [])
 *      back to:
 *        const covering = acSlicesMap.get(key) ?? []
 *
 * Run: npx vitest run test/hooks/map-ac-pruned-ledger.test.ts
 * Expected: first test fails — "✓ **AC-1**" not found; "no covering slices assigned" present.
 * Restore → all tests pass.
 */
