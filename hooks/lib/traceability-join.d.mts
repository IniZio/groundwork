// Type declarations for traceability-join.mjs
// Slice S2 of motive tracking-viz (AC-2, AC-4).

import type { TraceEdge } from './traceability-model.mjs'

/** A node in the traceability graph (any tier). */
export type TraceNode =
  | ObjectiveNode
  | SpecReqNode
  | SliceNode
  | SelfTestNode
  | LiveVerifyNode
  | GateNode

export interface ObjectiveNode {
  type: 'objective'
  id: string
  slug: string
  text: string
  label: string
}

export interface SpecReqNode {
  type: 'spec-requirement'
  id: string
  reqId: string
  title: string
  verification: string | null
  criticality: string | null
  originDecisionRef: string | null
  label: string
}

export interface SliceNode {
  type: 'slice'
  id: string
  sliceId: string
  status: string
  desc: string | null
  label: string
}

export interface SelfTestNode {
  type: 'self-test'
  id: string
  sliceId: string
  filePath: string
  source: 'direct' | 'decision-mediated'
  label: string
}

export interface LiveVerifyNode {
  type: 'live-verify'
  id: string
  claim: string | null
  evidence: string | null
  result: string | null
  ord: number
  label: string
}

export interface GateNode {
  type: 'gate'
  id: string
  which: string
  verdict: string
  citation: string | null
  rubric: string | null
  label: string
}

/** The assembled traceability graph returned by buildTraceabilityGraph. */
export interface TraceabilityGraph {
  /** All nodes, sorted by id (deterministic). */
  nodes: TraceNode[]
  /** All edges, sorted by source\x00target\x00kind (deterministic, deduped). */
  edges: TraceEdge[]
  /**
   * Extension point for S3/S4: artifact-evidence nodes and `evidences` edges.
   * Always an empty array from this module; S3 appends to it after merging
   * with the evidence mechanism.
   */
  artifactEvidence: never[]
}

/**
 * Minimal SpineAdapter interface consumed by buildTraceabilityGraph.
 * Full typedef lives in traceability-adapter.mjs.
 */
export interface SpineAdapterShape {
  getMotive(): string
  getObjective(): string
  getSlices(): object[]
  getVerificationEvents(): object[]
  getGateEvents(): object[]
  getSpecRequirements(): object[]
  getCoverageMap(): Record<string, { declared: string | null; verified: boolean; tests: string[] }>
}

/**
 * Assemble the six-tier traceability graph from a SpineAdapter.
 *
 * Pure function — no I/O, no side-effects.
 * Identical adapter data yields byte-identical JSON output (AC-4).
 *
 * Tiers wired:
 *   1. objective
 *   2. spec-requirement  (covers → objective)
 *   3. slice             (covers → spec-req, blocked_by → slice)
 *   4. self-test         (verifies → slice)
 *   5. live-verify       (confirms → slice | objective)
 *   6. gate              (seals → slice | objective)
 *
 * artifact-evidence nodes and `evidences` edges are NOT wired here (S3/S4).
 */
export declare function buildTraceabilityGraph(adapter: SpineAdapterShape): TraceabilityGraph
