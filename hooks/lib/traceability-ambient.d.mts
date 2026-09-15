// Type declarations for traceability-ambient.mjs

/** A classified traceability graph (output of classifyTraceabilityGraph). */
export interface ClassifiedGraph {
  nodes: object[]
  edges: Array<{ source: string; target: string; kind: string; classification: 'proven' | 'unproven' | 'stale' | 'missing' }>
  artifactEvidence?: object[]
}

/**
 * Render a self-contained HTML string from a classified traceability graph.
 * Pure function — no I/O.
 *
 * @param classifiedGraph - Graph returned by classifyTraceabilityGraph().
 * @param slug            - Motive slug, used only for the page title.
 * @returns Self-contained HTML (no external URLs).
 */
export declare function renderTraceHtml(classifiedGraph: ClassifiedGraph, slug?: string): string

