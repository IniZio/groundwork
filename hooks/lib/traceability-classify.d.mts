// Type declarations for traceability-classify.mjs
// Slice S3 of motive tracking-viz (AC-3, AC-5, D-3, D-8).

import type { TraceabilityGraph } from './traceability-join.mjs'
import type { StampedEvidenceRef } from './traceability-evidence.mjs'
import type { ArtifactEvidenceNode } from './traceability-model.mjs'

/** The four possible link classifications (TRACEABILITY-R-003). */
export type LinkClassification = 'proven' | 'unproven' | 'stale' | 'missing'

/** An edge extended with a per-link classification field (D-8). */
export interface ClassifiedEdge {
  source: string
  target: string
  kind: string
  classification: LinkClassification
}

/**
 * The classified traceability graph returned by classifyTraceabilityGraph.
 *
 * Extends TraceabilityGraph by:
 *   - Adding artifact-evidence nodes (from stampedRefs) to `nodes`
 *   - Adding `evidences` edges to `edges`
 *   - Setting `classification` on every edge
 *   - Populating `artifactEvidence` (was always [] from buildTraceabilityGraph)
 */
export interface ClassifiedGraph {
  /** All nodes (original + artifact-evidence), sorted by id. */
  nodes: object[]
  /** All edges with classification, sorted by source\x00target\x00kind. */
  edges: ClassifiedEdge[]
  /** Artifact-evidence nodes attached in this call, sorted by id. */
  artifactEvidence: ArtifactEvidenceNode[]
}

/**
 * Attach artifact-evidence nodes/edges and classify every edge in the graph.
 *
 * Pure function — no I/O, no LLM, no network (AC-5 negative rail).
 * Deterministic: identical inputs yield byte-identical output.
 *
 * @param graph       - Assembled graph from buildTraceabilityGraph().
 * @param stampedRefs - Pre-stamped evidence refs (readEvidence + markStaleness). Defaults to [].
 *
 * Classification rules:
 *   proven   — GATE APPROVE / passing VERIFICATION covers the link AND evidence is fresh.
 *   unproven — No recorded verdict on this link yet.
 *   stale    — Backing artifact evidence has a build-hash mismatch (regen detected).
 *   missing  — Required link absent (e.g. spec-req with no covering slice).
 */
export declare function classifyTraceabilityGraph(
  graph: TraceabilityGraph,
  stampedRefs?: StampedEvidenceRef[],
): ClassifiedGraph
