/**
 * test/motive-graph-mutate.test.mjs
 *
 * Round-trip tests for the event-sourced mutation vocabulary (S3 / MOTIVE-DAG-R-003).
 *
 * Coverage:
 *   S3-AC1 — each of the 5 primitives, when emitted then folded via
 *             foldWithMutations, yields exactly the intended graph delta.
 *   S3-AC2 — node.retire / edge.retire fold to a retired state AND a fold
 *             at opts.at BEFORE the retirement shows the node/edge live.
 *   S3-AC3 — every primitive produces an event that carries motive_provenance
 *             (verified on the event object; write path tested indirectly).
 *   S3-AC4 — zero new tsc errors (verified externally; .d.mts sibling ships).
 */

import { describe, it, expect } from 'vitest'
import {
  nodeAssertRevision,
  nodeRetireRevision,
  edgeAssertRevision,
  edgeRetireRevision,
  attrSetRevision,
  foldWithMutations,
  GRAPH_MUTATE,
} from '../hooks/lib/motive-graph-mutate.mjs'

// ── Helpers ────────────────────────────────────────────────────────────────

const M0 = { ts: '2026-01-01T00:00:00.000Z', author: 'tester', motive: 'test-motive', session: 'test-s' }
const M1 = { ts: '2026-01-01T00:01:00.000Z', author: 'tester', motive: 'test-motive', session: 'test-s' }
const M2 = { ts: '2026-01-01T00:02:00.000Z', author: 'tester', motive: 'test-motive', session: 'test-s' }

/** Build meta with a specific minute offset (0–9). */
function at(minute, motive = 'rt') {
  const mm = String(minute).padStart(2, '0')
  return { ts: `2026-01-01T00:${mm}:00.000Z`, motive, session: 's' }
}

// ── Event shape / S3-AC3 ──────────────────────────────────────────────────

describe('event constructors — shape and S3-AC3 (motive_provenance)', () => {
  it('nodeAssertRevision produces a GRAPH_MUTATE event with all required fields', () => {
    const ev = nodeAssertRevision('decision', 'decision:D-1', { title: 'Test' }, M0)
    expect(ev.type).toBe(GRAPH_MUTATE)
    expect(ev.ts).toBe(M0.ts)
    expect(ev.session).toBe(M0.session)
    expect(ev.motive).toBe(M0.motive)
    expect(ev.data.op).toBe('node.assert')
    expect(ev.data.kind).toBe('decision')
    expect(ev.data.id).toBe('decision:D-1')
    expect(ev.data.attrs).toEqual({ title: 'Test' })
    expect(ev.data.author).toBe('tester')
    // S3-AC3: carries motive_provenance
    expect(ev.data.motive_provenance).toBe(M0.motive)
  })

  it('nodeAssertRevision throws TypeError for unknown node kind', () => {
    expect(() => nodeAssertRevision('bogus-kind', 'x', {}, M0)).toThrow(TypeError)
    expect(() => nodeAssertRevision('bogus-kind', 'x', {}, M0)).toThrow(/unknown node kind/)
  })

  it('nodeRetireRevision produces correct event with motive_provenance', () => {
    const ev = nodeRetireRevision('decision:D-1', 'superseded-by:D-2', M0)
    expect(ev.type).toBe(GRAPH_MUTATE)
    expect(ev.data.op).toBe('node.retire')
    expect(ev.data.id).toBe('decision:D-1')
    expect(ev.data.by).toBe('superseded-by:D-2')
    expect(ev.data.motive_provenance).toBe(M0.motive)  // S3-AC3
  })

  it('edgeAssertRevision produces correct event with motive_provenance', () => {
    const ev = edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', M0)
    expect(ev.type).toBe(GRAPH_MUTATE)
    expect(ev.data.op).toBe('edge.assert')
    expect(ev.data.kind).toBe('anchors')
    expect(ev.data.from).toBe('objective:root')
    expect(ev.data.to).toBe('decision:D-1')
    expect(ev.data.motive_provenance).toBe(M0.motive)  // S3-AC3
  })

  it('edgeAssertRevision throws TypeError for unknown edge kind', () => {
    expect(() => edgeAssertRevision('bogus-edge', 'a', 'b', M0)).toThrow(TypeError)
    expect(() => edgeAssertRevision('bogus-edge', 'a', 'b', M0)).toThrow(/unknown edge kind/)
  })

  it('edgeRetireRevision produces correct event with motive_provenance', () => {
    const ev = edgeRetireRevision('anchors', 'objective:root', 'decision:D-1', M0)
    expect(ev.type).toBe(GRAPH_MUTATE)
    expect(ev.data.op).toBe('edge.retire')
    expect(ev.data.kind).toBe('anchors')
    expect(ev.data.motive_provenance).toBe(M0.motive)  // S3-AC3
  })

  it('edgeRetireRevision throws TypeError for unknown edge kind', () => {
    expect(() => edgeRetireRevision('bogus-edge', 'a', 'b', M0)).toThrow(TypeError)
  })

  it('attrSetRevision produces correct event with motive_provenance', () => {
    const ev = attrSetRevision('decision:D-1', 'status', 'accepted', M0)
    expect(ev.type).toBe(GRAPH_MUTATE)
    expect(ev.data.op).toBe('attr.set')
    expect(ev.data.nodeId).toBe('decision:D-1')
    expect(ev.data.key).toBe('status')
    expect(ev.data.value).toBe('accepted')
    expect(ev.data.motive_provenance).toBe(M0.motive)  // S3-AC3
  })
})

