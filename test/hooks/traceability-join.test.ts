/**
 * Tests for hooks/lib/traceability-join.mjs
 *
 * Covers:
 *   (a) Full six-tier chain assembly — nodes per tier, expected edges
 *   (b) Determinism — identical input yields deep-equal output AND identical JSON.stringify
 *
 * @verifies TRACEABILITY-R-002
 * @verifies TRACEABILITY-R-004
 */

import { describe, it, expect } from 'vitest'
import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal stub adapter from plain data objects. */
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
    getObjective: () => overrides.objective ?? 'Deliver a working traceability chain',
    getSlices: () => overrides.slices ?? [],
    getVerificationEvents: () => overrides.verificationEvents ?? [],
    getGateEvents: () => overrides.gateEvents ?? [],
    getSpecRequirements: () => overrides.specRequirements ?? [],
    getCoverageMap: () => overrides.coverageMap ?? {},
  }
}

// ---------------------------------------------------------------------------
// Small but complete fixture
// ---------------------------------------------------------------------------

const FIXTURE_SLUG = 'tracking-viz'

const FIXTURE_SPEC_REQS = [
  {
    id: 'TRACEABILITY-R-001',
    title: 'Full chain visibility',
    verification: 'automated',
    criticality: 'must',
    origin_decision_ref: 'tracking-viz#D-7',
  },
  {
    id: 'TRACEABILITY-R-002',
    title: 'Deterministic output',
    verification: 'automated',
    criticality: 'must',
    origin_decision_ref: 'tracking-viz#D-8',
  },
]

const FIXTURE_SLICES = [
  {
    id: 'S1',
    status: 'complete',
    desc: 'Spine adapter',
    blocked_by: [],
    covers_ac: [],
    decisions: ['tracking-viz#D-7'],
    test_paths: ['test/hooks/spine-adapter.test.ts'],
  },
  {
    id: 'S2',
    status: 'in_progress',
    desc: 'Join engine',
    blocked_by: ['S1'],
    covers_ac: ['TRACEABILITY-R-002'],
    decisions: ['tracking-viz#D-7', 'tracking-viz#D-8'],
    test_paths: ['test/hooks/traceability-join.test.ts'],
  },
]

const FIXTURE_VERIFICATIONS = [
  {
    claim: 'Graph assembles without errors',
    evidence: 'test run',
    result: 'pass',
    ord: 0,
    linkId: 'S1',
  },
  {
    claim: 'Output is byte-identical on repeat',
    evidence: 'JSON.stringify comparison',
    result: 'pass',
    ord: 1,
    linkId: null,
  },
]

const FIXTURE_GATES = [
  {
    which: 'advisor',
    verdict: 'APPROVE',
    citation: 'All tests pass',
    rubric: null,
    linkId: null,
  },
]

const FIXTURE_COVERAGE: Record<string, { declared: string | null; verified: boolean; tests: string[] }> = {
  'TRACEABILITY-R-001': {
    declared: 'automated',
    verified: true,
    tests: ['test/hooks/spine-adapter.test.ts'],
  },
  'TRACEABILITY-R-002': {
    declared: 'automated',
    verified: false,
    tests: ['test/hooks/traceability-join.test.ts'],
  },
}

