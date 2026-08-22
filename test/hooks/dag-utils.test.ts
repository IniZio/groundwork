/**
 * Tests for hooks/lib/dag-utils.mjs
 *
 * PARITY REPORT — discrepancies found between the three existing implementations:
 *
 *   cmdFrontier (hooks/ledger.mjs ~line 1494):
 *     - Includes only slices with status exactly 'pending' (default when absent).
 *     - Excludes slices with kind === 'fog'.
 *     - Has session-specific claimed_by filter (omitted from pure fn).
 *
 *   motive-map frontierList (hooks/lib/motive-map.mjs ~line 743):
 *     - Excludes status 'complete' and 'in_progress'; allows 'skipped' and others.
 *     - Does NOT exclude slices with kind === 'fog'.
 *     - Also has claimed_by filter.
 *
 *   Discrepancy 1: 'skipped' status. cmdFrontier: excluded. motive-map: included.
 *   Discrepancy 2: fog kind.         cmdFrontier: excluded. motive-map: included.
 *
 *   frontier() in dag-utils.mjs follows cmdFrontier as the authoritative source.
 */

import { describe, it, expect } from 'vitest'
import {
  topoLayers,
  frontier,
  transitiveBlockers,
  hasCycle,
} from '../../hooks/lib/dag-utils.mjs'
import type { DagSlice } from '../../hooks/lib/dag-utils.mjs'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Flatten topoLayers result to a set for order-insensitive layer checks. */
function layerSets(slices: DagSlice[]): Set<string>[] {
  return topoLayers(slices).map((layer) => new Set(layer))
}

/** cmdFrontier logic reproduced verbatim from hooks/ledger.mjs for parity. */
function cmdFrontierParity(slices: DagSlice[]): DagSlice[] {
  const arr = Array.isArray(slices) ? slices : []
  const completeIds = new Set(
    arr.filter((s) => s?.status === 'complete').map((s) => s.id),
  )
  return arr.filter((s) => {
    if (!s) return false
    const status = s.status ?? 'pending'
    if (status !== 'pending') return false
    if (s.kind === 'fog') return false
    const blockedBy = Array.isArray(s.blocked_by) ? s.blocked_by : []
    // NOTE: claimed_by check omitted — pure function cannot carry session context
    return blockedBy.every((dep) => completeIds.has(dep))
  })
}

// ─── topoLayers ──────────────────────────────────────────────────────────────

