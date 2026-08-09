// Type declarations for learnings-io.mjs

export interface LearningFrontmatter {
  concept: string
  slug: string
  recurrence: number
  status?: string
  promoted_to?: string
  [key: string]: unknown
}

export interface LearningEntry {
  frontmatter: LearningFrontmatter
  body: string
}

/**
 * Return the absolute path to the learning entry file for `conceptOrSlug`.
 */
export declare function resolveLearningPath(projectDir: string, conceptOrSlug: string): string

/**
 * Read a learning entry. Returns `{ frontmatter, body }` or null if missing/corrupt.
 */
export declare function readLearning(projectDir: string, conceptOrSlug: string): LearningEntry | null

/**
 * Create or update a learning entry. Returns the resulting frontmatter.
 */
export declare function upsertLearning(projectDir: string, opts: {
  concept: string
  session_id: string
  detail: string
  procedure?: string
  whyNaiveFails?: string
  invalidateWhen?: string
}): LearningFrontmatter

/**
 * List all learning entries in the project. Returns `{ slug, frontmatter }` objects.
 */
export declare function listLearnings(projectDir: string): Array<{ slug: string; frontmatter: LearningFrontmatter }>

/**
 * Mark a learning as PROMOTED and record the path it was promoted to.
 * Returns the updated frontmatter, or null if the entry does not exist.
 */
export declare function promoteLearning(
  projectDir: string,
  conceptOrSlug: string,
  promotedToPath: string
): LearningFrontmatter | null