// ---------------------------------------------------------------------------
// (a) Chain assembly — nodes per tier, expected edges
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — chain assembly', () => {
  const adapter = makeAdapter({
    slug: FIXTURE_SLUG,
    specRequirements: FIXTURE_SPEC_REQS,
    slices: FIXTURE_SLICES,
    verificationEvents: FIXTURE_VERIFICATIONS,
    gateEvents: FIXTURE_GATES,
    coverageMap: FIXTURE_COVERAGE,
  })

  const graph = buildTraceabilityGraph(adapter)

  it('returns nodes and edges arrays', () => {
    expect(Array.isArray(graph.nodes)).toBe(true)
    expect(Array.isArray(graph.edges)).toBe(true)
  })

  // --- Tier 1: objective ---
  it('contains exactly one objective node', () => {
    const objs = graph.nodes.filter((n: any) => n.type === 'objective')
    expect(objs).toHaveLength(1)
    expect((objs[0] as any).id).toBe(`objective:${FIXTURE_SLUG}`)
  })

  // --- Tier 2: spec-req ---
  it('contains a spec-req node for each requirement', () => {
    const srs = graph.nodes.filter((n: any) => n.type === 'spec-requirement')
    expect(srs).toHaveLength(FIXTURE_SPEC_REQS.length)
    const ids = srs.map((n: any) => n.id).sort()
    expect(ids).toEqual([
      'spec-requirement:TRACEABILITY-R-001',
      'spec-requirement:TRACEABILITY-R-002',
    ])
  })

  it('wires covers edges from each spec-req to the objective', () => {
    const coversSrToObj = graph.edges.filter(
      (e: any) =>
        e.kind === 'covers' &&
        e.source.startsWith('spec-requirement:') &&
        e.target === `objective:${FIXTURE_SLUG}`,
    )
    expect(coversSrToObj).toHaveLength(FIXTURE_SPEC_REQS.length)
  })

  // --- Tier 3: slice ---
  it('contains a slice node for each ledger slice', () => {
    const sliceNodes = graph.nodes.filter((n: any) => n.type === 'slice')
    expect(sliceNodes).toHaveLength(FIXTURE_SLICES.length)
    const ids = sliceNodes.map((n: any) => n.id).sort()
    expect(ids).toEqual(['slice:S1', 'slice:S2'])
  })

  it('wires a blocked_by edge from S2 to S1', () => {
    const blockedBy = graph.edges.filter(
      (e: any) => e.kind === 'blocked_by',
    )
    expect(blockedBy).toHaveLength(1)
    expect(blockedBy[0]).toMatchObject({
      source: 'slice:S2',
      target: 'slice:S1',
      kind: 'blocked_by',
    })
  })

  it('wires covers edge from S2 (via covers_ac) to TRACEABILITY-R-002', () => {
    const coversSliceToSr = graph.edges.filter(
      (e: any) =>
        e.kind === 'covers' &&
        e.source === 'slice:S2' &&
        e.target === 'spec-requirement:TRACEABILITY-R-002',
    )
    expect(coversSliceToSr.length).toBeGreaterThanOrEqual(1)
  })

  it('wires covers edge from S1 (via decision) to TRACEABILITY-R-001', () => {
    // S1 has decisions: ['tracking-viz#D-7']
    // TRACEABILITY-R-001 has origin_decision_ref: 'tracking-viz#D-7'
    const coversS1 = graph.edges.filter(
      (e: any) =>
        e.kind === 'covers' &&
        e.source === 'slice:S1' &&
        e.target === 'spec-requirement:TRACEABILITY-R-001',
    )
    expect(coversS1.length).toBeGreaterThanOrEqual(1)
  })

  // --- Tier 4: self-test ---
  it('contains a self-test node for each direct test_path across slices', () => {
    const stNodes = graph.nodes.filter((n: any) => n.type === 'self-test')
    // S1: 1 test_path, S2: 1 test_path → 2 direct self-test nodes
    expect(stNodes.length).toBeGreaterThanOrEqual(2)
  })

  it('wires verifies edges from self-test nodes to their slice', () => {
    const verifiesEdges = graph.edges.filter((e: any) => e.kind === 'verifies')
    expect(verifiesEdges.length).toBeGreaterThanOrEqual(2)
    const s1Verifiers = verifiesEdges.filter((e: any) => e.target === 'slice:S1')
    expect(s1Verifiers.length).toBeGreaterThanOrEqual(1)
    const s2Verifiers = verifiesEdges.filter((e: any) => e.target === 'slice:S2')
    expect(s2Verifiers.length).toBeGreaterThanOrEqual(1)
  })

  it('self-test nodes have source=direct when test_paths is present', () => {
    const stNodes = graph.nodes.filter((n: any) => n.type === 'self-test')
    // All slices in this fixture have test_paths, so all should be direct
    for (const n of stNodes) {
      expect((n as any).source).toBe('direct')
    }
  })

  // --- Tier 5: live-verify ---
  it('contains a live-verify node for each VERIFICATION event', () => {
    const lvNodes = graph.nodes.filter((n: any) => n.type === 'live-verify')
    expect(lvNodes).toHaveLength(FIXTURE_VERIFICATIONS.length)
  })

  it('wires confirms edge to slice when linkId matches a known slice', () => {
    // Verification #0 has linkId 'S1'
    const confirmsToS1 = graph.edges.filter(
      (e: any) => e.kind === 'confirms' && e.target === 'slice:S1',
    )
    expect(confirmsToS1).toHaveLength(1)
    expect(confirmsToS1[0].source).toBe('live-verify:0')
  })

  it('wires confirms edge to objective when linkId is null', () => {
    // Verification #1 has linkId null
    const confirmsToObj = graph.edges.filter(
      (e: any) =>
        e.kind === 'confirms' &&
        e.target === `objective:${FIXTURE_SLUG}` &&
        e.source === 'live-verify:1',
    )
    expect(confirmsToObj).toHaveLength(1)
  })

  // --- Tier 6: gate ---
  it('contains a gate node for each GATE event', () => {
    const gNodes = graph.nodes.filter((n: any) => n.type === 'gate')
    expect(gNodes).toHaveLength(FIXTURE_GATES.length)
    expect((gNodes[0] as any).id).toBe('gate:advisor')
    expect((gNodes[0] as any).verdict).toBe('APPROVE')
  })

  it('wires seals edge from gate to objective when linkId is null', () => {
    const sealsEdges = graph.edges.filter((e: any) => e.kind === 'seals')
    expect(sealsEdges).toHaveLength(1)
    expect(sealsEdges[0]).toMatchObject({
      source: 'gate:advisor',
      target: `objective:${FIXTURE_SLUG}`,
      kind: 'seals',
    })
  })

  // --- artifact-evidence extension point ---
  it('exposes artifactEvidence as an empty array (S3 extension point)', () => {
    expect(graph.artifactEvidence).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (a) Edge cases — decision-mediated self-test fallback
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — decision-mediated self-test fallback', () => {
  const sliceNoTestPaths = {
    id: 'S-DM',
    status: 'pending',
    desc: 'Decision-mediated slice',
    blocked_by: [],
    covers_ac: [],
    decisions: ['tracking-viz#D-7'],
    test_paths: [], // deliberately empty → triggers fallback
  }

  const adapter = makeAdapter({
    slug: 'test-motive',
    specRequirements: [
      {
        id: 'TRACEABILITY-R-001',
        title: 'Full chain',
        verification: 'automated',
        criticality: 'must',
        origin_decision_ref: 'tracking-viz#D-7',
      },
    ],
    slices: [sliceNoTestPaths],
    coverageMap: {
      'TRACEABILITY-R-001': {
        declared: 'automated',
        verified: true,
        tests: ['test/hooks/spine.test.ts', 'test/hooks/join.test.ts'],
      },
    },
  })

  const graph = buildTraceabilityGraph(adapter)

  it('produces decision-mediated self-test nodes when test_paths is empty', () => {
    const stNodes = graph.nodes.filter((n: any) => n.type === 'self-test')
    expect(stNodes.length).toBe(2) // two tests from coverage map
    for (const n of stNodes) {
      expect((n as any).source).toBe('decision-mediated')
      expect((n as any).sliceId).toBe('S-DM')
    }
  })

  it('wires verifies edges from decision-mediated self-tests to the slice', () => {
    const verifiesEdges = graph.edges.filter((e: any) => e.kind === 'verifies')
    expect(verifiesEdges).toHaveLength(2)
    for (const e of verifiesEdges) {
      expect(e.target).toBe('slice:S-DM')
    }
  })
})

