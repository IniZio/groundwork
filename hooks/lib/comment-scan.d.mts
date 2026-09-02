// Type declarations for comment-scan.mjs

/** Line classification kinds. */
export type LineKind = 'block-comment' | 'line-comment' | 'code' | 'blank'

/**
 * Classify each line of a source string into block-comment, line-comment,
 * code, or blank. No string-literal or regex-literal awareness — a `//` or
 * `/*` inside a string value may be miscounted (noted in the implementation).
 */
export declare function classifyLines(src: string): LineKind[]

/** Per-file comment metrics returned by fileMetrics(). */
export interface FileMetrics {
  /** Lines classified as block-comment or line-comment. */
  commentLines: number
  /** Lines classified as code. */
  codeLines: number
  /** commentLines / (commentLines + codeLines); 0 when both are 0. */
  ratio: number
  /** Line count of the largest contiguous block-comment region. */
  largestBlock: number
  /** 1-based line number where the largest block starts; 0 when none. */
  largestBlockStart: number
  /** largestBlock / (commentLines + codeLines); 0 when nonBlankLines is 0. */
  blockShare: number
}

/**
 * Compute per-file comment metrics from a source string.
 */
export declare function fileMetrics(src: string): FileMetrics
