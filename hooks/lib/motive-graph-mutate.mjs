// check-comments-exempt — hook lib; graph mutation vocabulary with dense docs
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
 * (O_APPEND atomic write).  GRAPH_MUTATE is registered in VALID_TYPES and
 * has a native fold handler in assembleGraphFold (T2-AC2); emitHookEvent
 * would also accept it, but appendEvent is used for minimal-dependency writes.
 *
 * Fold path: foldWithMutations(allEvents, opts) — thin wrapper around
 * assembleGraphFold().  GRAPH_MUTATE events are now handled natively by
 * assembleGraphFold's dispatch table (interleaved by ts with regular events),
 * so read-path consumers receive the correct ts-ordered graph state without a
 * separate mutation-overlay pass.
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
 * Thin wrapper around assembleGraphFold() for mixed event streams that include
 * GRAPH_MUTATE revision events.
 *
 * GRAPH_MUTATE events are now registered in VALID_TYPES and handled natively
 * by assembleGraphFold's dispatch table (T2-AC2 / D-11).  They are interleaved
 * with regular events by ts, so the fold produces the correct ts-ordered graph
 * state in a single pass.  No separate partition + overlay step is needed.
 *
 * This function is kept as the public API for callers that were previously using
 * the overlay path — the behaviour is now identical to calling assembleGraphFold
 * directly with all events.
 *
 * @param {object[]} allEvents
 *   Pre-ordered journal events (regular + GRAPH_MUTATE mixed).
 * @param {object} [opts]
 * @param {string} [opts.at]          ISO-8601 cutoff; fold only events ≤ this ts.
 * @param {object} [opts.charter]     Passed through to assembleGraphFold.
 * @param {object} [opts.groundTruth] Passed through to assembleGraphFold.
 * @returns {{
 *   schema_version: number,
 *   motive: string,
 *   nodes: Array<{id:string, type:string, attrs:object}>,
 *   edges: Array<{kind:string, from:string, to:string}>,
 *   attrs: object
 * }}
 */
export function foldWithMutations(allEvents, opts = {}) {
  return assembleGraphFold(allEvents, opts)
}