// ---------------------------------------------------------------------------
// (a) Edge cases — empty adapter (no data)
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — empty adapter', () => {
  const adapter = makeAdapter({ slug: 'empty-motive', objective: 'Nothing here' })
  const graph = buildTraceabilityGraph(adapter)

  it('returns at least the objective node', () => {
    expect(graph.nodes.filter((n: any) => n.type === 'objective')).toHaveLength(1)
  })

  it('returns no spec-req, slice, self-test, live-verify, or gate nodes', () => {
    const typed = graph.nodes.filter((n: any) => n.type !== 'objective')
    expect(typed).toHaveLength(0)
  })

  it('returns no edges', () => {
    expect(graph.edges).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// (a) Edge cases — seals edge to slice when gate.linkId matches
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — gate seals a specific slice', () => {
  const adapter = makeAdapter({
    slug: 'motive-a',
    slices: [{ id: 'S1', status: 'complete', blocked_by: [], covers_ac: [], decisions: [], test_paths: [] }],
    gateEvents: [{ which: 'qa', verdict: 'APPROVE', citation: null, rubric: null, linkId: 'S1' }],
  })

  const graph = buildTraceabilityGraph(adapter)

  it('seals the gate to the specific slice, not the objective', () => {
    const seals = graph.edges.filter((e: any) => e.kind === 'seals')
    expect(seals).toHaveLength(1)
    expect(seals[0]).toMatchObject({
      source: 'gate:qa',
      target: 'slice:S1',
      kind: 'seals',
    })
  })
})

