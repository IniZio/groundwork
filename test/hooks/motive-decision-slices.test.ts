/**
 * motive-decision-slices.test.ts — G1-S2 acceptance tests: decision_log[].slices join.
 *
 * AC coverage (slice G1-S2):
 *  S2-AC1 — union of data.slice + ledger reverse index, deduped by slice id
 *  S2-AC2 — no ledger → slices:[] on entries, no throw
 *  S2-AC3 — unknown decision id on a slice → no phantom decision_log entry
 *  S2-AC4 — COMPILER_VERSION bumped (>= 1.3.0 / contains '1.3.')
 *
 * @verifies ARTIFACT-R-010
 */

// @ts-nocheck — pure-JS .mjs targets

import { describe, it, expect } from 'vitest'
import { compile, COMPILER_VERSION } from '../../hooks/lib/motive-compile.mjs'

// ── helpers ───────────────────────────────────────────────────────────────

function makeDecision(id: string, status = 'accepted', extra: Record<string, unknown> = {}) {
  return { type: 'DECISION', ts: '2026-01-01T00:00:00Z', data: { id, status, title: `Decision ${id}`, ...extra } }
}

function makeSlice(id: string, status = 'pending', decisions?: string | string[]) {
  const s: Record<string, unknown> = { id, status, desc: `Slice ${id}` }
  if (decisions !== undefined) s.decisions = decisions
  return s
}

function makeGroundTruth(slices: unknown[]) {
  return {
    ledger: { found: true, slices },
    head_sha: null,
    branch: null,
    dirty_paths: [],
    existing_paths: {},
  }
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('G1-S2: decision_log[].slices join', () => {
  it('S2-AC1: union of data.slice and ledger decisions, deduped by slice id', () => {
    // Source (a): DECISION event carries data.slice = 'S1'
    // Source (b): ledger slice S2 declares decisions: 'D-40'; slice S1 also declares decisions: ['D-40']
    const events = [
      makeDecision('D-40', 'accepted', { slice: 'S1' }),
    ]
    const groundTruth = makeGroundTruth([
      makeSlice('S1', 'complete', ['D-40']),  // also in source (a); dedup should produce one S1
      makeSlice('S2', 'pending', 'D-40'),
    ])
    const view = compile(events, { groundTruth })
    const log = view.agent.decision_log
    expect(log).toHaveLength(1)
    const entry = log[0]
    expect(entry.id).toBe('D-40')
    // S1 from both sources (deduped) + S2 from ledger only → 2 distinct slice ids
    const ids = entry.slices.map((s: { id: string }) => s.id).sort()
    expect(ids).toEqual(['S1', 'S2'])
  })

  it('S2-AC1: status reflects ledger status for each slice', () => {
    const events = [makeDecision('D-41', 'proposed')]
    const groundTruth = makeGroundTruth([
      makeSlice('S3', 'complete', 'D-41'),
      makeSlice('S4', 'pending', 'D-41'),
    ])
    const view = compile(events, { groundTruth })
    const entry = view.agent.decision_log[0]
    const byId = Object.fromEntries(entry.slices.map((s: { id: string; status: string }) => [s.id, s.status]))
    expect(byId['S3']).toBe('complete')
    expect(byId['S4']).toBe('pending')
  })

  it('S2-AC1: stable sort order (alphabetical by slice id)', () => {
    const events = [makeDecision('D-42', 'accepted', { slice: 'Z1' })]
    const groundTruth = makeGroundTruth([
      makeSlice('A1', 'pending', 'D-42'),
      makeSlice('M1', 'pending', 'D-42'),
    ])
    const view = compile(events, { groundTruth })
    const ids = view.agent.decision_log[0].slices.map((s: { id: string }) => s.id)
    expect(ids).toEqual(['A1', 'M1', 'Z1'])
  })

  it('S2-AC2: no ground-truth ledger → slices:[] and no throw', () => {
    const events = [makeDecision('D-40', 'accepted')]
    const view = compile(events)  // no opts.groundTruth
    expect(() => view).not.toThrow()
    expect(view.agent.decision_log).toHaveLength(1)
    expect(view.agent.decision_log[0].slices).toEqual([])
  })

  it('S2-AC2: groundTruth with ledger.found:false → slices:[] and no throw', () => {
    const events = [makeDecision('D-40', 'accepted')]
    const groundTruth = { ledger: { found: false }, head_sha: null, branch: null, dirty_paths: [], existing_paths: {} }
    const view = compile(events, { groundTruth })
    expect(view.agent.decision_log[0].slices).toEqual([])
  })

  it('S2-AC3: unknown decision id on a slice does not create a log entry', () => {
    // No DECISION event for D-99; ledger slice references D-99
    const events = [makeDecision('D-40', 'accepted')]
    const groundTruth = makeGroundTruth([
      makeSlice('S1', 'pending', ['D-40', 'D-99']),
    ])
    const view = compile(events, { groundTruth })
    // D-99 has no DECISION event → no entry in decision_log
    const ids = view.agent.decision_log.map((e: { id: string }) => e.id)
    expect(ids).not.toContain('D-99')
    // D-40 should still have S1 in its slices
    const d40 = view.agent.decision_log.find((e: { id: string }) => e.id === 'D-40')
    expect(d40.slices.map((s: { id: string }) => s.id)).toContain('S1')
  })

  it('S2-AC4: COMPILER_VERSION is bumped (contains 1.4.)', () => {
    expect(COMPILER_VERSION).toContain('1.4.')
    const view = compile([])
    expect(view.compiler_version).toBe(COMPILER_VERSION)
  })
})