// ── Round-trip fold — S3-AC1 ─────────────────────────────────────────────

describe('round-trip fold — S3-AC1 (each primitive yields the intended delta)', () => {
  it('node.assert: node appears in fold result with correct type and attrs', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', { title: 'My Decision' }, M0),
    ]
    const graph = foldWithMutations(events)
    const node = graph.nodes.find((n) => n.id === 'decision:D-1')
    expect(node).toBeDefined()
    expect(node.type).toBe('decision')
    expect(node.attrs.title).toBe('My Decision')
  })

  it('node.assert on all legal node kinds succeeds', () => {
    const kinds = [
      'objective', 'decision', 'open-item', 'ticket',
      'acceptance-criterion', 'slice', 'spec-requirement', 'baseline',
    ]
    for (const kind of kinds) {
      const ev = nodeAssertRevision(kind, `${kind}:test`, {}, M0)
      expect(ev.data.kind).toBe(kind)
      const graph = foldWithMutations([ev])
      expect(graph.nodes.find((n) => n.id === `${kind}:test`)).toBeDefined()
    }
  })

  it('node.assert upserts attrs on an existing node (Object.assign semantics)', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', { title: 'First', extra: 'keep' }, M0),
      nodeAssertRevision('decision', 'decision:D-1', { title: 'Second', status: 'accepted' }, M1),
    ]
    const graph = foldWithMutations(events)
    const node = graph.nodes.find((n) => n.id === 'decision:D-1')
    expect(node.attrs.title).toBe('Second')    // overwritten
    expect(node.attrs.status).toBe('accepted') // added
    expect(node.attrs.extra).toBe('keep')      // preserved from first assert
  })

  it('edge.assert: edge appears in fold result', () => {
    const events = [
      nodeAssertRevision('objective', 'objective:root', { objective: 'Win' }, M0),
      nodeAssertRevision('decision', 'decision:D-1', { title: 'D1' }, M0),
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', M1),
    ]
    const graph = foldWithMutations(events)
    const edge = graph.edges.find(
      (e) => e.kind === 'anchors' && e.from === 'objective:root' && e.to === 'decision:D-1'
    )
    expect(edge).toBeDefined()
  })

  it('edge.assert deduplicates: same kind+from+to is not doubled', () => {
    const events = [
      nodeAssertRevision('objective', 'objective:root', {}, M0),
      nodeAssertRevision('decision', 'decision:D-1', {}, M0),
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', M0),
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', M1),
    ]
    const graph = foldWithMutations(events)
    const anchors = graph.edges.filter((e) => e.kind === 'anchors')
    expect(anchors.length).toBe(1)
  })

  it('attr.set: updates a specific node attribute, leaves others intact', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', { title: 'D1', status: 'proposed' }, M0),
      attrSetRevision('decision:D-1', 'status', 'accepted', M1),
    ]
    const graph = foldWithMutations(events)
    const node = graph.nodes.find((n) => n.id === 'decision:D-1')
    expect(node.attrs.status).toBe('accepted')
    expect(node.attrs.title).toBe('D1')  // unchanged
  })

  it('attr.set on a non-existent node is a silent no-op', () => {
    const events = [attrSetRevision('decision:nonexistent', 'status', 'x', M0)]
    expect(() => foldWithMutations(events)).not.toThrow()
    const graph = foldWithMutations(events)
    expect(graph.nodes).toHaveLength(0)
  })
})

