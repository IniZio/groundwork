/**
 * Type declarations for hooks/lib/motive-graph-mutate.mjs
 *
 * Required so TypeScript consumers and test files that import this module do
 * not emit TS7016 ("Could not find a declaration file") errors.
 */

// ── Re-used types from the fold (declared inline to keep this file standalone) ─

interface FoldNode {
  id: string
  type: string
  attrs: Record<string, unknown>
  retired?: boolean
}

interface FoldEdge {
  kind: string
  from: string
  to: string
  retired?: boolean
}

interface FoldAttrs {
  gates: Array<Record<string, unknown>>
  milestones: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
  _other?: Record<string, Array<Record<string, unknown>>>
}

interface FoldGraph {
  schema_version: number
  motive: string
  nodes: FoldNode[]
  edges: FoldEdge[]
  attrs: FoldAttrs
}

interface FoldOptions {
  at?: string
  charter?: object
  groundTruth?: object
}

// ── Exported constants ────────────────────────────────────────────────────────

/** The journal event type written by every mutation primitive. */
export declare const GRAPH_MUTATE: 'GRAPH_MUTATE'

// ── Revision metadata ─────────────────────────────────────────────────────────

/**
 * Injectable metadata for every revision constructor.
 * Inject `ts` and `author` so tests can pin values deterministically.
 */
export interface RevisionMeta {
  /** ISO-8601 timestamp.  Defaults to `new Date().toISOString()` when omitted. */
  ts?: string
  /** Author identifier (person or agent). */
  author?: string | null
  /** Motive slug — becomes both `event.motive` and `data.motive_provenance`. */
  motive?: string
  /** Session identifier — becomes `event.session`. */
  session?: string
}

// ── Revision event shape ──────────────────────────────────────────────────────

/** A well-formed GRAPH_MUTATE journal event produced by any mutation constructor. */
export interface MutationRevision {
  ts: string
  session: string
  motive: string
  type: 'GRAPH_MUTATE'
  data: Record<string, unknown>
}

// ── Pure event constructors ───────────────────────────────────────────────────

/**
 * Construct a node.assert revision event.
 *
 * Throws `TypeError` for unknown node kinds (validates against NODE_KINDS at
 * construction time so bad kinds surface at the write boundary, not fold time).
 */
export declare function nodeAssertRevision(
  kind: string,
  id: string,
  attrs: Record<string, unknown>,
  meta?: RevisionMeta
): MutationRevision

/**
 * Construct a node.retire revision event.
 *
 * Retirement is an immutable append; time-travel via `opts.at` before this
 * event's `ts` will show the node live.
 */
export declare function nodeRetireRevision(
  id: string,
  by: string,
  meta?: RevisionMeta
): MutationRevision

/**
 * Construct an edge.assert revision event.
 *
 * Throws `TypeError` for unknown edge kinds (validates against EDGE_KINDS at
 * construction time).
 */
export declare function edgeAssertRevision(
  kind: string,
  from: string,
  to: string,
  meta?: RevisionMeta
): MutationRevision

/**
 * Construct an edge.retire revision event.
 *
 * Throws `TypeError` for unknown edge kinds (validates against EDGE_KINDS at
 * construction time).
 */
export declare function edgeRetireRevision(
  kind: string,
  from: string,
  to: string,
  meta?: RevisionMeta
): MutationRevision

/**
 * Construct an attr.set revision event.
 */
export declare function attrSetRevision(
  nodeId: string,
  key: string,
  value: unknown,
  meta?: RevisionMeta
): MutationRevision

// ── Write helper ──────────────────────────────────────────────────────────────

/**
 * Append a GRAPH_MUTATE event to a journal shard via O_APPEND atomic write.
 *
 * Uses `appendEvent()` directly (not `emitHookEvent`) to bypass the
 * VALID_TYPES guard — GRAPH_MUTATE is not yet registered in VALID_TYPES.
 * The write is still append-only to the same shard directory.
 */
export declare function appendMutationEvent(shardPath: string, event: MutationRevision): void

// ── Extended fold ─────────────────────────────────────────────────────────────

/**
 * Fold a mixed stream of regular journal events and GRAPH_MUTATE revision events.
 *
 * Regular events are folded by `assembleGraphFold()`; GRAPH_MUTATE revisions
 * are overlaid in `ts` order with the same `at`-filter.  On a pure
 * GRAPH_MUTATE stream produces the same result as a native fold handler would.
 *
 * `motive` is derived from the first event in the FULL stream (not just the
 * regular subset) so a pure GRAPH_MUTATE stream still reports the correct slug.
 */
export declare function foldWithMutations(
  allEvents: object[],
  opts?: FoldOptions
): FoldGraph
