// Type declarations for doc-io.mjs

export interface DocClass {
  name: string
  budget: number
  match: (rel: string) => boolean
}

export interface Section {
  anchor: string
  heading: string
  level: number
  body: string
  startLine: number
}

export interface ClassifiedDoc {
  absPath: string
  relPath: string
  cls: { name: string; budget: number }
}

/**
 * Estimate token count for a string (rough heuristic).
 */
export declare function estimateTokens(content: string): number

/** Registered document class definitions. */
export declare const DOC_CLASSES: DocClass[]

/**
 * Classify an absolute path against the doc-class registry.
 * Returns `{ name, budget }` or null if unclassified.
 */
export declare function classifyDoc(absPath: string, rootDir: string): { name: string; budget: number } | null

/**
 * Convert a markdown heading text to a URL-style anchor slug.
 */
export declare function headingToAnchor(heading: string): string

/**
 * Parse a markdown file's sections into heading + body objects.
 */
export declare function parseSections(content: string): Section[]

/**
 * Extract the summary header block (content before the first ## heading).
 */
export declare function extractSummaryHeader(content: string): string

/**
 * Check whether content has a summary header and at least one section anchor.
 */
export declare function checkStructure(content: string): { hasSummaryHeader: boolean; hasSectionAnchor: boolean }

/**
 * Recursively collect all .md files under a directory (skips hidden directories).
 */
export declare function walkMdFiles(dir: string): string[]

/**
 * Discover and classify doc files under `rootDir`.
 * Returns `{ classified }` — an array of classified doc entries.
 */
export declare function findDocFiles(rootDir: string): { classified: ClassifiedDoc[] }

/**
 * Search doc files under `rootDir` for content matching `query`.
 * Returns an array of match result objects.
 */
export declare function searchDocs(rootDir: string, query: string): object[]