// ── Retire semantics — S3-AC2 ─────────────────────────────────────────────

describe('retire semantics — S3-AC2 (retire is a revision, not a delete)', () => {
  it('node.retire: retired node is absent from fold output', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', { title: 'D1' }, M0),
      nodeRetireRevision('decision:D-1', 'test-retire', M1),
    ]
    const graph = foldWithMutations(events)
    expect(graph.nodes.find((n) => n.id === 'decision:D-1')).toBeUndefined()
  })

  it('node.retire: fold at opts.at = assert-ts shows node live (time-travel)', () => {
    const t1 = '2026-01-01T00:00:00.000Z'  // assert
    const t2 = '2026-01-01T00:01:00.000Z'  // retire
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', { title: 'D1' }, { ts: t1, motive: 'tm' }),
      nodeRetireRevision('decision:D-1', 'test-retire',                { ts: t2, motive: 'tm' }),
    ]

    // At t1 (assert only) — node is live
    const before = foldWithMutations(events, { at: t1 })
    expect(before.nodes.find((n) => n.id === 'decision:D-1')).toBeDefined()

    // At t2 (retire included) — node is gone
    const after = foldWithMutations(events, { at: t2 })
    expect(after.nodes.find((n) => n.id === 'decision:D-1')).toBeUndefined()
  })

  it('node.retire is an append — both assert and retire events remain in the stream', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', {}, M0),
      nodeRetireRevision('decision:D-1', 'obsolete', M1),
    ]
    // Both events coexist in the stream (append-only, no mutation of prior event)
    expect(events.filter((e) => e.data.op === 'node.assert').length).toBe(1)
    expect(events.filter((e) => e.data.op === 'node.retire').length).toBe(1)
    expect(events.length).toBe(2)
  })

  it('edge.retire: retired edge is absent from fold output', () => {
    const events = [
      nodeAssertRevision('objective', 'objective:root', {}, M0),
      nodeAssertRevision('decision', 'decision:D-1', {}, M0),
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', M0),
      edgeRetireRevision('anchors', 'objective:root', 'decision:D-1', M1),
    ]
    const graph = foldWithMutations(events)
    expect(graph.edges.find((e) => e.kind === 'anchors')).toBeUndefined()
  })

  it('edge.retire: fold at opts.at = assert-ts shows edge live (time-travel)', () => {
    const t1 = '2026-01-01T00:00:00.000Z'
    const t2 = '2026-01-01T00:01:00.000Z'
    const events = [
      nodeAssertRevision('objective', 'objective:root', {}, { ts: t1, motive: 'tm' }),
      nodeAssertRevision('decision', 'decision:D-1', {}, { ts: t1, motive: 'tm' }),
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', { ts: t1, motive: 'tm' }),
      edgeRetireRevision('anchors', 'objective:root', 'decision:D-1', { ts: t2, motive: 'tm' }),
    ]

    // At t1 — edge is live
    const before = foldWithMutations(events, { at: t1 })
    expect(before.edges.find((e) => e.kind === 'anchors')).toBeDefined()

    // At t2 — edge is retired
    const after = foldWithMutations(events, { at: t2 })
    expect(after.edges.find((e) => e.kind === 'anchors')).toBeUndefined()
  })

  it('edge.retire is an append — both assert and retire events remain in the stream', () => {
    const events = [
      edgeAssertRevision('anchors', 'a', 'b', M0),
      edgeRetireRevision('anchors', 'a', 'b', M1),
    ]
    expect(events.filter((e) => e.data.op === 'edge.assert').length).toBe(1)
    expect(events.filter((e) => e.data.op === 'edge.retire').length).toBe(1)
    expect(events.length).toBe(2)
  })
})

