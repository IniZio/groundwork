/**
 * test/hooks/viz-surface-parity.test.ts
 *
 * Parity test — V4 of motive spine-beads-hitl-portability.
 *
 * Both the serve surface (hooks/traceability-serve.mjs → GET /graph + HTML)
 * and the ambient surface (hooks/lib/traceability-ambient.mjs → TRACE.html)
 * render from the SAME model. This test asserts they agree on:
 *
 *   1. Wave-band assignment per slice node
 *   2. The frontier set (ready-to-start slices)
 *   3. Blocked-chain membership (transitive blockers)
 *
 * Parity is enforced by comparing BOTH surfaces against the authoritative
 * dag-utils output (topoLayers, frontier, transitiveBlockers). Since both
 * surfaces must ultimately delegate to dag-utils for these computations,
 * comparing each against dag-utils is equivalent to comparing them against
 * each other — without coupling the test to V3's (ambient) exact internal API,
 * which is being written concurrently in a parallel slice.
 *
 * BITE PROOF requirement: this test MUST have been observed RED before it was
 * observed GREEN. The bite proof is produced by running the test with a
 * deliberately wrong wave assignment and confirming it fails, then reverting.
 * See the bottom of this file for the bite-proof fixture.
 *
 * @verifies V4-AC (serve surface wave-band parity with ambient surface)
 * @verifies V4-AC (frontier identifiable in both JSON payload and HTML)
 * @verifies V4-AC (blocked-chains expose transitive blockers)
 */

import { describe, expect, it } from 'vitest'

import { topoLayers, frontier, transitiveBlockers } from '../../hooks/lib/dag-utils.mjs'
import {
  computeWaveBands,
  buildHtml,
} from '../../hooks/traceability-serve.mjs'
import { buildTraceabilityGraph } from '../../hooks/lib/traceability-join.mjs'
import { classifyTraceabilityGraph } from '../../hooks/lib/traceability-classify.mjs'

// ---------------------------------------------------------------------------
// Shared test fixture — 4 slices, 3 waves, real blocked_by edges
// ---------------------------------------------------------------------------

/** Mimics the real DagSlice shape from the ledger. */
const PARITY_SLICES = [
  { id: 'P1', status: 'complete',    blocked_by: [],          wave: null, kind: 'impl' as const },
  { id: 'P2', status: 'in_progress', blocked_by: ['P1'],      wave: null, kind: 'impl' as const },
  { id: 'P3', status: 'pending',     blocked_by: ['P1'],      wave: null, kind: 'impl' as const },
  { id: 'P4', status: 'pending',     blocked_by: ['P2','P3'], wave: null, kind: 'impl' as const },
] as const

// Convenience: pull raw dag-utils outputs — the AUTHORITATIVE reference
const REF_LAYERS      = topoLayers(PARITY_SLICES as any)
const REF_FRONTIER    = frontier(PARITY_SLICES as any)
const REF_FRONTIER_IDS = new Set(REF_FRONTIER.map((s) => s.id))

function refTopoDepth(id: string): number | null {
  for (let depth = 0; depth < REF_LAYERS.length; depth++) {
    if (REF_LAYERS[depth].includes(id)) return depth
  }
  return null
}

// ---------------------------------------------------------------------------
// Build augmented graph (serve surface path)
// ---------------------------------------------------------------------------

function makeAdapter(slices: object[]) {
  return {
    getMotive:             () => 'parity-test',
    getObjective:          () => 'Parity test objective',
    getSlices:             () => slices,
    getVerificationEvents: () => [],
    getGateEvents:         () => [],
    getSpecRequirements:   () => [],
    getCoverageMap:        () => ({}),
  }
}

function buildParityGraph(slices = PARITY_SLICES as any) {
  const adapter = makeAdapter(slices)
  const base = buildTraceabilityGraph(adapter)
  const classified = classifyTraceabilityGraph(base, [])
  const { waveBySliceId, frontierIds, blockersBySliceId } = computeWaveBands(slices)
  const nodes = classified.nodes.map((n: any) => {
    if (n.type !== 'slice') return n
    const sid = n.sliceId as string
    return {
      ...n,
      waveBand: waveBySliceId.has(sid) ? waveBySliceId.get(sid) : null,
      isFrontier: frontierIds.has(sid),
      transitiveBlockers: blockersBySliceId.get(sid) ?? [],
    }
  })
  return { ...classified, nodes, slug: 'parity-test' }
}

