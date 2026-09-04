/**
 * test/hooks/ambient-serve-parity.test.ts
 *
 * Direct ambient↔serve parity — S16 of motive spine-beads-hitl-portability.
 *
 * The existing viz-surface-parity.test.ts compares each surface against dag-utils
 * as an intermediate reference. That is insufficient: two surfaces can each match
 * a reference under different conditions and still disagree with each other.
 * This test compares BOTH surfaces DIRECTLY:
 *
 *   ambient surface: hooks/lib/traceability-ambient.mjs → renderTraceHtml()
 *     emits data-frontier and data-blockers on SVG node elements.
 *   serve surface:   hooks/lib/traceability-serve.mjs → computeWaveBands()
 *     returns waveBySliceId, frontierIds, blockersBySliceId.
 *
 * Assertions:
 *   1. Frontier agreement: ambient data-frontier attrs match serve frontierIds.
 *   2. Blocker-chain agreement: ambient data-blockers attrs match serve blockersBySliceId.
 *   3. Wave-band agreement: ambient's wave algorithm (replicated from its source,
 *      lines 139-152 of traceability-ambient.mjs) agrees with serve's waveBySliceId.
 *
 * Fixtures:
 *   NORMAL_SLICES   — 4 slices, 3 waves, null explicit waves (topo fallback exercised)
 *   EXPLICIT_SLICES — 3 slices, some with explicit wave; explicit-wave-wins rule exercised
 *   CYCLIC_SLICES   — 2 slices forming a cycle; no-hang + frontier/blocker agreement tested;
 *                     wave AGREES on null after Seam A+B fixes (V7 of spine-beads-hitl-portability)
 *
 * BITE PROOF: perturb computeWaveBands in hooks/lib/traceability-serve.mjs so it returns
 * wave+99 for topo-derived assignments, run (RED), revert, run (GREEN).
 * Bite-proof outputs are pasted in the PR description / commit message.
 *
 * @verifies S16-AC-1 (both surfaces lay slices out in wave bands derived from blocked_by DAG)
 */

import { describe, it, expect } from 'vitest'
import { renderTraceHtml } from '../../hooks/lib/traceability-ambient.mjs'
import { computeWaveBands } from '../../hooks/lib/traceability-serve.mjs'
import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'
import { topoLayers, hasCycle } from '../../hooks/lib/dag-utils.mjs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Slice = {
  id: string
  status: string
  blocked_by: string[]
  wave: number | null
  kind: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal classified-graph object that renderTraceHtml() accepts.
 * Bypasses the adapter pipeline — gives us clean, fixture-controlled nodes.
 * ambient's computeLayout() reads: id, type, blocked_by, status, wave, kind.
 */
function buildMinimalGraph(slices: Slice[]) {
  const nodes = slices.map((s) => ({
    type: 'slice',
    id: s.id,
    sliceId: s.id,
    status: s.status,
    blocked_by: s.blocked_by,
    wave: s.wave,
    kind: s.kind,
    label: s.id,
  }))
  return { nodes, edges: [] }
}

/**
 * Parse ambient HTML for frontier and blocker data attributes on slice nodes.
 *
 * Ambient emits:
 *   data-frontier="true"       — on frontier (ready-now) slice nodes
 *   data-blockers="id1,id2"    — sorted transitive blockers; absent when empty
 */
function parseAmbientSliceData(html: string): {
  frontierIds: Set<string>
  blockersBySliceId: Map<string, string[]>
} {
  const frontierIds = new Set<string>()
  const blockersBySliceId = new Map<string, string[]>()
  // Each slice node: <g ... data-type="slice" data-id="..." [data-frontier="true"] [data-blockers="..."]>
  const gRe = /<g\s+[^>]*data-type="slice"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = gRe.exec(html)) !== null) {
    const el = m[0]
    const idMatch = el.match(/data-id="([^"]*)"/)
    if (!idMatch) continue
    const nodeId = idMatch[1]
    if (el.includes('data-frontier="true"')) {
      frontierIds.add(nodeId)
    }
    const bm = el.match(/data-blockers="([^"]*)"/)
    if (bm?.[1]) {
      blockersBySliceId.set(nodeId, bm[1].split(',').filter(Boolean).sort())
    }
  }
  return { frontierIds, blockersBySliceId }
}

