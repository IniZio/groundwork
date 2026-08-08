/**
 * motive-graph-mutate.mjs — Event-sourced mutation vocabulary for the motive DAG.
 *
 * Implements the five write-side primitives defined by MOTIVE-DAG-R-003 (D-9):
 *
 *   nodeAssertRevision(kind, id, attrs, meta)    — node.assert
 *   nodeRetireRevision(id, by, meta)             — node.retire
 *   edgeAssertRevision(kind, from, to, meta)     — edge.assert
 *   edgeRetireRevision(kind, from, to, meta)     — edge.retire
 *   attrSetRevision(nodeId, key, value, meta)    — attr.set
 *
 * Each constructor returns a well-formed journal-shaped GRAPH_MUTATE event.
 * Callers inject { ts, author, motive, session } via `meta` — no ambient
 * wall-clock or env reads so tests can pin values deterministically.  A default
 * of `new Date().toISOString()` is provided for production callers that do not
 * inject a timestamp.
 *
 * Write path: appendMutationEvent(shardPath, event) — uses appendEvent()
 * (O_APPEND atomic write) directly, bypassing emitHookEvent's VALID_TYPES
 * guard.  GRAPH_MUTATE is not yet in VALID_TYPES — this is a known follow-up:
 * a native fold handler + VALID_TYPES entry is needed for read-path visibility
 * (the current assembleGraphFold silently skips GRAPH_MUTATE events).
 *
 * Fold path: foldWithMutations(allEvents, opts) — wraps assembleGraphFold()
 * for regular (non-GRAPH_MUTATE) events, then overlays GRAPH_MUTATE revisions
 * in ts order, applying the same `ts ≤ at` predicate as the frozen fold.
 * On a pure GRAPH_MUTATE stream it produces the same result as a native fold
 * handler would.  On mixed streams GRAPH_MUTATE events are applied after the
 * base fold ("mutation overlay" semantic); strict ts-merge requires a native
 * fold handler (follow-up).
 *
 * Purity contract:
 *   - Constructors are pure: (args, meta) → event object, no I/O.
 *   - NODE_KINDS / EDGE_KINDS imported from sibling modules; kind validation
 *     throws TypeError at construction time so bad kinds surface at the write
 *     boundary rather than silently at fold time.
 *   - foldWithMutations imports assembleGraphFold but does not modify it.
 */

import { appendEvent } from './journal-io.mjs'
import { assembleGraphFold, NODE_KINDS } from './motive-graph-fold.mjs'
import { EDGE_KINDS } from './motive-graph.mjs'

/** The event type written by every mutation primitive. */
export const GRAPH_MUTATE = 'GRAPH_MUTATE'

// ── Pure event constructors ────────────────────────────────────────────────
// Each returns a journal-shaped event object.  No file I/O.

/**
 * Construct a node.assert revision event.
 *
 * @param {string} kind    Node kind — must be a member of NODE_KINDS.
 * @param {string} id      Stable node id.
 * @param {object} attrs   Attribute bag for this node.
 * @param {{ ts?: string, author?: string | null, motive?: string, session?: string }} [meta]
 * @returns {object}  GRAPH_MUTATE journal event.
 */
export function nodeAssertRevision(kind, id, attrs, meta = {}) {
  if (!NODE_KINDS.has(kind)) {
    throw new TypeError(`nodeAssertRevision: unknown node kind "${kind}"`)
  }
  const { ts = new Date().toISOString(), author = null, motive = '', session = 'unknown' } = meta
  return {
    ts,
    session,
    motive,
    type: GRAPH_MUTATE,
    data: { op: 'node.assert', kind, id, attrs: attrs ?? {}, author, motive_provenance: motive },
  }
}

/**
 * Construct a node.retire revision event.
 *
 * Retirement is an immutable append — it never deletes the prior assert event.
 * Time-travel via `opts.at` (before this event's ts) will show the node live.
 *
 * @param {string} id  Node id to retire.
 * @param {string} by  Reason / agent that caused the retirement.
 * @param {{ ts?: string, author?: string | null, motive?: string, session?: string }} [meta]
 * @returns {object}  GRAPH_MUTATE journal event.
 */
