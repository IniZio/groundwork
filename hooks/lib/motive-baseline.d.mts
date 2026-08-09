// Type declarations for motive-baseline.mjs

export interface BaselinePin {
  name: string
  ord: number
  ts: string
  shard: string
}

/**
 * Resolve a baseline name to its pin record.
 * Scans events for BASELINE events whose data.name matches `name`.
 * Latest (highest ord) match wins. Returns null for unknown names or empty streams.
 *
 * @param events - Ordered, ord-annotated event array as produced by readOrderedEvents.
 * @param name - Baseline name to look up.
 */
export declare function resolveBaseline(events: object[], name: string): BaselinePin | null

/**
 * Return the de-duplicated list of baseline names present in the event stream.
 * Order matches first appearance. Never throws.
 */
export declare function listBaselineNames(events: object[]): string[]