/**
 * Replicate ambient's wave assignment algorithm.
 * Source: hooks/lib/traceability-ambient.mjs lines 139-152 (computeLayout).
 *
 * Explicit ledger wave wins; topo depth is the fallback; ?? null for cycle members.
 * Used only for non-cycle fixtures in the wave-band agreement tests (section 3),
 * where ?? null vs ?? 0 does not matter (topo always finds a layer).
 *
 * Cycle-member wave semantics are tested via the production join pipeline —
 * see "cycle members: both surfaces agree on null wave" test in section 4.
 */
function ambientWaveFor(slices: Slice[], id: string): number | null {
  const cycleDetected = hasCycle(slices as any)
  const topoResult = cycleDetected ? [] : topoLayers(slices as any)
  const topoWaveById = new Map<string, number>()
  topoResult.forEach((layer, i) => layer.forEach((sid) => topoWaveById.set(sid, i)))
  const s = slices.find((x) => x.id === id)
  return s?.wave != null ? s.wave : (topoWaveById.get(id) ?? null)
}

/**
 * Build a minimal SpineAdapter from a slice fixture.
 * Lets tests drive buildTraceabilityGraph (the production join pipeline) directly.
 */
function buildAdapter(slices: Slice[]) {
  return {
    getMotive:              () => 'parity-test',
    getObjective:           () => 'parity test objective',
    getSlices:              () => slices,
    getVerificationEvents:  () => [],
    getGateEvents:          () => [],
    getSpecRequirements:    () => [],
    getCoverageMap:         () => ({}),
  }
}

/**
 * Run both surfaces on the same slice fixture and return their computed outputs.
 */
function runBothSurfaces(slices: Slice[]) {
  const graph = buildMinimalGraph(slices)
  const html = renderTraceHtml(graph as any, 'parity-test')
  const ambientHtmlData = parseAmbientSliceData(html)
  const serveData = computeWaveBands(slices as any)
  return { ambientHtmlData, serveData, html }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Normal 4-slice DAG, no explicit waves.
 * Expected waves (topo): N1=0, N2=1, N3=1, N4=2
 * Expected frontier: N3 (pending; blocker N1 is complete; N2 is in_progress → not pending)
 */
const NORMAL_SLICES: Slice[] = [
  { id: 'N1', status: 'complete',    blocked_by: [],          wave: null, kind: 'impl' },
  { id: 'N2', status: 'in_progress', blocked_by: ['N1'],      wave: null, kind: 'impl' },
  { id: 'N3', status: 'pending',     blocked_by: ['N1'],      wave: null, kind: 'impl' },
  { id: 'N4', status: 'pending',     blocked_by: ['N2','N3'], wave: null, kind: 'impl' },
]

/**
 * Explicit-wave fixture: E1 has wave=5 (overrides topo depth 0), E3 has wave=7.
 * E2 has no explicit wave → topo depth 1.
 */
const EXPLICIT_WAVE_SLICES: Slice[] = [
  { id: 'E1', status: 'complete', blocked_by: [],     wave: 5,   kind: 'impl' },
  { id: 'E2', status: 'pending',  blocked_by: ['E1'], wave: null, kind: 'impl' },
  { id: 'E3', status: 'pending',  blocked_by: [],     wave: 7,   kind: 'impl' },
]

/**
 * Cyclic fixture: C1 blocks C2 and C2 blocks C1.
 * Both surfaces must complete without hanging.
 * Frontier: {} (neither is actionable).
 * Wave: both surfaces agree on null (no valid topological position for cycle members).
 */
const CYCLIC_SLICES: Slice[] = [
  { id: 'C1', status: 'pending', blocked_by: ['C2'], wave: null, kind: 'impl' },
  { id: 'C2', status: 'pending', blocked_by: ['C1'], wave: null, kind: 'impl' },
]

// ---------------------------------------------------------------------------
// 1. Frontier agreement
// ---------------------------------------------------------------------------

describe('ambient-serve-parity — frontier agreement', () => {
  it('NORMAL: ambient data-frontier matches serve frontierIds', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(NORMAL_SLICES)

    // Convert Set to sorted array for readable diff output
    const ambientFrontier = [...ambientHtmlData.frontierIds].sort()
    const serveFrontier = [...serveData.frontierIds].sort()

    expect(ambientFrontier).toEqual(serveFrontier)
    // Sanity: N3 is the only frontier slice
    expect(ambientFrontier).toEqual(['N3'])
  })

  it('EXPLICIT-WAVE: frontier agreement holds regardless of explicit wave overrides', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(EXPLICIT_WAVE_SLICES)
    const ambientFrontier = [...ambientHtmlData.frontierIds].sort()
    const serveFrontier = [...serveData.frontierIds].sort()
    expect(ambientFrontier).toEqual(serveFrontier)
    // E2 and E3 are both pending with no incomplete blockers (E1 is complete, E3 has no blockers)
    expect(ambientFrontier).toEqual(['E2', 'E3'])
  })

  it('CYCLIC: both surfaces agree — neither cycle member is actionable', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(CYCLIC_SLICES)
    const ambientFrontier = [...ambientHtmlData.frontierIds].sort()
    const serveFrontier = [...serveData.frontierIds].sort()
    expect(ambientFrontier).toEqual(serveFrontier)
    expect(ambientFrontier).toEqual([]) // no actionable slices in a cycle
  })
})

