/**
 * Regression: provenance_lost AC state when covering slice absent from all ledgers.
 *
 * NEGATIVE: AC with phantom covering slice must not appear in ac_coverage.met,
 *           even when a surviving-but-unrelated ledger is present (the masking bug:
 *           ledgerFound=true suppressed status_unknown, so isMet stayed true).
 *
 * POSITIVE CONTROL: AC with resolvable covering slice still reads met:true.
 *                   Without this, a fix that marks everything unknown would pass
 *                   the negative case falsely.
 */

// @ts-nocheck — pure-JS .mjs target

import { describe, it, expect } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

function makeGroundTruth(slices: unknown[]) {
  return { ledger: { found: true, slices }, head_sha: null, branch: null, dirty_paths: [], existing_paths: {} }
}

function makeSlice(id: string, status = 'pending') {
  return { id, status, desc: `Slice ${id}` }
}

describe('provenance_lost: phantom slice detection in ac_coverage', () => {
  it('NEGATIVE: phantom covering slice not in ac_coverage.met (masking-ledger case)', () => {
    const events = [
      { type: 'AC_COVERAGE', ts: '2026-01-01T00:00:00Z', data: { ac: 'AC-99', slice: 'S-PHANTOM' } },
      { type: 'TASK_COMPLETE', ts: '2026-01-01T01:00:00Z', data: { slice: 'S-PHANTOM' } },
    ]
    const groundTruth = makeGroundTruth([makeSlice('S-UNRELATED', 'complete')])
    const view = compile(events, { groundTruth })
    const acCoverage = view.agent.ac_coverage

    expect(acCoverage.met.find((e: { id: string }) => e.id === 'AC-99')).toBeUndefined()

    expect(acCoverage.provenance_lost).toBeDefined()
    const plEntry = acCoverage.provenance_lost.find((e: { id: string }) => e.id === 'AC-99')
    expect(plEntry).toBeDefined()
    expect(plEntry.provenance_lost).toBe(true)
  })

  it('POSITIVE CONTROL: resolvable covering slice still reads met:true in ac_coverage.met', () => {
    const events = [
      { type: 'AC_COVERAGE', ts: '2026-01-01T00:00:00Z', data: { ac: 'AC-100', slice: 'S-REAL' } },
      { type: 'TASK_COMPLETE', ts: '2026-01-01T01:00:00Z', data: { slice: 'S-REAL' } },
    ]
    const groundTruth = makeGroundTruth([makeSlice('S-REAL', 'complete')])
    const view = compile(events, { groundTruth })
    const acCoverage = view.agent.ac_coverage

    const metEntry = acCoverage.met.find((e: { id: string }) => e.id === 'AC-100')
    expect(metEntry).toBeDefined()
    expect(metEntry.met).toBe(true)
    expect(acCoverage.provenance_lost?.find((e: { id: string }) => e.id === 'AC-100')).toBeUndefined()
  })
})
