/**
 * motive-dag.d.mts — TypeScript declarations for motive-dag.mjs
 *
 * Required so TypeScript files that import this module do not emit
 * TS7016 ("Could not find a declaration file") errors.
 */

// Re-export the fold engine and projector for consumer convenience.
export {
  assembleGraphFold,
  FoldGraph,
  FoldNode,
  FoldEdge,
  FoldAttrs,
  FoldOptions,
} from './motive-graph-fold.mjs'
export {
  projectFoldGraph,
  FoldProjection,
  NON_RECONSTRUCTIBLE_FIELDS,
} from './motive-graph-project.mjs'

import type { FoldGraph, FoldNode } from './motive-graph-fold.mjs'

/**
 * Read all decision nodes from a fold graph, newest-first, deduplicated with
 * supersession and janitorial-retraction rules ported from motive-map.mjs.
 *
 * @param fold   Output of assembleGraphFold().
 * @param events Optional — accepted for future extensibility; not used currently.
 * @returns      Decision fold nodes, newest-first, after dedup/supersession.
 */
export declare function readOrderedDecisionsFromFold(
  fold: FoldGraph,
  events?: object[]
): FoldNode[]

/**
 * Partition a list of node ref-ids into those present in the fold and those missing.
 *
 * @param fold     Output of assembleGraphFold().
 * @param refIds   Ids to validate (e.g. 'decision:D-1', 'ac:AC1').
 * @param nodeType Node type to match; 'ac' is accepted as shorthand for 'acceptance-criterion'.
 * @returns        { valid, missing } partitioning of refIds.
 */
export declare function validateFoldRefs(
  fold: FoldGraph,
  refIds: string[],
  nodeType: 'decision' | 'acceptance-criterion' | 'ac' | 'baseline' | 'slice' | string
): { valid: string[]; missing: string[] }

/**
 * Extract AC coverage from a fold graph.
 *
 * Returns a Map keyed by fold node id ('ac:<label>') → { ac, covering? }.
 *
 * @param fold  Output of assembleGraphFold().
 * @returns     Map of AC node id → { ac, covering? }.
 */
export declare function extractACCoverageFromFold(
  fold: FoldGraph
): Map<string, { ac: unknown; covering?: unknown }>