describe('topoLayers', () => {
  it('returns [] for empty input', () => {
    expect(topoLayers([])).toEqual([])
  })

  it('single node with no blockers → one layer', () => {
    const result = layerSets([{ id: 'a' }])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(new Set(['a']))
  })

  it('single node with empty blocked_by → Layer 0', () => {
    const result = layerSets([{ id: 'a', blocked_by: [] }])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(new Set(['a']))
  })

  it('linear chain a → b → c yields three layers in order', () => {
    const slices: DagSlice[] = [
      { id: 'c', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
      { id: 'a' },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(new Set(['a']))
    expect(result[1]).toEqual(new Set(['b']))
    expect(result[2]).toEqual(new Set(['c']))
  })

  it('diamond: a in Layer 0, b+c in Layer 1, d in Layer 2', () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const slices: DagSlice[] = [
      { id: 'a' },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['a'] },
      { id: 'd', blocked_by: ['b', 'c'] },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(new Set(['a']))
    expect(result[1]).toEqual(new Set(['b', 'c']))
    expect(result[2]).toEqual(new Set(['d']))
  })

  it('disconnected subgraphs: each root in Layer 0', () => {
    const slices: DagSlice[] = [
      { id: 'x' },
      { id: 'y', blocked_by: ['x'] },
      { id: 'p' },
      { id: 'q', blocked_by: ['p'] },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(new Set(['x', 'p']))
    expect(result[1]).toEqual(new Set(['y', 'q']))
  })

  it('dangling edge is ignored: slice with only dangling blocker appears in Layer 0', () => {
    // 'b' doesn't exist in the array — treated as absent, not blocking
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['nonexistent'] },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(new Set(['a']))
  })

  it('mix of real and dangling blockers: dangling ignored, real counted', () => {
    const slices: DagSlice[] = [
      { id: 'a' },
      { id: 'b', blocked_by: ['a', 'ghost'] },
    ]
    const result = layerSets(slices)
    // 'ghost' is dangling — b's in-degree is 1 (only from 'a')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(new Set(['a']))
    expect(result[1]).toEqual(new Set(['b']))
  })

  it('2-node cycle: terminates without infinite loop, no layers assigned', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
    ]
    const result = topoLayers(slices)
    expect(result).toHaveLength(0) // all nodes in cycle, none assigned
  })

  it('3-node cycle: terminates, no layers assigned', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['c'] },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['b'] },
    ]
    const result = topoLayers(slices)
    expect(result).toHaveLength(0)
  })

  it('cycle plus free node: free node assigned to Layer 0, cycle nodes absent', () => {
    const slices: DagSlice[] = [
      { id: 'free' },
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(new Set(['free']))
    // cycle nodes 'a' and 'b' not in any layer
    const assigned = new Set(result.flatMap((s) => [...s]))
    expect(assigned.has('a')).toBe(false)
    expect(assigned.has('b')).toBe(false)
  })

  it('wave field presence does not affect layer computation', () => {
    // wave is an explicit ledger assignment; topoLayers computes depth independently
    const slices: DagSlice[] = [
      { id: 'a', wave: 99 },
      { id: 'b', blocked_by: ['a'], wave: null },
    ]
    const result = layerSets(slices)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(new Set(['a']))
    expect(result[1]).toEqual(new Set(['b']))
  })
})

// ─── frontier ────────────────────────────────────────────────────────────────

