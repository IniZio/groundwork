/**
 * dag-utils.d.mts — TypeScript declarations for dag-utils.mjs
 *
 * Required so TypeScript files that import this module do not emit
 * TS7016 ("Could not find a declaration file") errors.
 *
 * All exported functions are pure and side-effect-free. See dag-utils.mjs
 * for full behavioural documentation and edge-case policies.
 */

/**
 * Minimal slice shape required by the DAG utility functions.
 *
 * Fields are intentionally optional so that callers can pass richer slice
 * objects (e.g. ones with `desc`, `ticket`, `decisions`, …) without casting.
 */
export interface DagSlice {
  /** Unique slice identifier. */
  id: string
  /**
   * Ids of slices this slice depends on. When absent or empty, the slice has
   * no blockers and appears in Layer 0 of topoLayers().
   */
  blocked_by?: string[]
  /**
   * Lifecycle status. Recognised values: 'pending' | 'in_progress' |
   * 'complete' | 'skipped'. Absent status is treated as 'pending'.
   */
  status?: string
  /**
   * Explicit wave assignment from the ledger. topoLayers() computes
   * topological depth independently and does NOT require this field.
   */
  wave?: number | null
  /**
   * Slice kind. frontier() excludes slices with kind === 'fog' to match
   * cmdFrontier behaviour (fog slices are open questions, not actionable work).
   */
  kind?: string
  /**
   * Session that claimed this slice. Pure functions here do NOT use this
   * field — session-specific filtering belongs to the CLI layer.
   */
  claimed_by?: string
  /** Allow richer slice objects without requiring a cast. */
  [key: string]: unknown
}

/**
 * Group slices into topological generations (Kahn's algorithm).
 *
 * Layer 0 contains slices with no in-graph blockers. Each successive layer
 * contains slices whose every in-graph blocker is in a previous layer.
 *
 * **Dangling edges** (blocked_by id absent from slices) are IGNORED —
 * the slice's in-degree is not incremented for a non-existent blocker.
 *
 * Slices involved in a cycle are not assigned to any layer. Use hasCycle()
 * to detect this case.
 *
 * @param slices  Input slices; order is not significant.
 * @returns       Ordered array of layers; each layer is an array of slice ids.
 */
export declare function topoLayers(slices: DagSlice[]): string[][]

/**
 * Return pending slices whose every blocked_by entry has status 'complete'.
 *
 * Matches cmdFrontier semantics in hooks/ledger.mjs, minus the session-specific
 * claimed_by filter:
 *   - Only slices with status exactly 'pending' (default when absent).
 *   - Slices with kind === 'fog' are excluded.
 *   - A blocker with status 'skipped' does NOT count as satisfied.
 *   - **Dangling blockers** (id not present in slices) count as UNSATISFIED —
 *     a slice referencing a non-existent blocker will never appear in the result.
 *
 * @param slices  Input slices.
 * @returns       Slices that can start now.
 */
export declare function frontier<T extends DagSlice>(slices: T[]): T[]

/**
 * Return the full transitive closure of what blocks a given slice.
 *
 * Follows blocked_by edges recursively. Terminates on cycles via a
 * visited-set guard.
 *
 * **Dangling ids** (not present in slices) ARE included in the result — the
 * function reports all referenced blocker ids regardless of whether they appear
 * as nodes in the input.
 *
 * @param slices  Input slices.
 * @param id      The slice id to start from.
 * @returns       All blocker ids reachable from id (excluding id itself).
 */
export declare function transitiveBlockers(slices: DagSlice[], id: string): string[]

/**
 * Detect whether the dependency graph contains a cycle.
 *
 * Uses Kahn's algorithm: after processing, any node with remaining positive
 * in-degree is part of a cycle. Returns false for empty input and single nodes.
 *
 * **Dangling edges** are IGNORED (consistent with topoLayers).
 *
 * @param slices  Input slices.
 * @returns       true if a cycle is present; false otherwise.
 */
export declare function hasCycle(slices: DagSlice[]): boolean
