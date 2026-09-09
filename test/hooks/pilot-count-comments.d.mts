// Type declarations for pilot-count-comments.mjs

/** Line counts produced by the vendored pilot counter. */
export interface PilotCounts {
  /** Total lines in the supplied content, including blanks. */
  total: number
  /** Lines the pilot rules classify as comments. */
  comments: number
}

/** Count comment lines in `content` using the vendored pilot rules. */
export declare function countComments(content: string): PilotCounts