describe('frontier', () => {
  it('returns [] for empty input', () => {
    expect(frontier([])).toEqual([])
  })

  it('single pending node with no blockers → in frontier', () => {
    const slices: DagSlice[] = [{ id: 'a', status: 'pending' }]
    expect(frontier(slices).map((s) => s.id)).toEqual(['a'])
  })

  it('absent status treated as pending → in frontier', () => {
    const slices: DagSlice[] = [{ id: 'a' }]
    expect(frontier(slices).map((s) => s.id)).toEqual(['a'])
  })

  it('in_progress slice excluded from frontier', () => {
    const slices: DagSlice[] = [{ id: 'a', status: 'in_progress' }]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('complete slice excluded from frontier', () => {
    const slices: DagSlice[] = [{ id: 'a', status: 'complete' }]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('skipped slice excluded from frontier (matches cmdFrontier, not motive-map)', () => {
    const slices: DagSlice[] = [{ id: 'a', status: 'skipped' }]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('fog kind excluded from frontier', () => {
    const slices: DagSlice[] = [{ id: 'a', kind: 'fog', status: 'pending' }]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('pending blocker blocks the slice', () => {
    const slices: DagSlice[] = [
      { id: 'a', status: 'pending' },
      { id: 'b', status: 'pending', blocked_by: ['a'] },
    ]
    const ids = frontier(slices).map((s) => s.id)
    expect(ids).toContain('a')
    expect(ids).not.toContain('b')
  })

  it('complete blocker is satisfied; slice enters frontier', () => {
    const slices: DagSlice[] = [
      { id: 'a', status: 'complete' },
      { id: 'b', status: 'pending', blocked_by: ['a'] },
    ]
    const ids = frontier(slices).map((s) => s.id)
    expect(ids).not.toContain('a')
    expect(ids).toContain('b')
  })

  it('skipped blocker does NOT count as satisfied (matches cmdFrontier)', () => {
    const slices: DagSlice[] = [
      { id: 'a', status: 'skipped' },
      { id: 'b', status: 'pending', blocked_by: ['a'] },
    ]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('dangling blocker counts as unsatisfied: slice never enters frontier', () => {
    const slices: DagSlice[] = [
      { id: 'b', status: 'pending', blocked_by: ['nonexistent'] },
    ]
    expect(frontier(slices)).toHaveLength(0)
  })

  it('all blockers complete → frontier; one pending → not in frontier', () => {
    const slices: DagSlice[] = [
      { id: 'a', status: 'complete' },
      { id: 'b', status: 'complete' },
      { id: 'c', status: 'pending', blocked_by: ['a', 'b'] },
      { id: 'd', status: 'pending', blocked_by: ['a', 'nonexistent'] },
    ]
    const ids = frontier(slices).map((s) => s.id)
    expect(ids).toContain('c')
    expect(ids).not.toContain('d') // dangling blocker
  })

  // ── PARITY: assert frontier() ≡ cmdFrontier for the same input ──────────────
  describe('parity with cmdFrontier', () => {
    it('empty array', () => {
      const slices: DagSlice[] = []
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })

    it('all pending, no blockers', () => {
      const slices: DagSlice[] = [
        { id: 'a' },
        { id: 'b' },
      ]
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })

    it('mixed statuses and kinds', () => {
      const slices: DagSlice[] = [
        { id: 'a', status: 'complete' },
        { id: 'b', status: 'pending', blocked_by: ['a'] },
        { id: 'c', status: 'in_progress' },
        { id: 'd', status: 'skipped' },
        { id: 'e', kind: 'fog', status: 'pending' },
        { id: 'f', status: 'pending', blocked_by: ['ghost'] },
        { id: 'g', status: 'pending' },
      ]
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })

    it('chain where first is complete', () => {
      const slices: DagSlice[] = [
        { id: 'a', status: 'complete' },
        { id: 'b', status: 'pending', blocked_by: ['a'] },
        { id: 'c', status: 'pending', blocked_by: ['b'] },
      ]
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })

    it('fog slice excluded by both', () => {
      const slices: DagSlice[] = [
        { id: 'a', kind: 'fog' },
        { id: 'b', kind: 'fog', status: 'pending' },
      ]
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })

    it('skipped blocker: both treat as unsatisfied', () => {
      const slices: DagSlice[] = [
        { id: 'a', status: 'skipped' },
        { id: 'b', status: 'pending', blocked_by: ['a'] },
      ]
      expect(frontier(slices).map((s) => s.id).sort()).toEqual(
        cmdFrontierParity(slices).map((s) => s.id).sort(),
      )
    })
  })
})

// ─── transitiveBlockers ──────────────────────────────────────────────────────

describe('transitiveBlockers', () => {
  it('returns [] for empty slices', () => {
    expect(transitiveBlockers([], 'a')).toEqual([])
  })

  it('returns [] for a slice with no blockers', () => {
    const slices: DagSlice[] = [{ id: 'a' }]
    expect(transitiveBlockers(slices, 'a')).toEqual([])
  })

  it('returns [] for a slice with empty blocked_by', () => {
    const slices: DagSlice[] = [{ id: 'a', blocked_by: [] }]
    expect(transitiveBlockers(slices, 'a')).toEqual([])
  })

  it('direct blocker returned', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b' },
    ]
    expect(transitiveBlockers(slices, 'a')).toEqual(['b'])
  })

  it('full transitive closure: a → b → c', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['c'] },
      { id: 'c' },
    ]
    const result = new Set(transitiveBlockers(slices, 'a'))
    expect(result).toEqual(new Set(['b', 'c']))
  })

  it('diamond closure: all ancestors included', () => {
    const slices: DagSlice[] = [
      { id: 'd', blocked_by: ['b', 'c'] },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['a'] },
      { id: 'a' },
    ]
    const result = new Set(transitiveBlockers(slices, 'd'))
    expect(result).toEqual(new Set(['a', 'b', 'c']))
    // 'a' should appear exactly once (deduplication)
    expect(transitiveBlockers(slices, 'd').filter((id) => id === 'a')).toHaveLength(1)
  })

  it('2-node cycle: terminates, both ids returned', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
    ]
    const result = new Set(transitiveBlockers(slices, 'a'))
    // Should contain 'b' and 'a' (a is reachable via a→b→a, but deduplicated)
    expect(result.has('b')).toBe(true)
    // Does not infinite loop — test completes
  })

  it('3-node cycle: terminates, all ids in closure', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['c'] },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['b'] },
    ]
    const result = new Set(transitiveBlockers(slices, 'a'))
    // 'a' is reachable via a→c→b→a, so it IS in the closure
    expect(result).toEqual(new Set(['b', 'c', 'a']))
  })

  it('dangling edge: the dangling id IS included in the result', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['nonexistent'] },
    ]
    const result = transitiveBlockers(slices, 'a')
    expect(result).toContain('nonexistent')
  })

  it('id not in slices: returns []', () => {
    const slices: DagSlice[] = [{ id: 'a' }]
    expect(transitiveBlockers(slices, 'z')).toEqual([])
  })

  it('disconnected: only own ancestors returned, not other component', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b' },
      { id: 'x', blocked_by: ['y'] },
      { id: 'y' },
    ]
    const result = new Set(transitiveBlockers(slices, 'a'))
    expect(result).toEqual(new Set(['b']))
    expect(result.has('x')).toBe(false)
    expect(result.has('y')).toBe(false)
  })
})

