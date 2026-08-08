/**
 * graph-seal.test.mjs — tests for S4 (MOTIVE-DAG-R-005 tamper-evident seal).
 *
 * Covers:
 *   S4-AC1: canonicalGraphState is order-insensitive (insertion order invariance).
 *   S4-AC2: verifySeal passes for untampered seal; fails on any node/edge/attr mutation.
 *   AC-bonus: determinism, absent-seal guard, reordering invariance of computed seal.
 *   S4-AC3 is a static import guard — tested by asserting no fold import here (grep-based).
 */

import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  canonicalGraphState,
  computeSeal,
  verifySeal,
} from '../hooks/lib/graph-seal.mjs'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal valid folded-graph object with two nodes and one edge. */
function makeGraph() {
  return {
    schema_version: 1,
    motive: 'test-motive',
    nodes: [
      {
        kind: 'objective',
        id: 'objective:root',
        attrs: { title: 'Root Objective', status: 'open' },
        retired: false,
      },
      {
        kind: 'decision',
        id: 'decision:D-1',
        attrs: { summary: 'Use HMAC-SHA256', rationale: 'Standard' },
        retired: false,
      },
    ],
    edges: [
      { kind: 'IMPLEMENTS', from: 'decision:D-1', to: 'objective:root', retired: false },
    ],
    attrs: { gates: [], sessions: [], milestones: [] },
  }
}

/** Deep clone via JSON round-trip. */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// ---------------------------------------------------------------------------
// canonicalGraphState — S4-AC1
// ---------------------------------------------------------------------------

describe('canonicalGraphState', () => {
  it('returns a string', () => {
    expect(typeof canonicalGraphState(makeGraph())).toBe('string')
  })

  it('is deterministic: same graph → same string on repeated calls', () => {
    const g = makeGraph()
    expect(canonicalGraphState(g)).toBe(canonicalGraphState(g))
  })

  it('S4-AC1 — order-insensitive: reversed node array yields identical string', () => {
    const g1 = makeGraph()
    const g2 = makeGraph()
    g2.nodes = [...g2.nodes].reverse()
    expect(canonicalGraphState(g1)).toBe(canonicalGraphState(g2))
  })

  it('S4-AC1 — order-insensitive: reversed edge array yields identical string', () => {
    // Only meaningful when there are ≥2 edges.
    const g = makeGraph()
    g.edges.push({ kind: 'BLOCKED_BY', from: 'decision:D-1', to: 'objective:root', retired: false })
    const g2 = clone(g)
    g2.edges = [...g2.edges].reverse()
    expect(canonicalGraphState(g)).toBe(canonicalGraphState(g2))
  })

  it('S4-AC1 — order-insensitive: shuffled node attrs yield identical string', () => {
    const g1 = makeGraph()
    const g2 = makeGraph()
    // Swap key insertion order of node attrs by rebuilding the object
    g2.nodes[0].attrs = { status: 'open', title: 'Root Objective' }
    expect(canonicalGraphState(g1)).toBe(canonicalGraphState(g2))
  })

  it('reflects a change when a node attr is modified', () => {
    const g1 = makeGraph()
    const g2 = clone(g1)
    g2.nodes[0].attrs.title = 'Changed Title'
    expect(canonicalGraphState(g1)).not.toBe(canonicalGraphState(g2))
  })

  it('reflects a change when a node is added', () => {
    const g1 = makeGraph()
    const g2 = clone(g1)
    g2.nodes.push({ kind: 'ticket', id: 'ticket:T-99', attrs: {}, retired: false })
    expect(canonicalGraphState(g1)).not.toBe(canonicalGraphState(g2))
  })

  it('reflects a change when an edge kind is mutated', () => {
    const g1 = makeGraph()
    const g2 = clone(g1)
    g2.edges[0].kind = 'BLOCKED_BY'
    expect(canonicalGraphState(g1)).not.toBe(canonicalGraphState(g2))
  })
})

// ---------------------------------------------------------------------------
// computeSeal
// ---------------------------------------------------------------------------

