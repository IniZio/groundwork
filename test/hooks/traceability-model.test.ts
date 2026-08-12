/**
 * Tests for hooks/lib/traceability-model.mjs
 *
 * @verifies TRACEABILITY-R-002
 * @verifies TRACEABILITY-R-004
 * @verifies TRACEABILITY-R-006
 */

import { describe, it, expect } from 'vitest'
import {
  TRACEABILITY_EXTENDED_NODE_TYPES,
  ALL_TRACEABILITY_NODE_TYPES,
  TRACEABILITY_EXTENDED_EDGE_KINDS,
  ALL_TRACEABILITY_EDGE_KINDS,
  makeSelfTestNode,
  makeLiveVerifyNode,
  makeGateNode,
  makeArtifactEvidenceNode,
  makeEdge,
} from '../../hooks/lib/traceability-model.mjs'

// ---------------------------------------------------------------------------
// Node type sets
// ---------------------------------------------------------------------------

describe('TRACEABILITY_EXTENDED_NODE_TYPES', () => {
  it('contains exactly the four extended types', () => {
    expect([...TRACEABILITY_EXTENDED_NODE_TYPES].sort()).toEqual(
      ['artifact-evidence', 'gate', 'live-verify', 'self-test'],
    )
  })

  it('does not include base motive-graph types', () => {
    expect(TRACEABILITY_EXTENDED_NODE_TYPES.has('objective')).toBe(false)
    expect(TRACEABILITY_EXTENDED_NODE_TYPES.has('slice')).toBe(false)
    expect(TRACEABILITY_EXTENDED_NODE_TYPES.has('spec-requirement')).toBe(false)
  })
})