export function nodeRetireRevision(id, by, meta = {}) {
  const { ts = new Date().toISOString(), author = null, motive = '', session = 'unknown' } = meta
  return {
    ts,
    session,
    motive,
    type: GRAPH_MUTATE,
    data: { op: 'node.retire', id, by, author, motive_provenance: motive },
  }
}

/**
 * Construct an edge.assert revision event.
 *
 * @param {string} kind  Edge kind — must be a key of EDGE_KINDS.
 * @param {string} from  Source node id.
 * @param {string} to    Target node id.
 * @param {{ ts?: string, author?: string | null, motive?: string, session?: string }} [meta]
 * @returns {object}  GRAPH_MUTATE journal event.
 */
export function edgeAssertRevision(kind, from, to, meta = {}) {
  if (!EDGE_KINDS[kind]) {
    throw new TypeError(`edgeAssertRevision: unknown edge kind "${kind}"`)
  }
  const { ts = new Date().toISOString(), author = null, motive = '', session = 'unknown' } = meta
  return {
    ts,
    session,
    motive,
    type: GRAPH_MUTATE,
    data: { op: 'edge.assert', kind, from, to, author, motive_provenance: motive },
  }
}

/**
 * Construct an edge.retire revision event.
 *
 * Retirement is an immutable append — does not delete the prior edge.assert.
 *
 * @param {string} kind  Edge kind — must be a key of EDGE_KINDS.
 * @param {string} from  Source node id.
 * @param {string} to    Target node id.
 * @param {{ ts?: string, author?: string | null, motive?: string, session?: string }} [meta]
 * @returns {object}  GRAPH_MUTATE journal event.
 */
export function edgeRetireRevision(kind, from, to, meta = {}) {
  if (!EDGE_KINDS[kind]) {
    throw new TypeError(`edgeRetireRevision: unknown edge kind "${kind}"`)
  }
  const { ts = new Date().toISOString(), author = null, motive = '', session = 'unknown' } = meta
  return {
    ts,
    session,
    motive,
    type: GRAPH_MUTATE,
    data: { op: 'edge.retire', kind, from, to, author, motive_provenance: motive },
  }
}

/**
 * Construct an attr.set revision event.
 *
 * @param {string} nodeId  Target node id.
 * @param {string} key     Attribute key to set.
 * @param {unknown} value  New attribute value.
 * @param {{ ts?: string, author?: string | null, motive?: string, session?: string }} [meta]
 * @returns {object}  GRAPH_MUTATE journal event.
 */
export function attrSetRevision(nodeId, key, value, meta = {}) {
  const { ts = new Date().toISOString(), author = null, motive = '', session = 'unknown' } = meta
  return {
    ts,
    session,
    motive,
    type: GRAPH_MUTATE,
    data: { op: 'attr.set', nodeId, key, value, author, motive_provenance: motive },
  }
}

// ── Write helper ──────────────────────────────────────────────────────────

/**
 * Append a GRAPH_MUTATE event to a journal shard via O_APPEND atomic write.
 *
 * Uses appendEvent() from journal-io.mjs directly (not emitHookEvent) because
 * emitHookEvent validates type against VALID_TYPES and GRAPH_MUTATE is not yet
 * registered there.  The write is still append-only to the same shard file,
 * satisfying S3-AC3's "no primitive writes outside the append-only shard"
 * requirement.  motive_provenance is set by the constructors above.
 *
 * @param {string} shardPath  Absolute path to the target .jsonl shard.
 * @param {object} event      A GRAPH_MUTATE event from one of the constructors above.
 */
export function appendMutationEvent(shardPath, event) {
  appendEvent(shardPath, event)
}

// ── Extended fold ─────────────────────────────────────────────────────────

