/**
 * motive-graph-project.d.mts — TypeScript declarations for motive-graph-project.mjs
 */

/**
 * Fields compile() produces that cannot be reconstructed from the fold graph alone.
 */
export declare const NON_RECONSTRUCTIBLE_FIELDS: Readonly<Record<string, string>>

/**
 * Projection of the folded motive graph into the consumer-facing compile() view shape.
 *
 * Load-bearing fields:
 *   objective         — string | null
 *   decision_log      — keyed ADR entries (legacy decisions excluded)
 *   ac_coverage       — { met: [], unmet: [] } as compile() produces
 *   last_pause        — { pointer, summary, next_actions } or null
 *   baselines         — reconstructible baseline fields (name, shard)
 *   legacy_decisions_count — number of decision:_legacy_ord* nodes excluded
 */
export interface FoldProjection {
  objective: string | null
  decision_log: Array<{
    id: string | null
    status: string
    title: string | null
    decision: string | null
    rationale: string | null
    alternatives: unknown[]
    supersedes: string | null
    superseded_by: string | null
    resolves: string | null
    retires: string | null
    revises: string | null
    slices: unknown[]
  }>
  ac_coverage: {
    met: Array<{ id: string; covering: string[]; missing: string[]; met: boolean; status_unknown: boolean }>
    unmet: Array<{ id: string; covering: string[]; missing: string[]; met: boolean; status_unknown: boolean }>
  }
  last_pause: { pointer: string | null; summary: string | null; next_actions: unknown[] } | null
  baselines: Array<{ name: string | null; shard: string | null }>
  legacy_decisions_count: number
}

/**
 * Project a folded motive graph into the consumer-facing view.
 *
 * Pass `opts.events` (the original ordered events array) to enable merge-lossy
 * title recovery: the first-seen non-null title-or-decision per decision id is
 * recovered from the event stream, replicating compile()'s non-null update guard.
 * Without events, title falls back to fold attrs which may be undefined for
 * multi-event merged decisions (fold's Object.assign merge is lossy for undefined).
 */
export declare function projectFoldGraph(
  foldGraph: {
    schema_version: number
    motive: string
    nodes: Array<{ id: string; type: string; attrs: Record<string, unknown> }>
    edges: Array<{ kind: string; from: string; to: string }>
    attrs: Record<string, unknown>
  },
  opts?: { events?: object[] }
): FoldProjection
