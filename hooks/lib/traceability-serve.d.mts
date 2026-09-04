// Type declarations for traceability-serve.mjs

import type { Server } from 'node:http'
import type { DagSlice } from './lib/dag-utils.mjs'

/** Classified traceability graph (output of classifyTraceabilityGraph + slug). */
export interface ClassifiedGraph {
  nodes: object[]
  edges: object[]
  artifactEvidence?: object[]
  slug?: string
}

/** Result of computeWaveBands — the authoritative wave-band assignment. */
export interface WaveBandResult {
  /** Slice id → wave band number (explicit ledger wave, or topo depth fallback; null for cycle members). */
  waveBySliceId: Map<string, number | null>
  /** Set of slice ids that are on the ready frontier (pending, all blockers complete). */
  frontierIds: Set<string>
  /** Slice id → full set of transitive blocker ids. */
  blockersBySliceId: Map<string, string[]>
}

/**
 * Compute wave-band assignments, frontier set, and transitive blocker maps
 * for a set of slices. Delegates entirely to dag-utils — never reimplements.
 * Both the JSON surface and the HTML surface call this function, guaranteeing
 * they always agree on these computed values.
 */
export declare function computeWaveBands(slices: DagSlice[]): WaveBandResult

/**
 * Build and classify the traceability graph for a motive from disk.
 * Loads the NativeSpineAdapter, runs the full pipeline, and returns
 * a classified graph enriched with the slug field.
 */
export declare function buildClassifiedGraph(
  slug: string,
  projectDir: string,
): ClassifiedGraph

/**
 * Generate the self-contained interactive HTML page for a classified graph.
 * No external URLs — all CSS and JS are inlined.
 */
export declare function buildHtml(graph: ClassifiedGraph): string

/**
 * Start the local HTTP server.
 *
 * Endpoints:
 *   GET /        → self-contained interactive HTML
 *   GET /graph   → classified graph JSON
 *   POST /rejudge → S7: on-demand single-link re-judge
 *
 * @param classifiedGraph - The classified graph to serve
 * @param port - Port to bind (0 = OS-assigned ephemeral port)
 * @param opts - Optional slug and projectDir needed to support POST /rejudge
 */
export declare function startServer(
  classifiedGraph: ClassifiedGraph,
  port?: number,
  opts?: { slug?: string; projectDir?: string },
): Promise<{ server: Server; port: number; url: string }>

/**
 * Append a scoped GATE verdict event for a single link (S7, D-8, AC-5).
 *
 * MUST NOT be called by buildClassifiedGraph or any regen-hot-path function.
 *
 * @param linkId     - D-8 link identifier (typically a slice ID)
 * @param verdict    - 'APPROVE' | 'CORRECTION' | 'REPLAN' | 'STOP'
 * @param which      - Gate name stored as GATE.which (e.g. 'manual-rejudge')
 * @param projectDir - Absolute project root
 * @param slug       - Motive slug
 */
export declare function rejudgeLink(
  linkId: string,
  verdict: string,
  which: string,
  projectDir: string,
  slug: string,
): void
