/**
 * traceability-classify.mjs — S3 of motive tracking-viz (AC-3, AC-5, D-3, D-8)
 *
 * Pure function: takes an assembled TraceabilityGraph + pre-stamped evidence refs
 * and returns a ClassifiedGraph with:
 *   - artifact-evidence nodes and `evidences` edges attached (the piece S2 deferred)
 *   - every edge extended with a `classification` field
 *
 * Classification semantics (TRACEABILITY-R-003, R-005, R-006):
 *   proven   — a GATE APPROVE or passing VERIFICATION covers this link AND
 *              any backing artifact evidence is fresh (build hash matches)
 *   unproven — no recorded verdict yet (no gate / non-APPROVE / no passing verify)
 *   stale    — backing artifact evidence has a build-hash mismatch (regen detected)
 *   missing  — required link absent (spec-req with no covering slice)
 *
 * AC-5 NEGATIVE RAIL: NO LLM / network / model API is called in this module.
 * Classification is entirely derived from recorded verdicts + coverage + evidence freshness.
 *
 * Determinism: same inputs → byte-identical output (no random ids, no timestamps).
 */

import { makeArtifactEvidenceNode, makeEdge } from './traceability-model.mjs'

// ---------------------------------------------------------------------------
// Edge-key helpers (mirrors traceability-join.mjs)
// ---------------------------------------------------------------------------

/** @param {{ source: string, target: string, kind: string }} e */
function edgeKey(e) {
  return `${e.source}\x00${e.target}\x00${e.kind}`
}

