/**
 * traceability-join.mjs — deterministic mechanical join engine.
 *
 * Pure function: takes a SpineAdapter and returns a TraceabilityGraph
 * containing all six tiers of the traceability chain:
 *
 *   objective → spec-req → slice → self-test → live-verify → gate
 *
 * Edges wired by this module:
 *   covers     (slice → spec-req, spec-req → objective)
 *   blocked_by (slice → slice)
 *   verifies   (self-test → slice)
 *   confirms   (live-verify → slice | objective)
 *   seals      (gate → slice | objective)
 *
 * DETERMINISM CONTRACT (AC-4):
 *   Identical adapter data MUST yield byte-identical output.
 *   - All node and edge arrays are sorted by stable string keys before return.
 *   - Object.keys() / Set / Map iteration orders are never relied upon;
 *     every intermediate collection is sorted before being iterated for output.
 *   - No timestamps, random ids, or unstable values are produced.
 *   - Duplicate edges are deduplicated by stable key before the final sort.
 *
 * EXTENSION POINT — artifact-evidence (S3/S4):
 *   This function produces `artifactEvidence: []` — an empty array documenting
 *   where S3 should attach evidence nodes and `evidences` edges. Do NOT import
 *   any evidence module here; it does not exist yet (race with S4).
 *
 * Slice S2 of motive tracking-viz (AC-2, AC-4).
 */

import {
  makeSelfTestNode,
  makeLiveVerifyNode,
  makeGateNode,
  makeEdge,
} from './traceability-model.mjs'

// ---------------------------------------------------------------------------
// Base-type node factories (not in traceability-model.mjs)
// ---------------------------------------------------------------------------

/**
 * @param {string} slug
 * @param {string} text
 * @returns {{ type: 'objective', id: string, slug: string, text: string, label: string }}
 */
function makeObjectiveNode(slug, text) {
  const trimmed = typeof text === 'string' ? text : ''
  return {
    type: /** @type {'objective'} */ ('objective'),
    id: `objective:${slug}`,
    slug,
    text: trimmed,
    label: trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed,
  }
}

/**
 * @param {{ id: string, title: string, verification: string|null, criticality: string|null, origin_decision_ref: string|null }} req
 * @returns {{ type: 'spec-requirement', id: string, reqId: string, title: string, verification: string|null, criticality: string|null, originDecisionRef: string|null, label: string }}
 */
function makeSpecReqNode(req) {
  return {
    type: /** @type {'spec-requirement'} */ ('spec-requirement'),
    id: `spec-requirement:${req.id}`,
    reqId: req.id,
    title: req.title,
    verification: req.verification,
    criticality: req.criticality,
    originDecisionRef: req.origin_decision_ref,
    label: req.title || req.id,
  }
}

/**
 * @param {{ id: string, status: string, desc?: string|null }} slice
 * @returns {{ type: 'slice', id: string, sliceId: string, status: string, desc: string|null, label: string }}
 */
function makeSliceNode(slice) {
  const desc = slice.desc ?? null
  return {
    type: /** @type {'slice'} */ ('slice'),
    id: `slice:${slice.id}`,
    sliceId: slice.id,
    status: slice.status,
    desc,
    label: desc ? `${slice.id}: ${desc}` : slice.id,
  }
}

// ---------------------------------------------------------------------------
// Stable-sort helpers (never mutate input)
// ---------------------------------------------------------------------------

