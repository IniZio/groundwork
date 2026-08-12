// Type declarations for traceability-model.mjs

/** Shape of an edge-kind definition. */
export interface EdgeKindDef {
  drives_layering: boolean
  render: 'primary' | 'muted' | 'hidden'
  direction: 'down' | 'up' | 'lateral'
}

/** Node types added by the traceability model (does not include base motive-graph types). */
export declare const TRACEABILITY_EXTENDED_NODE_TYPES: Set<string>

/** All node types: base motive-graph types + traceability extensions. */
export declare const ALL_TRACEABILITY_NODE_TYPES: Set<string>

/** Edge kinds added by the traceability model. */
export declare const TRACEABILITY_EXTENDED_EDGE_KINDS: Record<string, EdgeKindDef>

/** Merged edge kind map: base motive-graph kinds + traceability extensions. */
export declare const ALL_TRACEABILITY_EDGE_KINDS: Record<string, EdgeKindDef>

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

export interface ArtifactEvidenceNode {
  type: 'artifact-evidence'
  id: string
  ref: string
  hash: string | null
  kind: string
  label: string
}

export interface TraceEdge {
  source: string
  target: string
  kind: string
}

export declare function makeSelfTestNode(opts: {
  sliceId: string
  filePath: string
  source?: 'direct' | 'decision-mediated'
}): SelfTestNode

export declare function makeLiveVerifyNode(opts: {
  claim: string | null
  evidence: string | null
  result: string | null
  ord: number
}): LiveVerifyNode

export declare function makeGateNode(opts: {
  which: string
  verdict: string
  citation?: string | null
  rubric?: string | null
}): GateNode

export declare function makeArtifactEvidenceNode(opts: {
  ref: string
  hash?: string | null
  kind?: 'screenshot' | 'csv' | 'test-output' | 'other'
}): ArtifactEvidenceNode

export declare function makeEdge(
  source: string,
  target: string,
  kind: string,
): TraceEdge
