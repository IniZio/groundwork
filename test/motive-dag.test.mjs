/**
 * motive-dag.test.mjs — Unit tests for hooks/lib/motive-dag.mjs helpers.
 *
 * Covers:
 *   - readOrderedDecisionsFromFold: ordering, supersession, janitorial retraction, token overlap
 *   - validateFoldRefs: valid/missing partitioning, 'ac' alias
 *   - extractACCoverageFromFold: node collection, declaration form vs coverage edges
 *   - Re-exports: assembleGraphFold and projectFoldGraph are callable
 */

import { describe, it, expect } from 'vitest'
import {
  readOrderedDecisionsFromFold,
  validateFoldRefs,
  extractACCoverageFromFold,
  assembleGraphFold,
  projectFoldGraph,
} from '../hooks/lib/motive-dag.mjs'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal valid fold with empty attrs (mirrors assembleGraphFold output shape).
 */
function makeFold(nodes = [], edges = []) {
  return {
    schema_version: 1,
    motive: 'test-motive',
    nodes,
    edges,
    attrs: {
      gates: [], milestones: [], sessions: [], verifications: [],
      pauses: [], session_starts: [], spec_changes: [], lint_drifts: [],
      prototype_results: [], failures: [], waivers: [], handoffs: [], spec_drifts: [],
    },
  }
}

// ── Re-export smoke tests ─────────────────────────────────────────────────────

describe('re-exports', () => {
  it('assembleGraphFold is exported and callable', () => {
    const fold = assembleGraphFold([])
    expect(fold).toMatchObject({ schema_version: expect.any(Number), nodes: [], edges: [] })
  })

  it('projectFoldGraph is exported and callable', () => {
    const fold = assembleGraphFold([])
    const proj = projectFoldGraph(fold)
    expect(proj).toHaveProperty('decision_log')
    expect(proj).toHaveProperty('ac_coverage')
  })
})

// ── readOrderedDecisionsFromFold ──────────────────────────────────────────────

