/**
 * Traceability graph model — extends the motive-graph node/edge vocabulary.
 *
 * Pure data definitions and factory functions. No I/O, no side-effects.
 * Slice S1 of motive tracking-viz (D-7, D-8, D-9).
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

/**
 * Node types ADDED by the traceability model.
 * Base motive-graph types (objective, decision, open-item, ticket,
 * acceptance-criterion, slice, spec-requirement) are unchanged.
 */
export const TRACEABILITY_EXTENDED_NODE_TYPES = new Set([
  'self-test',        // Automated test artifact covering a slice
  'live-verify',      // Manual/live verification (VERIFICATION journal event)
  'gate',             // Gate verdict (GATE journal event)
  'artifact-evidence', // Artifact attached as evidence (screenshot, CSV, etc.)
])

/**
 * Complete set of node types in the traceability graph (base + extended).
 */
export const ALL_TRACEABILITY_NODE_TYPES = new Set([
  // Base motive-graph node types (not redefined, referenced here for completeness)
  'objective',
  'decision',
  'open-item',
  'ticket',
  'acceptance-criterion',
  'slice',
  'spec-requirement',
  // Extended
  'self-test',
  'live-verify',
  'gate',
  'artifact-evidence',
])

// ---------------------------------------------------------------------------
// Edge kinds
// ---------------------------------------------------------------------------

/**
 * Edge kinds ADDED by the traceability model.
 * Base EDGE_KINDS (anchors, resolved_by, graduated_to, blocked_by,
 * covers_ac, slice_decision, spec_xref) are unchanged.
 *
 * Each entry carries the same shape as motive-graph EDGE_KINDS:
 *   { drives_layering, render, direction }
 */
export const TRACEABILITY_EXTENDED_EDGE_KINDS = {
  /** slice → spec-requirement: this slice covers/implements this requirement */
  covers: {
    drives_layering: true,
    render: 'primary',
    direction: 'down',
  },
  /** self-test → slice: this test verifies this slice's behaviour */
  verifies: {
    drives_layering: false,
    render: 'primary',
    direction: 'up',
  },
  /** live-verify → slice: this manual verification confirms this slice */
  confirms: {
    drives_layering: false,
    render: 'muted',
    direction: 'up',
  },
  /** gate → objective/slice: this gate verdict seals this work item */
  seals: {
    drives_layering: false,
    render: 'primary',
    direction: 'up',
  },
  /** artifact-evidence → node: this artifact evidences this node */
  evidences: {
    drives_layering: false,
    render: 'muted',
    direction: 'lateral',
  },
}

/**
 * Merged edge kind map: base motive-graph kinds + traceability extensions.
 * Downstream consumers can import this single map to validate any edge.
 */
export const ALL_TRACEABILITY_EDGE_KINDS = {
  // Base (mirrored from motive-graph EDGE_KINDS for reference completeness)
  anchors:        { drives_layering: true,  render: 'primary', direction: 'down'    },
  resolved_by:    { drives_layering: false, render: 'muted',   direction: 'lateral' },
  graduated_to:   { drives_layering: false, render: 'muted',   direction: 'lateral' },
  blocked_by:     { drives_layering: true,  render: 'primary', direction: 'up'      },
  covers_ac:      { drives_layering: true,  render: 'primary', direction: 'down'    },
  slice_decision: { drives_layering: true,  render: 'hidden',  direction: 'up'      },
  spec_xref:      { drives_layering: false, render: 'muted',   direction: 'lateral' },
  // Extended
  covers:         { drives_layering: true,  render: 'primary', direction: 'down'    },
  verifies:       { drives_layering: false, render: 'primary', direction: 'up'      },
  confirms:       { drives_layering: false, render: 'muted',   direction: 'up'      },
  seals:          { drives_layering: false, render: 'primary', direction: 'up'      },
  evidences:      { drives_layering: false, render: 'muted',   direction: 'lateral' },
}

// ---------------------------------------------------------------------------
// Node factory functions
// ---------------------------------------------------------------------------

