/**
 * Regression tests for TBD-26: resume.next_actions must not surface slices
 * from retired runs (active:false OR gate.advisor APPROVE).
 *
 * Tests:
 *   (a) closed run (complete + APPROVE) contributes nothing to next_actions
 *   (b) active:false run contributes nothing to next_actions
 *   (c) open run's unblocked slice still surfaces in next_actions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectGroundTruth } from '../../hooks/lib/motive-ground-truth.mjs'
import { compile } from '../../hooks/lib/motive-compile.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmp() {
  return mkdtempSync(join(tmpdir(), 'tbd26-test-'))
}

function writeLedgerFile(dir: string, filename: string, data: unknown) {
  const runsDir = join(dir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(join(runsDir, filename), JSON.stringify(data, null, 2), 'utf8')
}

/** Compile a motive against the given projectDir with no fold events. */
async function compileFor(dir: string, motive: string) {
  const groundTruth = await collectGroundTruth({ projectDir: dir, events: [], motive })
  return compile([], { groundTruth })
}

// ---------------------------------------------------------------------------

const MOTIVE = 'tbd26-test-motive'

describe('TBD-26 — retired runs must not appear in resume.next_actions', () => {
  let dir: string
  beforeEach(() => { dir = tmp() })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // ── (a) complete + gate.advisor APPROVE → nothing in next_actions ─────────
  it('(a) APPROVE-gated run: slice does not appear in next_actions', async () => {
    // Run d56a3864 analogue: all slices complete, gate.advisor APPROVE → retired
    writeLedgerFile(dir, 'closed-run.json', {
      motive: MOTIVE,
      session_id: 'closed-session',
      active: true, // active flag still true (real scenario); gate APPROVE is the closer
      slices: [
        { id: 'charter-open-items-parse', status: 'complete', wave: 4, desc: 'Parse open items' },
      ],
      gate: { advisor: { verdict: 'APPROVE', citation: 'all green' } },
    })

    const view = compileFor(dir, MOTIVE)
    const result = await view
    const actionSlices = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'implement_slice')
      .map((a: { slice: string }) => a.slice)

    expect(actionSlices).not.toContain('charter-open-items-parse')
    // No advisor gate prompt either — the run is already approved
    const advisorActions = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'run_advisor_gate')
    expect(advisorActions.length).toBe(0)
  })

  // ── (b) active:false run → nothing in next_actions ────────────────────────
  it('(b) active:false run: its slices do not appear in next_actions', async () => {
    writeLedgerFile(dir, 'inactive-run.json', {
      motive: MOTIVE,
      session_id: 'inactive-session',
      active: false, // explicitly deactivated
      slices: [
        { id: 'abandoned-slice', status: 'pending', wave: 1, desc: 'Never finished' },
      ],
      gate: {},
    })

    const result = await compileFor(dir, MOTIVE)
    const actionSlices = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'implement_slice')
      .map((a: { slice: string }) => a.slice)

    expect(actionSlices).not.toContain('abandoned-slice')
  })

  // ── (c) open run's unblocked slice surfaces in next_actions ───────────────
  it('(c) active open run: unblocked pending slice appears in next_actions', async () => {
    // Retired run (should be ignored)
    writeLedgerFile(dir, 'done-run.json', {
      motive: MOTIVE,
      session_id: 'done-session',
      active: false,
      slices: [
        { id: 'old-slice', status: 'complete', wave: 1, desc: 'Finished long ago' },
      ],
      gate: { advisor: { verdict: 'APPROVE' } },
    })

    // Active open run with a pending slice
    writeLedgerFile(dir, 'open-run.json', {
      motive: MOTIVE,
      session_id: 'open-session',
      active: true,
      slices: [
        { id: 'new-work', status: 'pending', wave: 2, desc: 'Needs doing' },
      ],
      gate: {},
    })

    const result = await compileFor(dir, MOTIVE)
    const actionSlices = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'implement_slice')
      .map((a: { slice: string }) => a.slice)

    // Open run's slice must appear
    expect(actionSlices).toContain('new-work')
    // Retired run's slice must NOT appear
    expect(actionSlices).not.toContain('old-slice')
  })

  // ── bonus: all-complete but not-yet-gate-approved → run_advisor_gate ─────
  it('(d) all-complete active run without gate: surfaces run_advisor_gate, not implement_slice', async () => {
    writeLedgerFile(dir, 'pending-gate-run.json', {
      motive: MOTIVE,
      session_id: 'pending-gate-session',
      active: true,
      slices: [
        { id: 'done-slice', status: 'complete', wave: 1, desc: 'Already done' },
      ],
      gate: {}, // no advisor verdict
    })

    // Feed the fold a TASK_COMPLETE so completedIds knows the slice is done
    const groundTruth = await collectGroundTruth({ projectDir: dir, events: [], motive: MOTIVE })
    const foldEvents = [
      {
        type: 'TASK_COMPLETE',
        data: { slice: 'done-slice' },
        session: 'pending-gate-session',
        motive: MOTIVE,
        ts: new Date().toISOString(),
      },
    ]
    const result = compile(foldEvents, { groundTruth })

    // No implement_slice for the already-complete slice
    const actionSlices = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'implement_slice')
      .map((a: { slice: string }) => a.slice)
    expect(actionSlices).not.toContain('done-slice')

    // Advisor gate must be suggested because gate is pending
    const advisorActions = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'run_advisor_gate')
    expect(advisorActions.length).toBe(1)
  })

  // ── (e) active + APPROVE gate + still-pending slice → NOT retired ──────────
  // Covers the normal post-APPROVE workflow: advisor records APPROVE, then
  // new slices are added (CLAUDE.md mandates registering findings as new slices
  // BEFORE APPROVE; ledger.mjs does not clear gate.advisor on add/set).
  // The pending slice must still appear in next_actions.
  it('(e) active run + gate APPROVE + pending slice: pending slice appears in next_actions', async () => {
    writeLedgerFile(dir, 'approve-plus-pending.json', {
      motive: MOTIVE,
      session_id: 'approve-pending-session',
      active: true,
      slices: [
        { id: 'already-done', status: 'complete', wave: 1, desc: 'Finished before gate' },
        { id: 'post-approve-work', status: 'pending', wave: 2, desc: 'Added after gate' },
      ],
      gate: { advisor: { verdict: 'APPROVE', citation: 'initial pass done' } },
    })

    const result = await compileFor(dir, MOTIVE)
    const actionSlices = result.agent.resume.next_actions
      .filter((a: { action: string }) => a.action === 'implement_slice')
      .map((a: { slice: string }) => a.slice)

    // Pending slice must be actionable — the run is NOT retired
    expect(actionSlices).toContain('post-approve-work')
    // Complete slice must not resurface
    expect(actionSlices).not.toContain('already-done')
  })
})