/** @param {{ id: string }[]} arr */
function sortById(arr) {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** @param {{ source: string, target: string, kind: string }[]} arr */
function sortEdges(arr) {
  return [...arr].sort((a, b) => {
    const ka = edgeKey(a)
    const kb = edgeKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Internal: per-edge classifier
// ---------------------------------------------------------------------------

/**
 * Classify a single edge given pre-built context.
 *
 * @param {{ source: string, target: string, kind: string }}  edge
 * @param {object}                                            ctx
 * @param {Map<string, object>}                               ctx.nodeById
 * @param {Set<string>}                                       ctx.approvedTargets
 *   Node ids that are the TARGET of a GATE APPROVE `seals` edge (slice or objective).
 * @param {boolean}                                           ctx.objectiveApproved
 *   True if the objective node itself is sealed by an APPROVE gate.
 * @param {Map<string, 'fresh'|'stale'>}                      ctx.evidenceFreshness
 *   Maps a node id to 'fresh'|'stale' based on any artifact-evidence that evidences it.
 *   A node is 'stale' if ANY of its evidence refs is stale (stale beats fresh).
 * @param {Map<string, Set<string>>}                          ctx.specReqCoveringSlices
 *   Maps spec-req node id → Set of slice node ids that cover it via a `covers` edge.
 *
 * @returns {'proven'|'unproven'|'stale'|'missing'}
 */
function classifyEdge(edge, ctx) {
  const {
    nodeById,
    approvedTargets,
    objectiveApproved,
    evidenceFreshness,
    specReqCoveringSlices,
  } = ctx
  const { source, target, kind } = edge

  /** @param {string} nodeId */
  const isStale = (nodeId) => evidenceFreshness.get(nodeId) === 'stale'

  switch (kind) {
    case 'seals': {
      // gate → slice | objective
      const gateNode = nodeById.get(source)
      if (!gateNode || gateNode.verdict !== 'APPROVE') return 'unproven'
      // APPROVE but the sealed node has stale artifact evidence → stale
      if (isStale(target)) return 'stale'
      return 'proven'
    }

    case 'confirms': {
      // live-verify → slice | objective
      const lvNode = nodeById.get(source)
      if (!lvNode || lvNode.result !== 'pass') return 'unproven'
      // Passing verify, but target has stale evidence → stale
      if (isStale(target)) return 'stale'
      return 'proven'
    }

    case 'verifies': {
      // self-test → slice
      // 1. Check if the self-test node itself has direct artifact evidence
      const testFreshness = evidenceFreshness.get(source)
      if (testFreshness === 'stale') return 'stale'
      if (testFreshness === 'fresh') return 'proven'
      // 2. No direct artifact evidence — fall back to whether the slice is gate-approved
      if (approvedTargets.has(target) || objectiveApproved) return 'proven'
      return 'unproven'
    }

    case 'covers': {
      const sourceNode = nodeById.get(source)
      if (!sourceNode) return 'unproven'

      if (sourceNode.type === 'slice') {
        // covers edge: slice → spec-req
        // Stale evidence on the slice overrides an APPROVE verdict
        if (isStale(source)) return 'stale'
        // Proven if this slice is sealed by APPROVE, or the objective is globally approved
        if (approvedTargets.has(source) || objectiveApproved) return 'proven'
        return 'unproven'
      }

      if (sourceNode.type === 'spec-requirement') {
        // covers edge: spec-req → objective
        // missing if no slice covers this spec-req
        const coveringSlices = specReqCoveringSlices.get(source)
        if (!coveringSlices || coveringSlices.size === 0) return 'missing'

        let anyApproved = false
        let anyStale = false
        for (const sliceNodeId of coveringSlices) {
          if (isStale(sliceNodeId)) anyStale = true
          if (approvedTargets.has(sliceNodeId) || objectiveApproved) anyApproved = true
        }
        // Stale beats proven only if none of the slices are approved
        if (anyApproved) {
          return anyStale ? 'stale' : 'proven'
        }
        if (anyStale) return 'stale'
        return 'unproven'
      }

      return 'unproven'
    }

    case 'evidences': {
      // artifact-evidence → target
      // Freshness derives from the evidence ref's freshness field (pre-computed by markStaleness).
      // This branch handles the unlikely case of a pre-existing evidences edge in the input graph.
      // Newly-created evidences edges have classification set directly when they are built.
      return evidenceFreshness.get(source) === 'fresh' ? 'proven' : 'stale'
    }

    default:
      return 'unproven'
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach artifact-evidence nodes/edges and classify every edge in the graph.
 *
 * @param {import('./traceability-join.mjs').TraceabilityGraph} graph
 *   The assembled graph produced by buildTraceabilityGraph().
 * @param {Array<import('./traceability-evidence.mjs').StampedEvidenceRef>} [stampedRefs]
 *   Pre-stamped evidence refs (from readEvidence + markStaleness). Defaults to [].
 *
 * @returns {{
 *   nodes: object[],
 *   edges: Array<{ source: string, target: string, kind: string, classification: 'proven'|'unproven'|'stale'|'missing' }>,
 *   artifactEvidence: object[]
 * }}
 */
export function classifyTraceabilityGraph(graph, stampedRefs = []) {
  // ── 1. Node index ─────────────────────────────────────────────────────────
  /** @type {Map<string, object>} */
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

  // ── 2. Find objective node id ─────────────────────────────────────────────
  const objectiveNode = graph.nodes.find((n) => n.type === 'objective')

  // ── 3. Build approved-targets set from existing seals edges ───────────────
  // approvedTargets: node ids that are the TARGET of a GATE APPROVE seals edge
  /** @type {Set<string>} */
  const approvedTargets = new Set()
  for (const edge of graph.edges) {
    if (edge.kind !== 'seals') continue
    const gateNode = nodeById.get(edge.source)
    if (gateNode && gateNode.verdict === 'APPROVE') {
      approvedTargets.add(edge.target)
    }
  }
  const objectiveApproved = objectiveNode
    ? approvedTargets.has(objectiveNode.id)
    : false

  // ── 4. Build specReqCoveringSlices: specReqNodeId → Set<sliceNodeId> ──────
  /** @type {Map<string, Set<string>>} */
  const specReqCoveringSlices = new Map()
  for (const node of graph.nodes) {
    if (node.type === 'spec-requirement') {
      specReqCoveringSlices.set(node.id, new Set())
    }
  }
  for (const edge of graph.edges) {
    if (edge.kind !== 'covers') continue
    const srcNode = nodeById.get(edge.source)
    if (srcNode?.type === 'slice') {
      // covers edge: slice → spec-req
      const bucket = specReqCoveringSlices.get(edge.target)
      if (bucket) bucket.add(edge.source)
    }
  }

  // ── 5. Build evidenceFreshness: nodeId → 'fresh' | 'stale' ───────────────
  // A node is 'stale' if ANY evidence ref that evidences it is stale
  // (stale always beats fresh).
  /** @type {Map<string, 'fresh'|'stale'>} */
  const evidenceFreshness = new Map()
  for (const ref of stampedRefs) {
    for (const evidencedNodeId of ref.evidences) {
      const current = evidenceFreshness.get(evidencedNodeId)
      if (current !== 'stale') {
        evidenceFreshness.set(evidencedNodeId, ref.freshness)
      }
    }
  }

  // ── 6. Attach artifact-evidence nodes and evidences edges ─────────────────
  /** @type {object[]} */
  const artifactNodes = []
  /** @type {Array<{ source: string, target: string, kind: string, classification: string }>} */
  const artifactEdges = []

  const seenNodeIds = new Set()
  const seenEdgeKeys = new Set()

  for (const ref of stampedRefs) {
    const evidNode = makeArtifactEvidenceNode({
      ref: ref.path,
      hash: ref.captured_build_hash,
      kind: ref.kind,
    })
    // Dedupe nodes (same path may appear in multiple refs)
    if (!seenNodeIds.has(evidNode.id)) {
      seenNodeIds.add(evidNode.id)
      artifactNodes.push(evidNode)
    }

    const edgeClassification = ref.freshness === 'fresh' ? 'proven' : 'stale'
    for (const targetId of ref.evidences) {
      const rawEdge = makeEdge(evidNode.id, targetId, 'evidences')
      const key = edgeKey(rawEdge)
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key)
        artifactEdges.push({ ...rawEdge, classification: edgeClassification })
      }
    }
  }

  // ── 7. Build classifier context ───────────────────────────────────────────
  const ctx = {
    nodeById,
    approvedTargets,
    objectiveApproved,
    evidenceFreshness,
    specReqCoveringSlices,
  }

  // ── 8. Classify all existing edges ────────────────────────────────────────
  const classifiedEdges = graph.edges.map((edge) => ({
    ...edge,
    classification: classifyEdge(edge, ctx),
  }))

  // ── 9. Assemble and sort output (determinism) ─────────────────────────────
  const sortedArtifactNodes = sortById(artifactNodes)
  const sortedArtifactEdges = sortEdges(artifactEdges)

  const allNodes = sortById([...graph.nodes, ...sortedArtifactNodes])
  const allEdges = sortEdges([...classifiedEdges, ...sortedArtifactEdges])

  return {
    nodes: allNodes,
    edges: allEdges,
    artifactEvidence: sortedArtifactNodes,
  }
}