// ─── hasCycle ────────────────────────────────────────────────────────────────

describe('hasCycle', () => {
  it('returns false for empty input', () => {
    expect(hasCycle([])).toBe(false)
  })

  it('returns false for a single node', () => {
    expect(hasCycle([{ id: 'a' }])).toBe(false)
  })

  it('returns false for a single node with empty blocked_by', () => {
    expect(hasCycle([{ id: 'a', blocked_by: [] }])).toBe(false)
  })

  it('returns false for a valid chain', () => {
    const slices: DagSlice[] = [
      { id: 'a' },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['b'] },
    ]
    expect(hasCycle(slices)).toBe(false)
  })

  it('returns false for a diamond (valid DAG)', () => {
    const slices: DagSlice[] = [
      { id: 'a' },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['a'] },
      { id: 'd', blocked_by: ['b', 'c'] },
    ]
    expect(hasCycle(slices)).toBe(false)
  })

  it('returns false for disconnected valid components', () => {
    const slices: DagSlice[] = [
      { id: 'a' },
      { id: 'b', blocked_by: ['a'] },
      { id: 'x' },
      { id: 'y', blocked_by: ['x'] },
    ]
    expect(hasCycle(slices)).toBe(false)
  })

  it('returns false for dangling-only edges (not a cycle)', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['nonexistent'] },
    ]
    expect(hasCycle(slices)).toBe(false)
  })

  it('detects a 2-node cycle', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
    ]
    expect(hasCycle(slices)).toBe(true)
  })

  it('detects a 3-node cycle', () => {
    const slices: DagSlice[] = [
      { id: 'a', blocked_by: ['c'] },
      { id: 'b', blocked_by: ['a'] },
      { id: 'c', blocked_by: ['b'] },
    ]
    expect(hasCycle(slices)).toBe(true)
  })

  it('detects a cycle mixed with acyclic nodes', () => {
    const slices: DagSlice[] = [
      { id: 'free' },
      { id: 'a', blocked_by: ['b'] },
      { id: 'b', blocked_by: ['a'] },
    ]
    expect(hasCycle(slices)).toBe(true)
  })

  it('self-loop: a single node blocked by itself', () => {
    const slices: DagSlice[] = [{ id: 'a', blocked_by: ['a'] }]
    expect(hasCycle(slices)).toBe(true)
  })
})
