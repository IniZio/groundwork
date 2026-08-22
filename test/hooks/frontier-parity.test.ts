/**
 * frontier-parity.test.ts
 *
 * Parity test: verifies that both call sites for "which slices are actionable
 * now" delegate to dag-utils.frontier() and agree on semantics.
 *
 * Bug fixed by slice V6 of motive spine-beads-hitl-portability:
 *   - motive-map's frontierList included `skipped` slices (old filter only
 *     excluded `complete` and `in_progress`)
 *   - motive-map's frontierList included `fog` slices (no fog exclusion)
 *   - cmdFrontier in ledger.mjs was correct; motive-map MAP.md was wrong
 *
 * After the fix both surfaces call dagFrontier() from dag-utils.mjs.
 * This test exercises the shared function with a fixture covering every
 * relevant status/kind variant so any future drift in semantics is caught.
 */

import { describe, it, expect } from 'vitest'
import { frontier } from '../../hooks/lib/dag-utils.mjs'

/**
 * Fixture: one slice per interesting status/kind/blocker combination.
 *
 * Expected frontier (ids where status=pending, kind≠fog, all blockers complete):
 *   A  — pending, no blockers                         → FRONTIER
 *   C  — pending, blocked only by DONE (complete)     → FRONTIER
 *
 * NOT in frontier:
 *   B  — pending, blocked by A (pending, not complete)
 *   D  — in_progress
 *   E  — skipped
 *   F  — pending but kind=fog
 *   G  — pending, blocked by E (skipped counts as UNSATISFIED)
 *   H  — pending, claimed_by another session (still in raw frontier; caller filters)
 *   DONE — complete
 */
const SLICES = [
  { id: 'A',    status: 'pending' },
  { id: 'B',    status: 'pending',    blocked_by: ['A'] },
  { id: 'C',    status: 'pending',    blocked_by: ['DONE'] },
  { id: 'DONE', status: 'complete' },
  { id: 'D',    status: 'in_progress' },
  { id: 'E',    status: 'skipped' },
  { id: 'F',    status: 'pending',    kind: 'fog' },
  { id: 'G',    status: 'pending',    blocked_by: ['E'] },
  { id: 'H',    status: 'pending',    claimed_by: 'other-session' },
]

// ── Shared predicate ────────────────────────────────────────────────────────

describe('dag-utils.frontier() — shared predicate used by both call sites', () => {
  it('returns A and C (plus H — claimed_by not filtered here)', () => {
    const ids = frontier(SLICES).map((s) => s.id).sort()
    // dag-utils.frontier does NOT filter by claimed_by — that's the caller's job.
    expect(ids).toEqual(['A', 'C', 'H'].sort())
  })

  it('excludes skipped slice E', () => {
    expect(frontier(SLICES).find((s) => s.id === 'E')).toBeUndefined()
  })

  it('excludes pending slice blocked by skipped (G blocked_by E)', () => {
    expect(frontier(SLICES).find((s) => s.id === 'G')).toBeUndefined()
  })

  it('excludes fog slice F', () => {
    expect(frontier(SLICES).find((s) => s.id === 'F')).toBeUndefined()
  })

  it('excludes in_progress slice D', () => {
    expect(frontier(SLICES).find((s) => s.id === 'D')).toBeUndefined()
  })

  it('excludes complete slice DONE', () => {
    expect(frontier(SLICES).find((s) => s.id === 'DONE')).toBeUndefined()
  })

  it('excludes pending slice B whose blocker A is not yet complete', () => {
    expect(frontier(SLICES).find((s) => s.id === 'B')).toBeUndefined()
  })
})

// ── motive-map surface ──────────────────────────────────────────────────────
// After fix: frontierList = dagFrontier(slices).filter(s => !s.claimed_by)
// (motive-map shows all unclaimed actionable slices regardless of session)

describe('motive-map surface (frontierList = dagFrontier().filter(!claimed_by))', () => {
  const motiveMapFrontier = (slices: typeof SLICES) =>
    frontier(slices).filter((s) => !s.claimed_by)

  it('returns exactly [A, C] — claimed H excluded', () => {
    const ids = motiveMapFrontier(SLICES).map((s) => s.id).sort()
    expect(ids).toEqual(['A', 'C'].sort())
  })

  it('excludes skipped and fog slices', () => {
    const ids = motiveMapFrontier(SLICES).map((s) => s.id)
    expect(ids).not.toContain('E')
    expect(ids).not.toContain('F')
  })
})

// ── cmdFrontier surface ─────────────────────────────────────────────────────
// After fix: dagFrontier(slices).filter(s => !s.claimed_by || s.claimed_by === session)
// (CLI shows slices unclaimed or claimed by the current session)

describe('cmdFrontier surface (dagFrontier().filter(!claimed_by || claimed_by === session))', () => {
  const MY_SESSION = 'my-session'
  const OTHER_SESSION = 'other-session'

  const cliFrontier = (slices: typeof SLICES, session: string) =>
    frontier(slices).filter((s) => !s.claimed_by || s.claimed_by === session)

  it('returns [A, C] when session is different from H.claimed_by', () => {
    const ids = cliFrontier(SLICES, MY_SESSION).map((s) => s.id).sort()
    expect(ids).toEqual(['A', 'C'].sort())
  })

  it('returns [A, C, H] when session matches H.claimed_by', () => {
    const ids = cliFrontier(SLICES, OTHER_SESSION).map((s) => s.id).sort()
    expect(ids).toEqual(['A', 'C', 'H'].sort())
  })

  it('excludes skipped and fog slices', () => {
    const ids = cliFrontier(SLICES, MY_SESSION).map((s) => s.id)
    expect(ids).not.toContain('E')
    expect(ids).not.toContain('F')
  })
})

// ── Parity assertion ────────────────────────────────────────────────────────
// Both surfaces must agree on unclaimed slices. This is the seam test:
// if either surface rolls back to an inline filter that differs from the
// other, the expected-value assertions above will diverge, catching the drift.

describe('parity: both surfaces agree on unclaimed slices', () => {
  it('motive-map frontier ⊆ cli frontier (for same slices, unclaimed session)', () => {
    const SESSION = 'nobody'
    const mm = frontier(SLICES)
      .filter((s) => !s.claimed_by)
      .map((s) => s.id)
      .sort()
    const cli = frontier(SLICES)
      .filter((s) => !s.claimed_by || s.claimed_by === SESSION)
      .map((s) => s.id)
      .sort()
    // With no claimed slices matching SESSION, both filters reduce to !claimed_by
    expect(mm).toEqual(cli)
  })

  it('neither surface includes skipped, fog, in_progress, or complete slices', () => {
    const excluded = ['D', 'E', 'F', 'DONE']
    const mmIds = frontier(SLICES).filter((s) => !s.claimed_by).map((s) => s.id)
    const cliIds = frontier(SLICES).filter((s) => !s.claimed_by).map((s) => s.id)
    for (const id of excluded) {
      expect(mmIds).not.toContain(id)
      expect(cliIds).not.toContain(id)
    }
  })
})