/**
 * Create a self-test node record.
 *
 * @param {object} opts
 * @param {string} opts.sliceId   - The slice id this test covers (e.g. 'S1')
 * @param {string} opts.filePath  - Repo-relative path to the test file
 * @param {'direct'|'decision-mediated'} [opts.source]
 *   - 'direct': discovered via the optional ledger field slice.test_paths
 *     (see traceability-adapter.mjs — S1 linkage mechanism)
 *   - 'decision-mediated': joined via slice.decisions → req.origin_decision_ref
 *     → coverage.json.by_requirement[id].tests (coarse; labeled for provenance)
 * @returns {{ type: 'self-test', id: string, sliceId: string, filePath: string, source: string, label: string }}
 */
export function makeSelfTestNode({ sliceId, filePath, source = 'direct' }) {
  return {
    type: /** @type {'self-test'} */ ('self-test'),
    id: `self-test:${sliceId}:${filePath}`,
    sliceId,
    filePath,
    source,
    label: filePath.split('/').pop() ?? filePath,
  }
}

/**
 * Create a live-verify node from a VERIFICATION journal event.
 *
 * @param {object} opts
 * @param {string|null} opts.claim    - Human-readable claim being verified
 * @param {string|null} opts.evidence - Evidence citation
 * @param {string|null} opts.result   - 'pass' | 'fail' | null
 * @param {number}      opts.ord      - Ordinal position in the event stream
 * @returns {{ type: 'live-verify', id: string, claim: string|null, evidence: string|null, result: string|null, ord: number, label: string }}
 */
export function makeLiveVerifyNode({ claim, evidence, result, ord }) {
  return {
    type: /** @type {'live-verify'} */ ('live-verify'),
    id: `live-verify:${ord}`,
    claim,
    evidence,
    result,
    ord,
    label: claim ?? `verification #${ord}`,
  }
}

/**
 * Create a gate node from a GATE journal event.
 *
 * @param {object}      opts
 * @param {string}      opts.which   - Gate identifier (e.g. 'advisor')
 * @param {string}      opts.verdict - 'APPROVE' | 'CORRECTION' | 'REPLAN' | 'STOP'
 * @param {string|null} [opts.citation]
 * @param {string|null} [opts.rubric]
 * @returns {{ type: 'gate', id: string, which: string, verdict: string, citation: string|null, rubric: string|null, label: string }}
 */
export function makeGateNode({ which, verdict, citation = null, rubric = null }) {
  return {
    type: /** @type {'gate'} */ ('gate'),
    id: `gate:${which}`,
    which,
    verdict,
    citation,
    rubric,
    label: `${which} (${verdict})`,
  }
}

/**
 * Create an artifact-evidence node.
 *
 * @param {object}      opts
 * @param {string}      opts.ref    - Identifier for the artifact (path, URL, etc.)
 * @param {string|null} [opts.hash] - Build/data hash for staleness detection (D-4)
 * @param {'screenshot'|'csv'|'test-output'|'other'} [opts.kind]
 * @returns {{ type: 'artifact-evidence', id: string, ref: string, hash: string|null, kind: string, label: string }}
 */
export function makeArtifactEvidenceNode({ ref, hash = null, kind = 'other' }) {
  return {
    type: /** @type {'artifact-evidence'} */ ('artifact-evidence'),
    id: `artifact-evidence:${ref}`,
    ref,
    hash,
    kind,
    label: ref.split('/').pop() ?? ref,
  }
}

// ---------------------------------------------------------------------------
// Edge factory
// ---------------------------------------------------------------------------

/**
 * Create an edge record in the traceability graph.
 *
 * @param {string} source - Source node id
 * @param {string} target - Target node id
 * @param {keyof typeof ALL_TRACEABILITY_EDGE_KINDS} kind - Edge kind
 * @returns {{ source: string, target: string, kind: string }}
 */
export function makeEdge(source, target, kind) {
  return { source, target, kind }
}