describe('ALL_TRACEABILITY_NODE_TYPES', () => {
  it('includes both base and extended types', () => {
    // Base
    expect(ALL_TRACEABILITY_NODE_TYPES.has('objective')).toBe(true)
    expect(ALL_TRACEABILITY_NODE_TYPES.has('slice')).toBe(true)
    expect(ALL_TRACEABILITY_NODE_TYPES.has('spec-requirement')).toBe(true)
    // Extended
    expect(ALL_TRACEABILITY_NODE_TYPES.has('self-test')).toBe(true)
    expect(ALL_TRACEABILITY_NODE_TYPES.has('live-verify')).toBe(true)
    expect(ALL_TRACEABILITY_NODE_TYPES.has('gate')).toBe(true)
    expect(ALL_TRACEABILITY_NODE_TYPES.has('artifact-evidence')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge kind vocabularies
// ---------------------------------------------------------------------------

describe('TRACEABILITY_EXTENDED_EDGE_KINDS', () => {
  it('declares the primary traceability edge kinds', () => {
    expect(TRACEABILITY_EXTENDED_EDGE_KINDS).toHaveProperty('covers')
    expect(TRACEABILITY_EXTENDED_EDGE_KINDS).toHaveProperty('evidences')
    expect(TRACEABILITY_EXTENDED_EDGE_KINDS).toHaveProperty('verifies')
    expect(TRACEABILITY_EXTENDED_EDGE_KINDS).toHaveProperty('confirms')
    expect(TRACEABILITY_EXTENDED_EDGE_KINDS).toHaveProperty('seals')
  })

  it('each entry has the required layout fields', () => {
    for (const [kind, def] of Object.entries(TRACEABILITY_EXTENDED_EDGE_KINDS)) {
      expect(typeof def.drives_layering, kind).toBe('boolean')
      expect(['primary', 'muted', 'hidden'], `render for ${kind}`).toContain(def.render)
      expect(['down', 'up', 'lateral'], `direction for ${kind}`).toContain(def.direction)
    }
  })
})

describe('ALL_TRACEABILITY_EDGE_KINDS', () => {
  it('includes base motive-graph edge kinds', () => {
    expect(ALL_TRACEABILITY_EDGE_KINDS).toHaveProperty('anchors')
    expect(ALL_TRACEABILITY_EDGE_KINDS).toHaveProperty('blocked_by')
    expect(ALL_TRACEABILITY_EDGE_KINDS).toHaveProperty('covers_ac')
  })

  it('includes all extended edge kinds', () => {
    for (const k of Object.keys(TRACEABILITY_EXTENDED_EDGE_KINDS)) {
      expect(ALL_TRACEABILITY_EDGE_KINDS, `extended kind ${k}`).toHaveProperty(k)
    }
  })
})

// ---------------------------------------------------------------------------
// makeSelfTestNode
// ---------------------------------------------------------------------------

describe('makeSelfTestNode', () => {
  it('creates a node with correct shape and type', () => {
    const node = makeSelfTestNode({ sliceId: 'S1', filePath: 'test/hooks/foo.test.ts' })
    expect(node.type).toBe('self-test')
    expect(node.sliceId).toBe('S1')
    expect(node.filePath).toBe('test/hooks/foo.test.ts')
    expect(node.source).toBe('direct')
    expect(node.label).toBe('foo.test.ts')
  })

  it('uses an id that encodes both sliceId and filePath', () => {
    const node = makeSelfTestNode({ sliceId: 'S2', filePath: 'test/x.test.ts' })
    expect(node.id).toBe('self-test:S2:test/x.test.ts')
  })

  it('accepts decision-mediated source', () => {
    const node = makeSelfTestNode({ sliceId: 'S1', filePath: 'test/y.test.ts', source: 'decision-mediated' })
    expect(node.source).toBe('decision-mediated')
  })

  it('is deterministic — same inputs produce identical output', () => {
    const a = makeSelfTestNode({ sliceId: 'S3', filePath: 'test/z.test.ts' })
    const b = makeSelfTestNode({ sliceId: 'S3', filePath: 'test/z.test.ts' })
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// makeLiveVerifyNode
// ---------------------------------------------------------------------------

describe('makeLiveVerifyNode', () => {
  it('creates a node with correct type and id', () => {
    const node = makeLiveVerifyNode({ claim: 'thing works', evidence: 'screenshot', result: 'pass', ord: 0 })
    expect(node.type).toBe('live-verify')
    expect(node.id).toBe('live-verify:0')
    expect(node.claim).toBe('thing works')
    expect(node.result).toBe('pass')
  })

  it('uses the ordinal in the id for uniqueness', () => {
    const a = makeLiveVerifyNode({ claim: null, evidence: null, result: null, ord: 7 })
    expect(a.id).toBe('live-verify:7')
  })

  it('falls back to ordinal in label when claim is null', () => {
    const node = makeLiveVerifyNode({ claim: null, evidence: null, result: null, ord: 3 })
    expect(node.label).toBe('verification #3')
  })
})

// ---------------------------------------------------------------------------
// makeGateNode
// ---------------------------------------------------------------------------

describe('makeGateNode', () => {
  it('creates a gate node with correct shape', () => {
    const node = makeGateNode({ which: 'advisor', verdict: 'APPROVE' })
    expect(node.type).toBe('gate')
    expect(node.id).toBe('gate:advisor')
    expect(node.which).toBe('advisor')
    expect(node.verdict).toBe('APPROVE')
    expect(node.citation).toBe(null)
    expect(node.rubric).toBe(null)
  })

  it('includes citation and rubric when provided', () => {
    const node = makeGateNode({ which: 'qa', verdict: 'CORRECTION', citation: 'c', rubric: 'r' })
    expect(node.citation).toBe('c')
    expect(node.rubric).toBe('r')
  })

  it('encodes verdict in label', () => {
    const node = makeGateNode({ which: 'advisor', verdict: 'APPROVE' })
    expect(node.label).toBe('advisor (APPROVE)')
  })
})

// ---------------------------------------------------------------------------
// makeArtifactEvidenceNode — TRACEABILITY-R-006
// ---------------------------------------------------------------------------

describe('makeArtifactEvidenceNode', () => {
  it('creates an artifact node with hash for staleness detection', () => {
    const node = makeArtifactEvidenceNode({ ref: 'screenshots/run1.png', hash: 'abc123', kind: 'screenshot' })
    expect(node.type).toBe('artifact-evidence')
    expect(node.hash).toBe('abc123')
    expect(node.kind).toBe('screenshot')
    expect(node.ref).toBe('screenshots/run1.png')
  })

  it('defaults hash to null when not provided', () => {
    const node = makeArtifactEvidenceNode({ ref: 'data.csv' })
    expect(node.hash).toBe(null)
  })

  it('uses the filename as the label', () => {
    const node = makeArtifactEvidenceNode({ ref: 'path/to/file.png' })
    expect(node.label).toBe('file.png')
  })

  it('id incorporates the ref for uniqueness', () => {
    const node = makeArtifactEvidenceNode({ ref: 'screens/a.png' })
    expect(node.id).toBe('artifact-evidence:screens/a.png')
  })
})

// ---------------------------------------------------------------------------
// makeEdge
// ---------------------------------------------------------------------------

describe('makeEdge', () => {
  it('creates an edge record with source, target, kind', () => {
    const edge = makeEdge('slice:S1', 'spec-requirement:TRACEABILITY-R-001', 'covers')
    expect(edge).toEqual({ source: 'slice:S1', target: 'spec-requirement:TRACEABILITY-R-001', kind: 'covers' })
  })

  it('is deterministic', () => {
    const a = makeEdge('a', 'b', 'evidences')
    const b = makeEdge('a', 'b', 'evidences')
    expect(a).toEqual(b)
  })
})
