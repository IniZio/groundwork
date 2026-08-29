// Type declarations for spec-io.mjs

/** Allowed frontmatter fields for all spec files. */
export declare const ALLOWED_FRONTMATTER_FIELDS: Set<string>

/** Blessed core view types for spec views[].type. */
export declare const CORE_VIEW_TYPES: Set<string>

/** Regex source string matching requirement and concept IDs. */
export declare const ID_RE_SRC: string

export interface Section {
  anchor: string
  heading: string
  level: number
  body: string
  startLine: number
}

export interface RequirementDoc {
  id: string
  [key: string]: unknown
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns `{ data, body }`.
 */
export declare function parseYamlFrontmatter(content: string): { data: Record<string, unknown>; body: string }

/**
 * Walk up from `startDir` to find the nearest directory containing package.json or .git.
 */
export declare function findProjectRoot(startDir: string): string

/** Return the absolute path to the spec directory. */
export declare function specDirPath(projectRoot: string): string

/** Return the absolute path to the generated output directory under the spec dir. */
export declare function generatedDirPath(sd: string): string

/** Return the absolute path to the index.json file. */
export declare function indexJsonPath(sd: string): string

/**
 * Returns true when `relPath` names a requirements document
 * (constraints.md or requirements.md at any depth).
 */
export declare function isRequirementsDoc(relPath: string): boolean

/**
 * Recursively yield all spec files under `sd`.
 */
export declare function walkSpecFiles(sd: string): Iterable<string>

/**
 * Returns true when the generated index.json is stale relative to spec source files.
 */
export declare function isIndexStale(sd: string): boolean

/**
 * Return the first sentence of a text string.
 */
export declare function firstSentence(text: string): string

/**
 * Returns true when `text` contains a normative verb (MUST, SHALL, etc.).
 */
export declare function hasNormativeVerb(text: string): boolean

/**
 * Extract requirement/concept ID references from `content`, excluding `selfId`.
 */
export declare function extractRefs(content: string, selfId?: string): string[]

/**
 * Returns true when `text` looks like a path-like token.
 */
export declare function pathLikeToken(text: string): boolean

/**
 * Parse a requirements document markdown into structured requirement objects.
 */
export declare function parseRequirementsDocument(markdown: string): object[]

/**
 * Find the nearest concept ID for a requirements file path.
 */
export declare function findNearestConceptId(reqAbsPath: string, sd: string): string | null

/**
 * Resolve an Obsidian wikilink concept reference (e.g. [[artifact/index]]) to a
 * plain concept id by reading the referenced index.md under `sd`.
 * Plain ids are returned unchanged.
 */
export declare function resolveConceptRef(rawConcept: string, sd: string): string

/**
 * Find the concept directory for a concept ID under `sd`.
 */
export declare function findConceptDir(conceptId: string, sd: string): string | null

/**
 * Load the spec manifest (concept README frontmatter) from a concept directory.
 */
export declare function loadSpecManifest(conceptDir: string): Promise<object>

/**
 * Build the full index data object from all spec files under `sd`.
 */
export declare function buildIndexData(sd: string): object

/**
 * Convert a heading string to a GitHub-style anchor slug.
 */
export declare function githubSlug(text: string): string

/**
 * Extract all heading anchors from a markdown string.
 */
export declare function extractAllHeadingAnchors(markdown: string): string[]

/**
 * Load the generated index.json from disk.
 */
export declare function loadIndex(sd: string): object

/**
 * Generate a random short suffix that doesn't collide with existing IDs.
 */
export declare function randomSuffix(existingIds: string[]): string