// ---------------------------------------------------------------------------
// (b) DETERMINISM — identical input yields deep-equal and byte-identical output
// ---------------------------------------------------------------------------

describe('buildTraceabilityGraph — determinism (AC-4)', () => {
  const adapter = makeAdapter({
    slug: FIXTURE_SLUG,
    specRequirements: FIXTURE_SPEC_REQS,
    slices: FIXTURE_SLICES,
    verificationEvents: FIXTURE_VERIFICATIONS,
    gateEvents: FIXTURE_GATES,
    coverageMap: FIXTURE_COVERAGE,
  })

  it('two calls from the same adapter produce deep-equal graphs', () => {
    const g1 = buildTraceabilityGraph(adapter)
    const g2 = buildTraceabilityGraph(adapter)
    expect(g1).toEqual(g2)
  })

  it('two calls produce byte-identical JSON.stringify output', () => {
    const g1 = buildTraceabilityGraph(adapter)
    const g2 = buildTraceabilityGraph(adapter)
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2))
  })

  it('nodes are sorted by id (stable ascending order)', () => {
    const graph = buildTraceabilityGraph(adapter)
    const ids = graph.nodes.map((n: any) => n.id)
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  it('edges are sorted by source|target|kind (stable ascending order)', () => {
    const graph = buildTraceabilityGraph(adapter)
    const keys = graph.edges.map((e: any) => `${e.source}\x00${e.target}\x00${e.kind}`)
    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
  })

  it('edges contain no duplicates', () => {
    const graph = buildTraceabilityGraph(adapter)
    const keys = graph.edges.map((e: any) => `${e.source}|${e.target}|${e.kind}`)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('graphs assembled from independently-constructed adapters with same data are byte-identical', () => {
    const adapterA = makeAdapter({
      slug: FIXTURE_SLUG,
      specRequirements: FIXTURE_SPEC_REQS,
      slices: FIXTURE_SLICES,
      verificationEvents: FIXTURE_VERIFICATIONS,
      gateEvents: FIXTURE_GATES,
      coverageMap: FIXTURE_COVERAGE,
    })
    const adapterB = makeAdapter({
      slug: FIXTURE_SLUG,
      // deliberately pass copies (same values, different object references)
      specRequirements: JSON.parse(JSON.stringify(FIXTURE_SPEC_REQS)),
      slices: JSON.parse(JSON.stringify(FIXTURE_SLICES)),
      verificationEvents: JSON.parse(JSON.stringify(FIXTURE_VERIFICATIONS)),
      gateEvents: JSON.parse(JSON.stringify(FIXTURE_GATES)),
      coverageMap: JSON.parse(JSON.stringify(FIXTURE_COVERAGE)),
    })
    expect(JSON.stringify(buildTraceabilityGraph(adapterA))).toBe(
      JSON.stringify(buildTraceabilityGraph(adapterB)),
    )
  })
})