describe('readOrderedDecisionsFromFold', () => {
  it('returns empty array for fold with no decision nodes', () => {
    const fold = makeFold([
      { id: 'ac:AC1', type: 'acceptance-criterion', attrs: { ac: 'AC1' } },
    ])
    expect(readOrderedDecisionsFromFold(fold)).toEqual([])
  })

  it('returns decisions newest-first by _ord', () => {
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'First decision', _ord: 1 } },
      { id: 'decision:D-2', type: 'decision', attrs: { title: 'Second decision', _ord: 2 } },
      { id: 'decision:D-3', type: 'decision', attrs: { title: 'Third decision', _ord: 3 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    expect(result.map((n) => n.id)).toEqual(['decision:D-3', 'decision:D-2', 'decision:D-1'])
  })

  it('excludes a decision superseded by another (supersession rule)', () => {
    const fold = makeFold([
      // D-1 exists at ord=1; D-2 at ord=2 supersedes D-1
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'Old approach', _ord: 1 } },
      { id: 'decision:D-2', type: 'decision', attrs: { title: 'New approach', supersedes: 'D-1', _ord: 2 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    const ids = result.map((n) => n.id)
    // D-1 must be excluded; D-2 must survive
    expect(ids).not.toContain('decision:D-1')
    expect(ids).toContain('decision:D-2')
    expect(result).toHaveLength(1)
  })

  it('supersession bites: wrong impl returning D-1 would fail this test', () => {
    // This is the red→green guard: a naive impl that skips supersession logic
    // would include both D-1 and D-2, causing toHaveLength(1) to fail above.
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'Outdated', _ord: 1 } },
      { id: 'decision:D-2', type: 'decision', attrs: { title: 'Current', supersedes: 'D-1', _ord: 3 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('decision:D-2')
  })

  it('preserves legacy decisions (_legacy_ord prefix) without filtering them as structured ids', () => {
    const fold = makeFold([
      { id: 'decision:_legacy_ord_5', type: 'decision', attrs: { decision: 'Some legacy choice', _ord: 5 } },
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'Structured decision', _ord: 2 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    // Both survive (no supersession); legacy is newer so it comes first
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('decision:_legacy_ord_5')
    expect(result[1].id).toBe('decision:D-1')
  })

  it('excludes janitorial retraction nodes (retires + "Retract" body, structured retiring id)', () => {
    // Use a STRUCTURED retiring id so step-1's id-based supersession does NOT exclude the
    // retracted node (its id 'D-Old' is not in supersededIds — the retires field value IS 'D-Old',
    // which goes into supersededIds, but the node id is 'decision:D-Old' so the plain-id match
    // suppresses it via supersededIds.has('D-Old')). Actually: D-Old IS suppressed by step 1.
    // The janitorial retraction check is for the RETIRING node itself (decision:D-Jan):
    // step 3 must exclude it because its decision body starts with "Retract".
    // A naive impl that skips step 3 leaves D-Jan in the result — causing toHaveLength(1) to fail.
    const fold = makeFold([
      // The decision being retracted — excluded by step 1 (supersededIds has 'D-Old')
      { id: 'decision:D-Old', type: 'decision', attrs: { title: 'Old approach', _ord: 1 } },
      // Janitorial retraction: structured id, decision body starts with "Retract"
      // It survives step 1 (D-Jan is not in supersededIds).
      // It survives step 2 (normText is unique).
      // Step 3 must remove it (retires != null AND decision starts with "retract").
      { id: 'decision:D-Jan', type: 'decision', attrs: { decision: 'Retract D-Old approach', retires: 'D-Old', _ord: 10 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    const ids = result.map((n) => n.id)
    // D-Old is excluded by step 1 (superseded by retires reference)
    expect(ids).not.toContain('decision:D-Old')
    // D-Jan must be excluded by step 3 (janitorial retraction rule)
    expect(ids).not.toContain('decision:D-Jan')
    expect(result).toHaveLength(0)
  })

  it('keeps substantive decisions that also carry retires (non-Retract body)', () => {
    // D-32: introduces a new approach AND retires a prior one — body is not "Retract …"
    const fold = makeFold([
      { id: 'decision:D-32', type: 'decision', attrs: { title: 'Adopt event-sourced fold', retires: 'D-5', _ord: 32 } },
      { id: 'decision:D-5',  type: 'decision', attrs: { title: 'Use parallel projection', _ord: 5 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    const ids = result.map((n) => n.id)
    // D-5 is retired, D-32 is NOT a janitorial retraction (non-Retract body)
    expect(ids).toContain('decision:D-32')
    expect(ids).not.toContain('decision:D-5')
  })

  it('token-overlap matching: descriptive retires text suppresses matching legacy entries', () => {
    // A retiring decision references a legacy one by descriptive text (no structured id match)
    // The reference text has ≥60% token overlap with the legacy decision's normalised text.
    const fold = makeFold([
      // Legacy decision whose text contains the tokens
      { id: 'decision:_legacy_ord_2', type: 'decision', attrs: { decision: 'Adopt strict typescript typing approach for consumers', _ord: 2 } },
      // Retiring decision with a descriptive retires reference (not a known structured id)
      { id: 'decision:D-10', type: 'decision', attrs: { title: 'Use strict TypeScript with ESM modules', retires: 'adopt strict typescript typing approach', _ord: 10 } },
    ])
    const result = readOrderedDecisionsFromFold(fold)
    const ids = result.map((n) => n.id)
    // The legacy entry should be suppressed by token-overlap match
    expect(ids).not.toContain('decision:_legacy_ord_2')
    // D-10 survives (it's the retiring decision, not the retracted one)
    expect(ids).toContain('decision:D-10')
  })

  it('accepts optional events argument without error', () => {
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'Test', _ord: 1 } },
    ])
    // Must not throw when events are passed
    const result = readOrderedDecisionsFromFold(fold, [{ type: 'DECISION', data: { id: 'D-1', title: 'Test' } }])
    expect(result).toHaveLength(1)
  })
})

// ── validateFoldRefs ──────────────────────────────────────────────────────────

describe('validateFoldRefs', () => {
  const fold = makeFold([
    { id: 'decision:D-1', type: 'decision', attrs: { title: 'A' } },
    { id: 'decision:D-2', type: 'decision', attrs: { title: 'B' } },
    { id: 'ac:AC1', type: 'acceptance-criterion', attrs: { ac: 'AC1' } },
    { id: 'ac:AC2', type: 'acceptance-criterion', attrs: { ac: 'AC2' } },
  ])

  it('partitions decision refs into valid and missing', () => {
    const { valid, missing } = validateFoldRefs(fold, ['decision:D-1', 'decision:D-99'], 'decision')
    expect(valid).toEqual(['decision:D-1'])
    expect(missing).toEqual(['decision:D-99'])
  })

  it('partitions ac refs using acceptance-criterion type', () => {
    const { valid, missing } = validateFoldRefs(fold, ['ac:AC1', 'ac:AC99'], 'acceptance-criterion')
    expect(valid).toEqual(['ac:AC1'])
    expect(missing).toEqual(['ac:AC99'])
  })

  it("accepts 'ac' as alias for 'acceptance-criterion'", () => {
    const { valid, missing } = validateFoldRefs(fold, ['ac:AC2', 'ac:AC3'], 'ac')
    expect(valid).toEqual(['ac:AC2'])
    expect(missing).toEqual(['ac:AC3'])
  })

  it('returns all valid when every ref exists', () => {
    const { valid, missing } = validateFoldRefs(fold, ['decision:D-1', 'decision:D-2'], 'decision')
    expect(valid).toHaveLength(2)
    expect(missing).toHaveLength(0)
  })

  it('returns all missing when none exist', () => {
    const { valid, missing } = validateFoldRefs(fold, ['decision:D-99', 'decision:D-100'], 'decision')
    expect(valid).toHaveLength(0)
    expect(missing).toHaveLength(2)
  })

  it('bites: wrong implementation that returns all-valid would fail the missing assertion', () => {
    // This test fails if validateFoldRefs ignores the type filter
    const { missing } = validateFoldRefs(fold, ['decision:D-99'], 'decision')
    expect(missing).toContain('decision:D-99')
  })

  it('returns empty valid and empty missing for empty refIds', () => {
    const { valid, missing } = validateFoldRefs(fold, [], 'decision')
    expect(valid).toHaveLength(0)
    expect(missing).toHaveLength(0)
  })
})

// ── extractACCoverageFromFold ─────────────────────────────────────────────────

describe('extractACCoverageFromFold', () => {
  it('returns empty Map for fold with no AC nodes', () => {
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'X' } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    expect(coverage).toBeInstanceOf(Map)
    expect(coverage.size).toBe(0)
  })

  it('collects all AC nodes by fold node id', () => {
    const fold = makeFold([
      { id: 'ac:AC1', type: 'acceptance-criterion', attrs: { ac: 'AC1', covering: ['S1', 'S2'] } },
      { id: 'ac:AC2', type: 'acceptance-criterion', attrs: { ac: 'AC2' } },
      { id: 'ac:AC3', type: 'acceptance-criterion', attrs: { ac: 'AC3', covering: [] } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    expect(coverage.size).toBe(3)
    expect(coverage.has('ac:AC1')).toBe(true)
    expect(coverage.has('ac:AC2')).toBe(true)
    expect(coverage.has('ac:AC3')).toBe(true)
  })

  it('preserves ac and covering fields from attrs', () => {
    const fold = makeFold([
      { id: 'ac:AC1', type: 'acceptance-criterion', attrs: { ac: 'AC1', covering: ['S1'] } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    expect(coverage.get('ac:AC1')).toEqual({ ac: 'AC1', covering: ['S1'] })
  })

  it('covering is undefined when not set on AC node (coverage-form only)', () => {
    const fold = makeFold([
      { id: 'ac:AC2', type: 'acceptance-criterion', attrs: { ac: 'AC2' } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    const entry = coverage.get('ac:AC2')
    expect(entry?.ac).toBe('AC2')
    expect(entry?.covering).toBeUndefined()
  })

  it('ignores non-AC nodes (decision, slice, etc.)', () => {
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: { title: 'X' } },
      { id: 'slice:S1',     type: 'slice',    attrs: { slice: 'S1' } },
      { id: 'ac:AC1',       type: 'acceptance-criterion', attrs: { ac: 'AC1' } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    // Only 1 entry — the AC node
    expect(coverage.size).toBe(1)
    expect(coverage.has('ac:AC1')).toBe(true)
  })

  it('bites: wrong impl returning all nodes would have size > 1 for a mixed fold', () => {
    const fold = makeFold([
      { id: 'decision:D-1', type: 'decision', attrs: {} },
      { id: 'ac:AC1',       type: 'acceptance-criterion', attrs: { ac: 'AC1' } },
    ])
    const coverage = extractACCoverageFromFold(fold)
    // Must be exactly 1 (AC only), not 2 (if it mistakenly includes D-1)
    expect(coverage.size).toBe(1)
  })
})
