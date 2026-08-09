// Type declarations for motive-graph-parity.mjs

export { NON_RECONSTRUCTIBLE_FIELDS } from './motive-graph-project.js'

export interface ParityResult {
  ok: boolean
  divergences: object[]
  findings: object[]
}

/**
 * Returns true if the divergence fits the "legacy decision-only later event" shape.
 * This is NOT a fold correctness bug — it is compile()'s legacy authoring pattern.
 */
export declare function isLegacyDecisionOnlyDivergence(
  events: object[],
  opts: { id: string; projected: string | null; compiled: string | null }
): boolean

/**
 * Check parity between a fold-projected view and a compiled view.
 * Requires `opts.events` to classify legacy title divergences.
 */
export declare function checkFoldCompileParity(
  projected: object,
  compiled: object,
  opts: { events: object[] }
): ParityResult

/**
 * Assert fold/compile parity for a motive by reading events from journalDir.
 */
export declare function assertFoldCompileParity(slug: string, journalDir: string): ParityResult