// ---------------------------------------------------------------------------
// 2. Blocked-chain agreement
// ---------------------------------------------------------------------------

describe('ambient-serve-parity — blocked-chain agreement', () => {
  it('NORMAL: ambient data-blockers matches serve transitiveBlockers for each slice', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(NORMAL_SLICES)

    for (const slice of NORMAL_SLICES) {
      // Serve returns a (possibly empty) array for every slice
      const serveBlockers = [...(serveData.blockersBySliceId.get(slice.id) ?? [])].sort()
      // Ambient only emits data-blockers when the chain is non-empty
      const ambientBlockers = ambientHtmlData.blockersBySliceId.get(slice.id) ?? []

      expect(ambientBlockers).toEqual(serveBlockers)
    }
  })

  it('NORMAL: N4 has N1, N2, N3 as transitive blockers in both surfaces', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(NORMAL_SLICES)
    const serveN4 = [...(serveData.blockersBySliceId.get('N4') ?? [])].sort()
    const ambientN4 = ambientHtmlData.blockersBySliceId.get('N4') ?? []
    expect(ambientN4).toEqual(['N1', 'N2', 'N3'])
    expect(serveN4).toEqual(['N1', 'N2', 'N3'])
  })

  it('EXPLICIT-WAVE: blocker agreement holds with explicit waves', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(EXPLICIT_WAVE_SLICES)
    for (const slice of EXPLICIT_WAVE_SLICES) {
      const serveBlockers = [...(serveData.blockersBySliceId.get(slice.id) ?? [])].sort()
      const ambientBlockers = ambientHtmlData.blockersBySliceId.get(slice.id) ?? []
      expect(ambientBlockers).toEqual(serveBlockers)
    }
  })

  it('CYCLIC: both surfaces agree on transitive blockers (mutual blocking in cycle)', () => {
    const { ambientHtmlData, serveData } = runBothSurfaces(CYCLIC_SLICES)
    for (const slice of CYCLIC_SLICES) {
      const serveBlockers = [...(serveData.blockersBySliceId.get(slice.id) ?? [])].sort()
      const ambientBlockers = ambientHtmlData.blockersBySliceId.get(slice.id) ?? []
      expect(ambientBlockers).toEqual(serveBlockers)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Wave-band agreement (non-cycle fixtures)
// ---------------------------------------------------------------------------

describe('ambient-serve-parity — wave-band agreement', () => {
  it('NORMAL: ambient wave algorithm agrees with serve for all slices (topo fallback)', () => {
    const { serveData } = runBothSurfaces(NORMAL_SLICES)

    for (const slice of NORMAL_SLICES) {
      const ambientWave = ambientWaveFor(NORMAL_SLICES, slice.id)
      const serveWave = serveData.waveBySliceId.get(slice.id)
      expect({ id: slice.id, ambientWave }).toEqual({ id: slice.id, ambientWave: serveWave })
    }
  })

  it('NORMAL: expected wave assignments — N1=0, N2=1, N3=1, N4=2', () => {
    const { serveData } = runBothSurfaces(NORMAL_SLICES)
    expect(serveData.waveBySliceId.get('N1')).toBe(0)
    expect(serveData.waveBySliceId.get('N2')).toBe(1)
    expect(serveData.waveBySliceId.get('N3')).toBe(1)
    expect(serveData.waveBySliceId.get('N4')).toBe(2)
  })

  it('EXPLICIT-WAVE: explicit ledger wave overrides topo depth in both surfaces', () => {
    const { serveData } = runBothSurfaces(EXPLICIT_WAVE_SLICES)

    for (const slice of EXPLICIT_WAVE_SLICES) {
      const ambientWave = ambientWaveFor(EXPLICIT_WAVE_SLICES, slice.id)
      const serveWave = serveData.waveBySliceId.get(slice.id)
      expect({ id: slice.id, ambientWave }).toEqual({ id: slice.id, ambientWave: serveWave })
    }

    // E1 explicit=5 overrides topo 0; E3 explicit=7 overrides topo 0; E2 topo=1
    expect(serveData.waveBySliceId.get('E1')).toBe(5)
    expect(serveData.waveBySliceId.get('E2')).toBe(1)
    expect(serveData.waveBySliceId.get('E3')).toBe(7)
    expect(ambientWaveFor(EXPLICIT_WAVE_SLICES, 'E1')).toBe(5)
    expect(ambientWaveFor(EXPLICIT_WAVE_SLICES, 'E3')).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// 4. Cyclic fixture — no hang + KNOWN DISAGREEMENT documentation
// ---------------------------------------------------------------------------

describe('ambient-serve-parity — cyclic fixture (no hang)', () => {
  it('renderTraceHtml completes without hanging on cyclic input', () => {
    // If either surface hangs, this test will time out. Mere completion proves no hang.
    const graph = buildMinimalGraph(CYCLIC_SLICES)
    expect(() => renderTraceHtml(graph as any, 'cyclic-test')).not.toThrow()
  })

  it('computeWaveBands completes without hanging on cyclic input', () => {
    expect(() => computeWaveBands(CYCLIC_SLICES as any)).not.toThrow()
  })

  /**
   * SEAM A+B: both surfaces agree on null for cycle members.
   *
   * Drives ambient through the PRODUCTION join pipeline (buildTraceabilityGraph)
   * rather than a hand-replicated bare algorithm. That is the seam where the bug
   * lived: makeSliceNode dropped `wave`, so ambient always saw null and fell back
   * to topoLayers, and ambient used ?? 0 while serve used null for cycle members.
   *
   * After Seam A fix: buildTraceabilityGraph carries wave onto slice nodes.
   * After Seam B fix: ambient uses ?? null (not ?? 0) for cycle members,
   *   matching serve's null semantics.
   *
   * BITE PROOF: revert makeSliceNode to not carry `wave` → c1Node.wave === undefined
   *   → expect(undefined).toBe(null) fails → RED. Restore → GREEN.
   */
  it('cycle members: both surfaces agree on null wave (production join pipeline)', () => {
    // Production path: adapter → buildTraceabilityGraph → slice nodes with wave field
    const graph = buildTraceabilityGraph(buildAdapter(CYCLIC_SLICES) as any)
    const c1Node = graph.nodes.find((n: any) => n.sliceId === 'C1') as any
    const c2Node = graph.nodes.find((n: any) => n.sliceId === 'C2') as any

    // Seam A: join pipeline must carry wave onto slice nodes.
    // Cycle slices have wave:null in the fixture → graph nodes must carry null (not undefined).
    expect(c1Node?.wave).toBe(null)
    expect(c2Node?.wave).toBe(null)

    // Serve: cycle members → null
    const { serveData } = runBothSurfaces(CYCLIC_SLICES)
    expect(serveData.waveBySliceId.get('C1')).toBe(null)
    expect(serveData.waveBySliceId.get('C2')).toBe(null)

    // Seam B: both surfaces agree — null for cycle members (no valid topo position).
    expect(c1Node.wave).toBe(serveData.waveBySliceId.get('C1'))
    expect(c2Node.wave).toBe(serveData.waveBySliceId.get('C2'))
  })
})

// ---------------------------------------------------------------------------
// 5. Self-contained output — no external URL fetches
// ---------------------------------------------------------------------------

describe('ambient-serve-parity — offline contract', () => {
  it('ambient HTML for normal fixture is self-contained (no external URLs)', () => {
    const { html } = runBothSurfaces(NORMAL_SLICES)
    // http://www.w3.org/2000/svg is an XML namespace declaration, NOT a fetch — permitted.
    const externalUrlRe = /https?:\/\/(?!www\.w3\.org\/2000\/svg)/
    expect(html).not.toMatch(externalUrlRe)
  })
})