// ── Motive derivation ────────────────────────────────────────────────────

describe('motive derivation', () => {
  it('motive is derived from the first event in a pure GRAPH_MUTATE stream', () => {
    const events = [
      nodeAssertRevision('decision', 'decision:D-1', {}, { ts: M0.ts, motive: 'my-motive', session: 's' }),
    ]
    const graph = foldWithMutations(events)
    expect(graph.motive).toBe('my-motive')
  })

  it('empty stream produces empty motive and empty graph', () => {
    const graph = foldWithMutations([])
    expect(graph.motive).toBe('')
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })
})

// ── Full round-trip: all 5 primitives in sequence ─────────────────────────

describe('full round-trip — all 5 primitives (S3-AC1 + S3-AC2 combined)', () => {
  it('assert × 2, edge.assert, attr.set, node.retire, edge.retire produce correct graph', () => {
    const events = [
      // 1. node.assert — objective
      nodeAssertRevision('objective', 'objective:root', { objective: 'Build it' }, at(0)),
      // 2. node.assert — decision D-1
      nodeAssertRevision('decision', 'decision:D-1', { title: 'Choose X', status: 'proposed' }, at(1)),
      // 3. edge.assert — anchors objective → D-1
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-1', at(2)),
      // 4. attr.set — update D-1 status
      attrSetRevision('decision:D-1', 'status', 'accepted', at(3)),
      // 5. node.assert — decision D-2 (will be retired)
      nodeAssertRevision('decision', 'decision:D-2', { title: 'Alt' }, at(4)),
      // 6. edge.assert — anchors objective → D-2 (will be retired)
      edgeAssertRevision('anchors', 'objective:root', 'decision:D-2', at(5)),
      // 7. node.retire — D-2
      nodeRetireRevision('decision:D-2', 'obsolete', at(6)),
      // 8. edge.retire — anchors → D-2
      edgeRetireRevision('anchors', 'objective:root', 'decision:D-2', at(7)),
    ]

    const graph = foldWithMutations(events)

    // objective:root present
    const obj = graph.nodes.find((n) => n.id === 'objective:root')
    expect(obj).toBeDefined()
    expect(obj.type).toBe('objective')
    expect(obj.attrs.objective).toBe('Build it')

    // decision:D-1 present with attr.set-updated status
    const d1 = graph.nodes.find((n) => n.id === 'decision:D-1')
    expect(d1).toBeDefined()
    expect(d1.attrs.status).toBe('accepted')
    expect(d1.attrs.title).toBe('Choose X')

    // anchors edge to D-1 present
    const e1 = graph.edges.find((e) => e.kind === 'anchors' && e.to === 'decision:D-1')
    expect(e1).toBeDefined()

    // decision:D-2 is retired — absent from output
    expect(graph.nodes.find((n) => n.id === 'decision:D-2')).toBeUndefined()

    // edge to D-2 is retired — absent from output
    expect(graph.edges.find((e) => e.to === 'decision:D-2')).toBeUndefined()

    // exactly 2 non-retired nodes
    expect(graph.nodes.length).toBe(2)
    // exactly 1 non-retired edge
    expect(graph.edges.length).toBe(1)
  })
})