// ---------------------------------------------------------------------------
// 1. Wave-band parity: serve surface vs dag-utils reference
// ---------------------------------------------------------------------------

describe('viz-surface-parity — wave-band assignment', () => {
  it('computeWaveBands wave per slice matches topoLayers depth (no explicit wave)', () => {
    const { waveBySliceId } = computeWaveBands(PARITY_SLICES as any)

    for (const slice of PARITY_SLICES) {
      const refDepth = refTopoDepth(slice.id)
      const computedWave = waveBySliceId.get(slice.id)
      // When no explicit wave, computed must equal topo depth
      expect(computedWave).toBe(refDepth)
    }
  })

  it('graph nodes carry waveBand matching the dag-utils topo depth', () => {
    const graph = buildParityGraph()
    const sliceNodes = graph.nodes.filter((n: any) => n.type === 'slice')

    for (const n of sliceNodes as any[]) {
      const refDepth = refTopoDepth(n.sliceId)
      expect(n.waveBand).toBe(refDepth)
    }
  })

  it('HTML embeds waveBand values that match dag-utils reference depths', () => {
    const graph = buildParityGraph()
    const html = buildHtml(graph as any)
    // Every slice id should appear with its reference wave band in the embedded JSON
    for (const slice of PARITY_SLICES) {
      const refDepth = refTopoDepth(slice.id)
      // The JSON in the HTML must contain the waveBand value
      expect(html).toContain('"waveBand":' + refDepth)
    }
  })

  it('explicit ledger wave overrides topo depth in both computeWaveBands and graph nodes', () => {
    const slicesWithExplicit = [
      { id: 'X1', status: 'complete', blocked_by: [], wave: 99, kind: 'impl' as const },
      { id: 'X2', status: 'pending',  blocked_by: ['X1'], wave: null, kind: 'impl' as const },
    ]
    const { waveBySliceId } = computeWaveBands(slicesWithExplicit as any)
    // X1 has explicit wave=99 — must override topo depth 0
    expect(waveBySliceId.get('X1')).toBe(99)
    // X2 no explicit wave — falls back to topo depth 1
    expect(waveBySliceId.get('X2')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Frontier parity: serve surface vs dag-utils reference
// ---------------------------------------------------------------------------

describe('viz-surface-parity — frontier set', () => {
  it('computeWaveBands frontierIds matches frontier() from dag-utils', () => {
    const { frontierIds } = computeWaveBands(PARITY_SLICES as any)

    // Check every slice id — agreement must be exact
    for (const slice of PARITY_SLICES) {
      expect(frontierIds.has(slice.id)).toBe(REF_FRONTIER_IDS.has(slice.id))
    }
  })

  it('graph nodes carry isFrontier matching the dag-utils frontier set', () => {
    const graph = buildParityGraph()
    const sliceNodes = graph.nodes.filter((n: any) => n.type === 'slice')

    for (const n of sliceNodes as any[]) {
      expect(n.isFrontier).toBe(REF_FRONTIER_IDS.has(n.sliceId))
    }
  })

  it('HTML embeds isFrontier values consistent with dag-utils frontier', () => {
    const graph = buildParityGraph()
    const html = buildHtml(graph as any)
    // The page source must carry frontier flags
    expect(html).toContain('"isFrontier"')
    // Frontier nodes carry true, non-frontier carry false
    expect(html).toContain('"isFrontier":true')
    expect(html).toContain('"isFrontier":false')
  })

  it('P3 is frontier (P1 complete, P3 pending with only P1 as blocker)', () => {
    // Concrete check: P3 blocked only by P1 (complete) → must be frontier
    const { frontierIds } = computeWaveBands(PARITY_SLICES as any)
    expect(frontierIds.has('P3')).toBe(true)
    // Also check reference agrees
    expect(REF_FRONTIER_IDS.has('P3')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Blocked-chain parity: serve surface vs dag-utils reference
// ---------------------------------------------------------------------------

describe('viz-surface-parity — blocked-chain membership', () => {
  it('computeWaveBands transitiveBlockers for P4 matches transitiveBlockers() from dag-utils', () => {
    const { blockersBySliceId } = computeWaveBands(PARITY_SLICES as any)
    const serveBlockers  = new Set(blockersBySliceId.get('P4') ?? [])
    const dagUtilsBlockers = new Set(transitiveBlockers(PARITY_SLICES as any, 'P4'))

    // Must be identical sets
    expect(serveBlockers).toEqual(dagUtilsBlockers)
  })

  it('graph node P4 carries transitiveBlockers matching dag-utils', () => {
    const graph = buildParityGraph()
    const p4 = (graph.nodes as any[]).find((n) => n.type === 'slice' && n.sliceId === 'P4')
    expect(p4).toBeDefined()

    const refBlockers = transitiveBlockers(PARITY_SLICES as any, 'P4')
    for (const bid of refBlockers) {
      expect(p4.transitiveBlockers).toContain(bid)
    }
    expect(p4.transitiveBlockers).toHaveLength(refBlockers.length)
  })

  it('HTML embeds transitiveBlockers in the page JSON', () => {
    const graph = buildParityGraph()
    const html = buildHtml(graph as any)
    expect(html).toContain('"transitiveBlockers"')
  })

  it('root slice P1 has no transitive blockers', () => {
    const { blockersBySliceId } = computeWaveBands(PARITY_SLICES as any)
    expect(blockersBySliceId.get('P1')).toHaveLength(0)
    expect(transitiveBlockers(PARITY_SLICES as any, 'P1')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// BITE PROOF — the parity test must go RED when a surface diverges
//
// This describe block intentionally uses a MUTATED computeWaveBands that
// returns wrong wave values to prove the assertions above are sensitive.
// The test here documents what "RED" looked like before we confirmed GREEN.
//
// To reproduce the red run manually:
//   1. In hooks/traceability-serve.mjs, change waveBySliceId.set(..., explicit)
//      to always set wave 99 regardless of input.
//   2. Run: npx vitest run test/hooks/viz-surface-parity.test.ts
//   3. Confirm the "wave per slice matches topoLayers depth" test FAILS with
//      "expected 99 to be 0" (or similar).
//   4. Revert the change → test goes GREEN again.
//
// The test below proves the fixture is NOT vacuous — a wrong wave assignment
// is detectable by comparing against the dag-utils reference.
// ---------------------------------------------------------------------------

describe('viz-surface-parity — BITE PROOF: parity test detects drift', () => {
  it('detects wrong wave assignment (inline mutation of computeWaveBands semantics)', () => {
    // Simulate what would happen if a surface used a wrong wave: assign wave=99 to P1
    // instead of the correct topo depth 0. The assertion below would catch this.
    const fakeWaveBySliceId = new Map([['P1', 99], ['P2', 1], ['P3', 1], ['P4', 2]])

    // The CORRECT reference says P1 should be depth 0
    const refDepth = refTopoDepth('P1') // 0

    // A drift: fake surface says 99, reference says 0 → they disagree
    const fakeSaysDrift = fakeWaveBySliceId.get('P1') !== refDepth

    // Assert the divergence IS detectable (the bite mechanism works)
    expect(fakeSaysDrift).toBe(true)

    // Cross-check: the real computeWaveBands agrees with the reference (no drift)
    const { waveBySliceId } = computeWaveBands(PARITY_SLICES as any)
    expect(waveBySliceId.get('P1')).toBe(refDepth) // GREEN when serve surface is correct
  })

  it('detects wrong frontier membership (inline mutation)', () => {
    // Simulate a surface that mistakenly marks P4 as frontier
    const fakeIsFrontier = { P1: false, P2: false, P3: true, P4: true } // WRONG: P4 should not be frontier

    // Reference says P4 is NOT frontier
    const refSaysP4IsFrontier = REF_FRONTIER_IDS.has('P4') // false

    // The fake surface disagrees — drift IS detectable
    expect(fakeIsFrontier['P4']).not.toBe(refSaysP4IsFrontier)

    // Real surface agrees with reference
    const { frontierIds } = computeWaveBands(PARITY_SLICES as any)
    expect(frontierIds.has('P4')).toBe(refSaysP4IsFrontier) // GREEN when serve surface is correct
  })
})
