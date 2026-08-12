// Type declarations for traceability-serve.mjs

import type { Server } from 'node:http'

/** Classified traceability graph (output of classifyTraceabilityGraph + slug). */
export interface ClassifiedGraph {
  nodes: object[]
  edges: object[]
  artifactEvidence?: object[]
  slug?: string
}

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
 *   GET /       → self-contained interactive HTML
 *   GET /graph  → classified graph JSON
 *
 * @param classifiedGraph - The classified graph to serve
 * @param port - Port to bind (0 = OS-assigned ephemeral port)
 */
export declare function startServer(
  classifiedGraph: ClassifiedGraph,
  port?: number,
): Promise<{ server: Server; port: number; url: string }>
