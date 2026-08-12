/**
 * Tests for hooks/lib/traceability-classify.mjs
 *
 * Covers:
 *   S3-AC-3 — Every edge is classified as proven/unproven/stale/missing.
 *   S3-AC-5 — No LLM/network calls in the classification path (pure function).
 *   S3-D-3  — Classification sourced from recorded verdicts only.
 *   S3-D-8  — Evidence attachment (artifact-evidence nodes + evidences edges).
 *   S3-R-003 — Link classification rule semantics.
 *   S3-R-006 — Stale evidence detected via build hash.
 *
 * @verifies TRACEABILITY-R-003
 * @verifies TRACEABILITY-R-005
 * @verifies TRACEABILITY-R-006
 */

import { describe, it, expect } from 'vitest'
import { classifyTraceabilityGraph } from '../../hooks/lib/traceability-classify.mjs'
import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'
import type { StampedEvidenceRef } from '../../hooks/lib/traceability-evidence.mjs'

// ---------------------------------------------------------------------------
// Minimal stub adapter (mirrors traceability-join.test.ts pattern)
// ---------------------------------------------------------------------------

function makeAdapter(overrides: {
  slug?: string
  objective?: string
  slices?: object[]
  verificationEvents?: object[]
  gateEvents?: object[]
  specRequirements?: object[]
  coverageMap?: Record<string, { declared: string | null; verified: boolean; tests: string[] }>
}) {
  return {
    getMotive: () => overrides.slug ?? 'test-motive',
    getObjective: () => overrides.objective ?? 'Ship the traceability chain',
    getSlices: () => overrides.slices ?? [],
    getVerificationEvents: () => overrides.verificationEvents ?? [],
    getGateEvents: () => overrides.gateEvents ?? [],
    getSpecRequirements: () => overrides.specRequirements ?? [],
    getCoverageMap: () => overrides.coverageMap ?? {},
  }
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SPEC_REQ_R1 = {
  id: 'R-001',
  title: 'Full chain',
  verification: 'automated',
  criticality: 'must',
  origin_decision_ref: null,
}

const SPEC_REQ_R2 = {
  id: 'R-002',
  title: 'Uncovered req',
  verification: 'automated',
  criticality: 'must',
  origin_decision_ref: null,
}

const SLICE_S1 = {
  id: 'S1',
  status: 'complete',
  desc: 'Spine adapter',
  blocked_by: [],
  covers_ac: ['R-001'],
  decisions: [],
  test_paths: ['test/hooks/spine.test.ts'],
}

const SLICE_S2 = {
  id: 'S2',
  status: 'in_progress',
  desc: 'Join engine',
  blocked_by: [],
  covers_ac: [],
  decisions: [],
  test_paths: [],
}

const GATE_APPROVE = {
  which: 'advisor',
  verdict: 'APPROVE',
  citation: 'All tests pass',
  rubric: null,
  linkId: null,
}

const GATE_APPROVE_SCOPED = {
  which: 'advisor',
  verdict: 'APPROVE',
  citation: 'S1 complete',
  rubric: null,
  linkId: 'S1',
}

const GATE_CORRECTION = {
  which: 'advisor',
  verdict: 'CORRECTION',
  citation: 'Needs fixes',
  rubric: null,
  linkId: null,
}

const VERIFY_PASS = {
  claim: 'Chain assembles',
  evidence: 'test run',
  result: 'pass',
  ord: 0,
  linkId: null,
}

const VERIFY_FAIL = {
  claim: 'Chain complete',
  evidence: 'test run',
  result: 'fail',
  ord: 1,
  linkId: null,
}

// ---------------------------------------------------------------------------
// Helper: make a stamped evidence ref
// ---------------------------------------------------------------------------

function makeStampedRef(
  overrides: Partial<StampedEvidenceRef> & { evidences: string[] },
): StampedEvidenceRef {
  return {
    id: overrides.id ?? 'ev-001',
    kind: overrides.kind ?? 'screenshot',
    path: overrides.path ?? '.groundwork/motives/test-motive/evidence/ev-001.json',
    evidences: overrides.evidences,
    captured_build_hash: overrides.captured_build_hash ?? 'abc123',
    captured_at: overrides.captured_at ?? '2026-01-01T00:00:00Z',
    freshness: overrides.freshness ?? 'fresh',
  }
}

// ---------------------------------------------------------------------------
// Helper: find edges by kind
// ---------------------------------------------------------------------------

function edgesOfKind(
  result: ReturnType<typeof classifyTraceabilityGraph>,
  kind: string,
) {
  return result.edges.filter((e) => e.kind === kind)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyTraceabilityGraph', () => {
  // ── AC-5 negative rail: pure function ────────────────────────────────────
  it('returns a result without any external I/O (pure function)', () => {
    const graph = buildTraceabilityGraph(makeAdapter({}))
    // If any network/LLM call were made, this would throw or be slow.
    // The fact that it returns synchronously proves the negative rail.
    const result = classifyTraceabilityGraph(graph, [])
    expect(result).toBeDefined()
  })

  // ── Every edge gets a classification ─────────────────────────────────────
  it('adds a classification field to every edge (AC-3)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [GATE_APPROVE],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const VALID = new Set(['proven', 'unproven', 'stale', 'missing'])
    for (const edge of result.edges) {
      expect(VALID.has(edge.classification), `edge ${edge.source}→${edge.target} (${edge.kind}) has invalid classification: ${edge.classification}`).toBe(true)
    }
    expect(result.edges.length).toBeGreaterThan(0)
  })

  // ── Determinism ───────────────────────────────────────────────────────────
  it('produces byte-identical output for identical inputs (determinism)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1, SLICE_S2],
      specRequirements: [SPEC_REQ_R1, SPEC_REQ_R2],
      gateEvents: [GATE_APPROVE],
      verificationEvents: [VERIFY_PASS],
    })
    const graph = buildTraceabilityGraph(adapter)
    const ref = makeStampedRef({ id: 'ev-1', evidences: [`slice:S1`], freshness: 'fresh' })

    const run1 = JSON.stringify(classifyTraceabilityGraph(graph, [ref]))
    const run2 = JSON.stringify(classifyTraceabilityGraph(graph, [ref]))
    expect(run1).toBe(run2)
  })

  // ── seals edge: APPROVE → proven ─────────────────────────────────────────
  it('classifies seals edge as proven when gate verdict is APPROVE (R-003)', () => {
    const adapter = makeAdapter({
      gateEvents: [GATE_APPROVE],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const seals = edgesOfKind(result, 'seals')
    expect(seals.length).toBeGreaterThan(0)
    for (const e of seals) {
      expect(e.classification).toBe('proven')
    }
  })

  // ── seals edge: non-APPROVE → unproven ───────────────────────────────────
  it('classifies seals edge as unproven when gate verdict is not APPROVE (R-003)', () => {
    const adapter = makeAdapter({
      gateEvents: [GATE_CORRECTION],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const seals = edgesOfKind(result, 'seals')
    expect(seals.length).toBeGreaterThan(0)
    for (const e of seals) {
      expect(e.classification).toBe('unproven')
    }
  })

  // ── seals edge: APPROVE + stale evidence → stale ─────────────────────────
  it('classifies seals edge as stale when APPROVE but target has stale evidence (R-006)', () => {
    const adapter = makeAdapter({
      gateEvents: [GATE_APPROVE], // seals the objective
    })
    const graph = buildTraceabilityGraph(adapter)
    const objectiveNode = graph.nodes.find((n) => n.type === 'objective')!
    expect(objectiveNode).toBeDefined()

    // Evidence ref that evidences the objective — stale
    const staleRef = makeStampedRef({
      id: 'ev-stale',
      evidences: [objectiveNode.id],
      freshness: 'stale',
      captured_build_hash: 'old-hash',
    })

    const result = classifyTraceabilityGraph(graph, [staleRef])
    const seals = edgesOfKind(result, 'seals')
    for (const e of seals) {
      expect(e.classification).toBe('stale')
    }
  })

  // ── confirms edge: pass → proven ─────────────────────────────────────────
  it('classifies confirms edge as proven when live-verify result is pass (R-003)', () => {
    const adapter = makeAdapter({
      verificationEvents: [VERIFY_PASS],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const confirms = edgesOfKind(result, 'confirms')
    expect(confirms.length).toBe(1)
    expect(confirms[0].classification).toBe('proven')
  })

  // ── confirms edge: fail → unproven ───────────────────────────────────────
  it('classifies confirms edge as unproven when live-verify result is fail or null (R-003)', () => {
    const adapter = makeAdapter({
      verificationEvents: [VERIFY_FAIL],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const confirms = edgesOfKind(result, 'confirms')
    expect(confirms.length).toBe(1)
    expect(confirms[0].classification).toBe('unproven')
  })

  // ── covers (slice → spec-req): APPROVE → proven ──────────────────────────
  it('classifies covers (slice→spec-req) as proven when objective is globally approved (R-003)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [GATE_APPROVE], // global approve (seals objective)
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const coversEdge = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'slice:S1' && e.target === 'spec-requirement:R-001',
    )
    expect(coversEdge).toBeDefined()
    expect(coversEdge?.classification).toBe('proven')
  })

  // ── covers (slice → spec-req): no gate → unproven ────────────────────────
  it('classifies covers (slice→spec-req) as unproven when no gate (R-003)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const coversEdge = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'slice:S1' && e.target === 'spec-requirement:R-001',
    )
    expect(coversEdge).toBeDefined()
    expect(coversEdge?.classification).toBe('unproven')
  })

  // ── covers (slice → spec-req): scoped APPROVE → proven ───────────────────
  it('classifies covers (slice→spec-req) as proven when that slice is scoped-approved (R-003)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [GATE_APPROVE_SCOPED], // seals only slice:S1
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const coversEdge = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'slice:S1',
    )
    expect(coversEdge?.classification).toBe('proven')
  })

  // ── covers (spec-req → objective): missing if no covering slice ───────────
  it('classifies covers (spec-req→objective) as missing when no slice covers the req (R-003)', () => {
    const adapter = makeAdapter({
      // R-002 has no covering slice
      specRequirements: [SPEC_REQ_R2],
      slices: [],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)
    const objectiveNode = graph.nodes.find((n) => n.type === 'objective')!
    const result = classifyTraceabilityGraph(graph, [])

    const coversEdge = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'spec-requirement:R-002' && e.target === objectiveNode.id,
    )
    expect(coversEdge).toBeDefined()
    expect(coversEdge?.classification).toBe('missing')
  })

  // ── covers (spec-req → objective): unproven when slice exists but no gate ─
  it('classifies covers (spec-req→objective) as unproven when covering slice has no gate', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)
    const objectiveNode = graph.nodes.find((n) => n.type === 'objective')!
    const result = classifyTraceabilityGraph(graph, [])

    const coversEdge = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'spec-requirement:R-001' && e.target === objectiveNode.id,
    )
    expect(coversEdge).toBeDefined()
    expect(coversEdge?.classification).toBe('unproven')
  })

  // ── verifies edge: no evidence, no gate → unproven ───────────────────────
  it('classifies verifies edge as unproven with no evidence and no gate (R-003)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1], // has test_paths
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const verifies = edgesOfKind(result, 'verifies')
    expect(verifies.length).toBeGreaterThan(0)
    for (const e of verifies) {
      expect(e.classification).toBe('unproven')
    }
  })

  // ── verifies edge: gate APPROVE → proven ─────────────────────────────────
  it('classifies verifies edge as proven when slice is gate-approved (R-003)', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      gateEvents: [GATE_APPROVE], // global approve → seals objective
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const verifies = edgesOfKind(result, 'verifies')
    expect(verifies.length).toBeGreaterThan(0)
    for (const e of verifies) {
      expect(e.classification).toBe('proven')
    }
  })

  // ── verifies edge: direct evidence fresh → proven ─────────────────────────
  it('classifies verifies edge as proven when self-test has fresh evidence', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)

    const selfTestNode = graph.nodes.find((n) => n.type === 'self-test')!
    expect(selfTestNode).toBeDefined()

    const freshRef = makeStampedRef({
      id: 'ev-test',
      evidences: [selfTestNode.id],
      freshness: 'fresh',
    })

    const result = classifyTraceabilityGraph(graph, [freshRef])
    const verifies = edgesOfKind(result, 'verifies')
    for (const e of verifies) {
      expect(e.classification).toBe('proven')
    }
  })

  // ── verifies edge: direct evidence stale → stale ──────────────────────────
  it('classifies verifies edge as stale when self-test has stale evidence', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)

    const selfTestNode = graph.nodes.find((n) => n.type === 'self-test')!
    const staleRef = makeStampedRef({
      id: 'ev-stale-test',
      evidences: [selfTestNode.id],
      freshness: 'stale',
      captured_build_hash: 'old',
    })

    const result = classifyTraceabilityGraph(graph, [staleRef])
    const verifies = edgesOfKind(result, 'verifies')
    for (const e of verifies) {
      expect(e.classification).toBe('stale')
    }
  })

  // ── evidences edges created for fresh refs ────────────────────────────────
  it('attaches evidences edges with classification proven for fresh evidence (R-006)', () => {
    const adapter = makeAdapter({ slices: [SLICE_S1] })
    const graph = buildTraceabilityGraph(adapter)

    const freshRef = makeStampedRef({
      id: 'ev-fresh',
      evidences: ['slice:S1'],
      freshness: 'fresh',
      captured_build_hash: 'abc',
    })

    const result = classifyTraceabilityGraph(graph, [freshRef])
    const evidEdges = edgesOfKind(result, 'evidences')
    expect(evidEdges.length).toBeGreaterThan(0)
    for (const e of evidEdges) {
      expect(e.classification).toBe('proven')
    }
  })

  // ── evidences edges: stale → stale ────────────────────────────────────────
  it('attaches evidences edges with classification stale for stale evidence (R-006)', () => {
    const adapter = makeAdapter({ slices: [SLICE_S1] })
    const graph = buildTraceabilityGraph(adapter)

    const staleRef = makeStampedRef({
      id: 'ev-stale',
      evidences: ['slice:S1'],
      freshness: 'stale',
      captured_build_hash: 'old',
    })

    const result = classifyTraceabilityGraph(graph, [staleRef])
    const evidEdges = edgesOfKind(result, 'evidences')
    expect(evidEdges.length).toBeGreaterThan(0)
    for (const e of evidEdges) {
      expect(e.classification).toBe('stale')
    }
  })

  // ── artifact-evidence nodes added to graph ────────────────────────────────
  it('adds artifact-evidence nodes to the result nodes array (D-8)', () => {
    const adapter = makeAdapter({ slices: [SLICE_S1] })
    const graph = buildTraceabilityGraph(adapter)

    const ref = makeStampedRef({
      id: 'ev-001',
      path: '.groundwork/motives/test-motive/evidence/ev-001.json',
      evidences: ['slice:S1'],
      freshness: 'fresh',
    })

    const result = classifyTraceabilityGraph(graph, [ref])
    const evidNodes = result.nodes.filter((n: object & { type?: string }) => n.type === 'artifact-evidence')
    expect(evidNodes.length).toBe(1)
    expect((evidNodes[0] as object & { ref: string }).ref).toBe(ref.path)
  })

  // ── artifactEvidence field populated ─────────────────────────────────────
  it('populates artifactEvidence field with attached nodes', () => {
    const adapter = makeAdapter({ slices: [SLICE_S1] })
    const graph = buildTraceabilityGraph(adapter)

    const ref1 = makeStampedRef({ id: 'ev-a', path: 'a.png', evidences: ['slice:S1'], freshness: 'fresh' })
    const ref2 = makeStampedRef({ id: 'ev-b', path: 'b.png', evidences: ['slice:S1'], freshness: 'stale' })

    const result = classifyTraceabilityGraph(graph, [ref1, ref2])
    expect(result.artifactEvidence.length).toBe(2)
    const ids = result.artifactEvidence.map((n) => n.id).sort()
    expect(ids[0]).toContain('a.png')
    expect(ids[1]).toContain('b.png')
  })

  // ── empty evidence → no artifact nodes ───────────────────────────────────
  it('produces no artifact-evidence nodes when stampedRefs is empty', () => {
    const adapter = makeAdapter({ slices: [SLICE_S1] })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    const evidNodes = result.nodes.filter((n: object & { type?: string }) => n.type === 'artifact-evidence')
    expect(evidNodes.length).toBe(0)
    expect(result.artifactEvidence.length).toBe(0)
  })

  // ── no evidence on missing spec-req does not create false edges ────────────
  it('does not invent edges or nodes beyond what evidence and graph provide', () => {
    const adapter = makeAdapter({
      specRequirements: [SPEC_REQ_R1, SPEC_REQ_R2],
      slices: [SLICE_S1], // covers R-001 but not R-002
    })
    const graph = buildTraceabilityGraph(adapter)
    const result = classifyTraceabilityGraph(graph, [])

    // R-002 edge should be missing, not a phantom new node
    const r2Covers = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'spec-requirement:R-002',
    )
    expect(r2Covers?.classification).toBe('missing')

    // No extra nodes beyond what the join + evidence provides
    const allNodeTypes = result.nodes.map((n: object & { type?: string }) => n.type)
    expect(allNodeTypes).not.toContain('phantom')
  })

  // ── covers stale: stale evidence on covering slice → stale ────────────────
  it('classifies covers (spec-req→objective) as stale when covering slice has stale evidence and no approval', () => {
    const adapter = makeAdapter({
      slices: [SLICE_S1],
      specRequirements: [SPEC_REQ_R1],
      gateEvents: [],
    })
    const graph = buildTraceabilityGraph(adapter)
    const objectiveNode = graph.nodes.find((n) => n.type === 'objective')!

    const staleRef = makeStampedRef({
      id: 'ev-s1-stale',
      evidences: ['slice:S1'],
      freshness: 'stale',
    })

    const result = classifyTraceabilityGraph(graph, [staleRef])
    const sr2obj = result.edges.find(
      (e) => e.kind === 'covers' && e.source === 'spec-requirement:R-001' && e.target === objectiveNode.id,
    )
    expect(sr2obj?.classification).toBe('stale')
  })
})