describe('computeSeal', () => {
  it('returns a 64-char hex string (HMAC-SHA256)', () => {
    const key = randomBytes(32)
    const state = canonicalGraphState(makeGraph())
    const seal = computeSeal(state, key)
    expect(typeof seal).toBe('string')
    expect(seal).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(seal)).toBe(true)
  })

  it('is deterministic for a fixed state and key', () => {
    const key = randomBytes(32)
    const state = canonicalGraphState(makeGraph())
    expect(computeSeal(state, key)).toBe(computeSeal(state, key))
  })

  it('accepts a hex-encoded key string', () => {
    const key = randomBytes(32)
    const hexKey = key.toString('hex')
    const state = canonicalGraphState(makeGraph())
    expect(computeSeal(state, key)).toBe(computeSeal(state, hexKey))
  })

  it('produces different seals for different keys', () => {
    const state = canonicalGraphState(makeGraph())
    const seal1 = computeSeal(state, randomBytes(32))
    const seal2 = computeSeal(state, randomBytes(32))
    expect(seal1).not.toBe(seal2)
  })
})

// ---------------------------------------------------------------------------
// verifySeal — S4-AC2
// ---------------------------------------------------------------------------

describe('verifySeal', () => {
  it('S4-AC2 — passes for an untampered sealed graph', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    expect(verifySeal({ ...g, seal }, key)).toBe(true)
  })

  it('S4-AC2 — FAILS when a node attr is mutated (tamper detection)', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    const tampered = clone(g)
    tampered.nodes[0].attrs.title = 'TAMPERED'
    tampered.seal = seal
    expect(verifySeal(tampered, key)).toBe(false)
  })

  it('S4-AC2 — FAILS when an edge kind is mutated', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    const tampered = clone(g)
    tampered.edges[0].kind = 'BLOCKED_BY'
    tampered.seal = seal
    expect(verifySeal(tampered, key)).toBe(false)
  })

  it('S4-AC2 — FAILS when a node is added after sealing', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    const tampered = clone(g)
    tampered.nodes.push({ kind: 'ticket', id: 'ticket:T-99', attrs: {}, retired: false })
    tampered.seal = seal
    expect(verifySeal(tampered, key)).toBe(false)
  })

  it('S4-AC2 — FAILS when an edge is removed after sealing', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    const tampered = clone(g)
    tampered.edges = []
    tampered.seal = seal
    expect(verifySeal(tampered, key)).toBe(false)
  })

  it('S4-AC2 — FAILS when retired flag on a node is toggled', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key)
    const tampered = clone(g)
    tampered.nodes[0].retired = true
    tampered.seal = seal
    expect(verifySeal(tampered, key)).toBe(false)
  })

  it('S4-AC2 — FAILS when the wrong key is used for verification', () => {
    const g = makeGraph()
    const key1 = randomBytes(32)
    const key2 = randomBytes(32)
    const seal = computeSeal(canonicalGraphState(g), key1)
    expect(verifySeal({ ...g, seal }, key2)).toBe(false)
  })

  it('returns false when seal field is absent', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    expect(verifySeal(g, key)).toBe(false)
  })

  it('returns false when seal is not a string', () => {
    const g = makeGraph()
    const key = randomBytes(32)
    expect(verifySeal({ ...g, seal: 42 }, key)).toBe(false)
  })

  it('S4-AC1 — reordering invariance: two graphs with same nodes/edges in different order produce identical seal', () => {
    const g1 = makeGraph()
    const g2 = makeGraph()
    g2.nodes = [...g2.nodes].reverse()
    g2.edges = [...g2.edges].reverse()
    const key = randomBytes(32)
    const seal1 = computeSeal(canonicalGraphState(g1), key)
    const seal2 = computeSeal(canonicalGraphState(g2), key)
    expect(seal1).toBe(seal2)
    // Both should verify with each other's graph
    expect(verifySeal({ ...g2, seal: seal1 }, key)).toBe(true)
  })
})