/**
 * foldWithMutations(allEvents, opts)
 *
 * Wraps assembleGraphFold() to handle GRAPH_MUTATE revision events alongside
 * the existing event vocabulary.
 *
 * Strategy:
 *   1. Partition: separate GRAPH_MUTATE events from all other (regular) events.
 *   2. Fold regular events via the frozen assembleGraphFold() (applies at filter
 *      internally).
 *   3. Overlay GRAPH_MUTATE revisions onto the base graph in ts order, applying
 *      the same `ts ≤ at` predicate.
 *
 * On a pure GRAPH_MUTATE stream (all events are GRAPH_MUTATE), step 2 returns
 * an empty base graph and step 3 builds the full graph from the revisions —
 * producing the same result as a native fold handler would.
 *
 * motive is derived from the FULL allEvents array (not just the regular subset)
 * so a pure GRAPH_MUTATE stream still surfaces the correct motive slug.
 *
 * Known limitation (mixed streams): GRAPH_MUTATE events are applied AFTER the
 * base fold, not interleaved by ts.  "mutation overlay" semantic is documented;
 * strict ts-interleaving requires a native fold handler (follow-up).
 *
 * @param {object[]} allEvents
 *   Pre-ordered journal events (regular + GRAPH_MUTATE mixed).
 * @param {object} [opts]
 * @param {string} [opts.at]         ISO-8601 cutoff; fold only events ≤ this ts.
 * @param {object} [opts.charter]    Passed through to assembleGraphFold.
 * @param {object} [opts.groundTruth] Passed through to assembleGraphFold.
 * @returns {{
 *   schema_version: number,
 *   motive: string,
 *   nodes: Array<{id:string, type:string, attrs:object}>,
 *   edges: Array<{kind:string, from:string, to:string}>,
 *   attrs: object
 * }}
 */
export function foldWithMutations(allEvents, { at, charter, groundTruth } = {}) {
  // Derive motive from the FULL stream (mirrors assembleGraphFold's derivation).
  const motive = allEvents.length > 0 ? (allEvents[0].motive ?? '') : ''

  // Partition.
  const regularEvents = allEvents.filter((e) => e.type !== GRAPH_MUTATE)
  const mutateEvents  = allEvents.filter((e) => e.type === GRAPH_MUTATE)

  // Fold regular events via the frozen fold (applies at filter internally).
  const base = assembleGraphFold(regularEvents, { at, charter, groundTruth })

  // Build working graph on top of base fold result.
  // base.nodes / base.edges are already retired-stripped; we track retired flag
  // only for items we retire during mutation processing below.
  /** @type {Map<string, {id:string, type:string, attrs:object, retired?:boolean}>} */
  const nodesMap = new Map()
  for (const n of base.nodes) {
    nodesMap.set(n.id, { id: n.id, type: n.type, attrs: { ...n.attrs } })
  }
  /** @type {Array<{kind:string, from:string, to:string, retired?:boolean}>} */
  const edgesArr = base.edges.map((e) => ({ ...e }))

  // Apply GRAPH_MUTATE revisions filtered by at, sorted by ts (stable).
  const filtered = mutateEvents.filter((e) => at == null || e.ts <= at)
  filtered.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  for (const event of filtered) {
    const d = event.data ?? {}
    switch (d.op) {
      case 'node.assert': {
        const existing = nodesMap.get(d.id)
        if (existing) {
          // Mirror fold's nodeAssert: merge attrs without clearing retired.
          Object.assign(existing.attrs, d.attrs ?? {})
        } else {
          nodesMap.set(d.id, { id: d.id, type: d.kind, attrs: { ...(d.attrs ?? {}) } })
        }
        break
      }
      case 'node.retire': {
        const n = nodesMap.get(d.id)
        if (n) {
          n.retired = true
          n.attrs._retired_by = d.by
        }
        break
      }
      case 'edge.assert': {
        const dup = edgesArr.some(
          (e) => e.kind === d.kind && e.from === d.from && e.to === d.to && !e.retired
        )
        if (!dup) edgesArr.push({ kind: d.kind, from: d.from, to: d.to })
        break
      }
      case 'edge.retire': {
        const e = edgesArr.find(
          (e) => e.kind === d.kind && e.from === d.from && e.to === d.to && !e.retired
        )
        if (e) e.retired = true
        break
      }
      case 'attr.set': {
        const n = nodesMap.get(d.nodeId)
        if (n) n.attrs[d.key] = d.value
        break
      }
      // Unknown ops are silently skipped (forward-compatible).
    }
  }

  // Build output: strip retired items (mirror assembleGraphFold output contract).
  const nodes = Array.from(nodesMap.values()).filter((n) => !n.retired)
  const edges = edgesArr.filter((e) => !e.retired)

  return {
    schema_version: base.schema_version,
    motive,
    nodes,
    edges,
    attrs: base.attrs,
  }
}