/** @param {{ id: string }[]} arr */
function sortById(arr) {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** @param {{ source: string, target: string, kind: string }} e */
function edgeKey(e) {
  return `${e.source}\x00${e.target}\x00${e.kind}`
}

/** @param {{ source: string, target: string, kind: string }[]} arr */
function sortEdges(arr) {
  return [...arr].sort((a, b) => {
    const ka = edgeKey(a)
    const kb = edgeKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/**
 * Remove duplicate edges (same source + target + kind) in a stable way.
 * @param {{ source: string, target: string, kind: string }[]} arr
 */
function dedupeEdges(arr) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {{ source: string, target: string, kind: string }[]} */
  const out = []
  for (const e of arr) {
    const k = edgeKey(e)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(e)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Main assembler
// ---------------------------------------------------------------------------

/**
 * Build the full six-tier traceability graph from a SpineAdapter.
 *
 * @param {object} adapter - A SpineAdapter (see traceability-adapter.mjs)
 * @param {() => string}               adapter.getMotive
 * @param {() => string}               adapter.getObjective
 * @param {() => object[]}             adapter.getSlices
 * @param {() => object[]}             adapter.getVerificationEvents
 * @param {() => object[]}             adapter.getGateEvents
 * @param {() => object[]}             adapter.getSpecRequirements
 * @param {() => Record<string, { declared: string|null, verified: boolean, tests: string[] }>} adapter.getCoverageMap
 *
 * @returns {{
 *   nodes: object[],
 *   edges: { source: string, target: string, kind: string }[],
 *   artifactEvidence: never[]
 * }}
 */
export function buildTraceabilityGraph(adapter) {
  // --- Fetch all data upfront (no I/O inside loops) ---
  const slug               = adapter.getMotive()
  const objectiveText      = adapter.getObjective()
  const slices             = adapter.getSlices()
  const specReqs           = adapter.getSpecRequirements()
  const verificationEvents = adapter.getVerificationEvents()
  const gateEvents         = adapter.getGateEvents()
  const coverageMap        = adapter.getCoverageMap()

  /** @type {object[]} */
  const nodes = []
  /** @type {{ source: string, target: string, kind: string }[]} */
  const rawEdges = []

  // ── Tier 1: Objective ────────────────────────────────────────────────────
  const objectiveNode = makeObjectiveNode(slug, objectiveText)
  nodes.push(objectiveNode)

  // ── Tier 2: Spec requirements ─────────────────────────────────────────────
  // Sort input by id for determinism before building lookup tables.
  const sortedSpecReqs = [...specReqs].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

  const specReqNodeById = /** @type {Record<string, object>} */ ({})
  for (const req of sortedSpecReqs) {
    const srNode = makeSpecReqNode(req)
    nodes.push(srNode)
    specReqNodeById[req.id] = srNode
    // spec-req → objective (covers)
    rawEdges.push(makeEdge(srNode.id, objectiveNode.id, 'covers'))
  }

  // Index: origin_decision_ref → sorted list of spec-req node ids
  /** @type {Record<string, string[]>} */
  const decisionRefToSrIds = {}
  for (const req of sortedSpecReqs) {
    if (req.origin_decision_ref) {
      const key = req.origin_decision_ref
      if (!Object.prototype.hasOwnProperty.call(decisionRefToSrIds, key)) {
        decisionRefToSrIds[key] = []
      }
      decisionRefToSrIds[key].push(`spec-requirement:${req.id}`)
    }
  }
  // Sort each bucket for stable iteration
  for (const key of Object.keys(decisionRefToSrIds)) {
    decisionRefToSrIds[key].sort()
  }

  // Index: coverage map → test path → sorted list of spec-req node ids
  /** @type {Record<string, string[]>} */
  const testPathToSrIds = {}
  const covReqIds = Object.keys(coverageMap).sort()
  for (const reqId of covReqIds) {
    const entry = coverageMap[reqId]
    const tests = Array.isArray(entry?.tests) ? [...entry.tests].sort() : []
    for (const testPath of tests) {
      if (!Object.prototype.hasOwnProperty.call(testPathToSrIds, testPath)) {
        testPathToSrIds[testPath] = []
      }
      testPathToSrIds[testPath].push(`spec-requirement:${reqId}`)
    }
  }
  // Sort each bucket
  for (const key of Object.keys(testPathToSrIds)) {
    testPathToSrIds[key].sort()
  }

  // ── Tiers 3 & 4: Slices + Self-tests ─────────────────────────────────────
  const sortedSlices = [...slices].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  // Build fast set of valid slice ids for edge validation
  const sliceIdSet = new Set(sortedSlices.map((s) => s.id))

  /** @type {object[]} */
  const selfTestNodes = []

  for (const slice of sortedSlices) {
    const sliceNode = makeSliceNode(slice)
    nodes.push(sliceNode)

    // blocked_by: slice → slice
    const blockers = [...(slice.blocked_by ?? [])].sort()
    for (const blockerId of blockers) {
      // Only wire if the target slice exists (guard against dangling refs)
      if (sliceIdSet.has(blockerId)) {
        rawEdges.push(makeEdge(sliceNode.id, `slice:${blockerId}`, 'blocked_by'))
      }
    }

    // covers: slice → spec-req
    // Path 1 — direct: slice.covers_ac contains a spec-req id
    const coversAc = [...(slice.covers_ac ?? [])].sort()
    for (const acId of coversAc) {
      if (Object.prototype.hasOwnProperty.call(specReqNodeById, acId)) {
        rawEdges.push(makeEdge(sliceNode.id, `spec-requirement:${acId}`, 'covers'))
      }
    }
    // Path 2 — decision-mediated: slice.decisions → spec-req.origin_decision_ref
    const decisions = [...(slice.decisions ?? [])].sort()
    for (const decRef of decisions) {
      const srIds = decisionRefToSrIds[decRef]
      if (srIds) {
        for (const srId of srIds) {
          rawEdges.push(makeEdge(sliceNode.id, srId, 'covers'))
        }
      }
    }

    // Self-tests (tier 4)
    const testPaths = [...(slice.test_paths ?? [])].sort()
    if (testPaths.length > 0) {
      // Direct linkage
      for (const filePath of testPaths) {
        const stNode = makeSelfTestNode({ sliceId: slice.id, filePath, source: 'direct' })
        selfTestNodes.push(stNode)
        rawEdges.push(makeEdge(stNode.id, sliceNode.id, 'verifies'))
      }
    } else if (decisions.length > 0) {
      // Decision-mediated fallback: find test paths via spec-req → coverage map
      // Collect and sort so output is deterministic regardless of coverage map key order
      const covTestPaths = new Set()
      for (const decRef of decisions) {
        const srIds = decisionRefToSrIds[decRef] ?? []
        for (const srId of srIds) {
          const reqId = srId.slice('spec-requirement:'.length)
          const entry = coverageMap[reqId]
          if (entry?.tests) {
            for (const t of entry.tests) {
              covTestPaths.add(t)
            }
          }
        }
      }
      for (const filePath of [...covTestPaths].sort()) {
        const stNode = makeSelfTestNode({ sliceId: slice.id, filePath, source: 'decision-mediated' })
        selfTestNodes.push(stNode)
        rawEdges.push(makeEdge(stNode.id, sliceNode.id, 'verifies'))
      }
    }
  }

  // Add self-test nodes after slices so sortById() handles final ordering
  nodes.push(...selfTestNodes)

  // ── Tier 5: Live-verify ──────────────────────────────────────────────────
  // Sort by ord (numeric ordinal assigned at emit time)
  const sortedVerifications = [...verificationEvents].sort((a, b) => a.ord - b.ord)
  for (const ev of sortedVerifications) {
    const lvNode = makeLiveVerifyNode({
      claim:    ev.claim,
      evidence: ev.evidence,
      result:   ev.result,
      ord:      ev.ord,
    })
    nodes.push(lvNode)
    // confirms edge → linked slice if linkId is a known slice id, else → objective
    const linkId = ev.linkId ?? null
    const target = (linkId && sliceIdSet.has(linkId))
      ? `slice:${linkId}`
      : objectiveNode.id
    rawEdges.push(makeEdge(lvNode.id, target, 'confirms'))
  }

  // ── Tier 6: Gate ─────────────────────────────────────────────────────────
  // Sort by which (string) for determinism; multiple gates of the same `which`
  // are further distinguished by their id (gate:${which}) — but in practice
  // only one gate verdict per `which` is expected.
  const sortedGates = [...gateEvents].sort((a, b) =>
    a.which < b.which ? -1 : a.which > b.which ? 1 : 0,
  )
  for (const ev of sortedGates) {
    const gNode = makeGateNode({
      which:    ev.which,
      verdict:  ev.verdict,
      citation: ev.citation ?? null,
      rubric:   ev.rubric ?? null,
    })
    nodes.push(gNode)
    // seals edge → linked slice if linkId is a known slice id, else → objective
    const linkId = ev.linkId ?? null
    const target = (linkId && sliceIdSet.has(linkId))
      ? `slice:${linkId}`
      : objectiveNode.id
    rawEdges.push(makeEdge(gNode.id, target, 'seals'))
  }

  // ── Finalize: sort all collections by stable keys, dedupe edges ──────────
  return {
    nodes: sortById(nodes),
    edges: sortEdges(dedupeEdges(rawEdges)),
    // EXTENSION POINT: artifact-evidence nodes and `evidences` edges are
    // assembled in S3 by the evidence mechanism (S4).  S3 will spread
    // `nodes` and `edges` into a new object and append evidence entries.
    artifactEvidence: /** @type {never[]} */ ([]),
  }
}
