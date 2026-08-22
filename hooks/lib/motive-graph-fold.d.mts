/**
 * Type declarations for hooks/lib/motive-graph-fold.mjs
 *
 * Required so TypeScript test files that import this module do not emit
 * TS7016 ("Could not find a declaration file") errors.
 */

export declare const SCHEMA_VERSION: number

export declare const NODE_KINDS: ReadonlySet<string>

export declare const CONSUMED_FIELDS: Readonly<Record<string, ReadonlySet<string>>>

export interface FoldNode {
  id: string
  type: string
  attrs: Record<string, unknown>
  retired?: boolean
}

export interface FoldEdge {
  kind: string
  from: string
  to: string
  retired?: boolean
}

export interface FoldAttrs {
  gates:             Array<Record<string, unknown>>
  milestones:        Array<Record<string, unknown>>
  sessions:          Array<Record<string, unknown>>
  verifications:     Array<Record<string, unknown>>
  pauses:            Array<Record<string, unknown>>
  session_starts:    Array<Record<string, unknown>>
  spec_changes:      Array<Record<string, unknown>>
  lint_drifts:       Array<Record<string, unknown>>
  prototype_results: Array<Record<string, unknown>>
  failures:          Array<Record<string, unknown>>
  waivers:           Array<Record<string, unknown>>
  handoffs:          Array<Record<string, unknown>>
  spec_drifts:       Array<Record<string, unknown>>
  ac_retractions:    Array<Record<string, unknown>>
}

export interface FoldGraph {
  schema_version: number
  motive: string
  nodes: FoldNode[]
  edges: FoldEdge[]
  attrs: FoldAttrs
}

export interface FoldOptions {
  /** ISO-8601 timestamp — fold only events up to and including this point. */
  at?: string
  /** Optional compiled charter context (reserved for S2+). */
  charter?: object
  /** Optional ground-truth graph for the S5 equivalence harness. */
  groundTruth?: object
}

/**
 * Assemble a canonical motive graph by replaying an ordered journal event stream.
 *
 * Pure function: no I/O, no mutation of inputs, deterministic for a fixed
 * ordered event list.
 *
 * Signature is FROZEN (D-9/D-10) — later slices extend behaviour, not shape.
 *
 * @param orderedEvents Pre-ordered journal events from `readOrderedEvents`.
 * @param opts          Optional fold options.
 * @returns             Canonical graph document.
 */
export declare function assembleGraphFold(
  orderedEvents: object[],
  opts?: FoldOptions
): FoldGraph
