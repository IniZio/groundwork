/**
 * journal-pause — PAUSE event surfaces in compiled agent output
 *
 * Proves:
 *   1. A PAUSE event populates agent.last_pause with {pointer, summary, next_actions}.
 *   2. PAUSE next_actions are PREPENDED into agent.resume.next_actions
 *      (ahead of any ledger-derived actions — precedence).
 *   3. Without a PAUSE event, agent.last_pause is null and next_actions
 *      contains only ledger-derived items (control case).
 *
 * RED→GREEN sensitive: the precedence assertion fails if the compiler stops
 * prepending PAUSE actions (e.g. if unshift is removed or the PAUSE branch
 * is skipped). The last_pause assertion fails if lastPause is not assigned.
 */
// @ts-nocheck — motive-compile.mjs is pure JS; no type declarations needed.
import { describe, it, expect } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a minimal valid event. _order is required by the compiler. */
function makeEvent(type: string, data: Record<string, unknown>, i = 0) {
  return {
    ts: `2026-08-07T10:00:${String(i).padStart(2, '0')}.000Z`,
    session: 'sess-pause-test',
    motive: 'test-pause-motive',
    type,
    data,
    _order: { shard: 'test.jsonl', line: i },
  }
}

/**
 * Ground truth with one complete slice and NO advisor gate, so the compiler
 * produces a ledger-derived action (run_advisor_gate). This lets us confirm
 * that PAUSE actions are prepended ahead of ledger-derived ones.
 */
function makeGroundTruth() {
  return {
    head_sha: 'abc1234',
    branch: 'main',
    dirty_paths: [],
    existing_paths: {},
    ledger: {
      found: true,
      slices: [
        { id: 'S1', wave: 1, status: 'complete', desc: 'some slice', blocked_by: [] },
      ],
      gate: {},
    },
  }
}

// ── Test 1: PAUSE → last_pause and resume.next_actions precedence ─────────

describe('PAUSE event — last_pause and resume.next_actions', () => {
  const pauseData = {
    pointer: 'handoff/pause-2026-08-07.md',
    summary: 'Stopped mid-implementation to await review.',
    next_actions: [{ action: 'do_x', why: 'first thing on resume' }],
  }

  const events = [
    makeEvent('PAUSE', pauseData, 0),
  ]

  const gt = makeGroundTruth()
  const view = compile(events, { groundTruth: gt })

  it('agent.last_pause equals the PAUSE event data', () => {
    expect(view.agent.last_pause).toEqual({
      pointer: pauseData.pointer,
      summary: pauseData.summary,
      next_actions: pauseData.next_actions,
    })
  })

  it('agent.resume.next_actions contains the PAUSE action', () => {
    const actions: string[] = view.agent.resume.next_actions.map((a: any) => a.action)
    expect(actions).toContain('do_x')
  })

  it('PAUSE action precedes any ledger-derived action (precedence)', () => {
    const actions: string[] = view.agent.resume.next_actions.map((a: any) => a.action)
    const pauseIdx = actions.indexOf('do_x')
    // The ledger-derived action from a complete-but-ungated run is run_advisor_gate.
    const ledgerIdx = actions.indexOf('run_advisor_gate')
    expect(pauseIdx).toBeGreaterThanOrEqual(0) // PAUSE action present
    if (ledgerIdx !== -1) {
      // When the ledger-derived action also surfaces, PAUSE must come first.
      expect(pauseIdx).toBeLessThan(ledgerIdx)
    }
  })
})

// ── Test 2: Control — no PAUSE, last_pause is null ────────────────────────

describe('no PAUSE event — last_pause absent, next_actions ledger-derived', () => {
  // Empty event stream; ground truth provides a complete+ungated slice so
  // the ledger-derived run_advisor_gate action still surfaces.
  const events: any[] = []
  const gt = makeGroundTruth()
  const view = compile(events, { groundTruth: gt })

  it('agent.last_pause is null when no PAUSE event is present', () => {
    // The compiler initialises lastPause = null and never reassigns it without a PAUSE event.
    expect(view.agent.last_pause).toBeNull()
  })

  it('agent.resume.next_actions does NOT contain do_x (no PAUSE injected it)', () => {
    const actions: string[] = view.agent.resume.next_actions.map((a: any) => a.action)
    expect(actions).not.toContain('do_x')
  })

  it('ledger-derived action surfaces in next_actions without PAUSE', () => {
    // Proves the control path is live: ledger-derived items appear when no PAUSE suppresses them.
    const actions: string[] = view.agent.resume.next_actions.map((a: any) => a.action)
    expect(actions).toContain('run_advisor_gate')
  })
})

// ── Test 3: PAUSE with empty next_actions — last_pause recorded, no prepend ──

describe('PAUSE with empty next_actions — last_pause recorded but no prepend', () => {
  const pauseData = {
    pointer: 'handoff/empty.md',
    summary: 'Paused with no explicit next actions.',
    next_actions: [],
  }

  const events = [makeEvent('PAUSE', pauseData, 0)]
  const gt = makeGroundTruth()
  const view = compile(events, { groundTruth: gt })

  it('agent.last_pause is still recorded even with empty next_actions', () => {
    expect(view.agent.last_pause).toEqual({
      pointer: pauseData.pointer,
      summary: pauseData.summary,
      next_actions: [],
    })
  })

  it('ledger-derived action still surfaces when PAUSE next_actions is empty', () => {
    // Empty PAUSE next_actions → falls through to ledger-derived
    const actions: string[] = view.agent.resume.next_actions.map((a: any) => a.action)
    expect(actions).toContain('run_advisor_gate')
  })
})
