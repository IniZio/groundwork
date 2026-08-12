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

/**
 * Regenerate TRACE.html for a given motive.
 *
 * Silent no-op when the motive directory doesn't exist.
 * Warns to stderr on any error — never throws, never changes the caller's exit code.
 *
 * @param projectDir - Absolute path, same as CLAUDE_PROJECT_DIR.
 * @param slug       - Motive slug (e.g. "tracking-viz").
 */
export declare function regenerateMotiveTraceHtml(projectDir: string, slug: string): void
