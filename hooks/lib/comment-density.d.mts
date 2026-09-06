// Type declarations for comment-density.mjs

/** Per-file cap: 5 comment lines per 100 total lines. */
export declare const FILE_CAP: number

/** Aggregate cap: 2 comment lines per 100 total lines. */
export declare const AGGREGATE_CAP: number

/** Language comment-syntax configuration. */
export interface LangConfig {
  /** Single-line comment prefix, e.g. '//' or '#'. */
  lineComment: string
  /** Block comment open marker, e.g. slash-star. */
  blockOpen?: string
  /** Block comment close marker, e.g. star-slash. */
  blockClose?: string
  /** Whether to recognise JSX-style block comments. */
  jsxBlock?: boolean
  /** Python-style triple-quote docstring blocks. */
  tripleQuote?: boolean
  /** Ruby-style `=begin` / `=end` blocks. */
  rubyBlock?: boolean
}

/** Language configuration table keyed by file extension (e.g. '.ts'). */
export declare const LANGUAGE_TABLE: Record<string, LangConfig>

/** Options accepted by isExcluded, analyzeFile, and analyzeFiles. */
export interface ExcludeOpts {
  /**
   * Raw text of a `.gitattributes` file. When provided, files whose path
   * matches a pattern with `linguist-generated=true` are excluded.
   */
  gitattributesText?: string
}

/** Per-file analysis result returned by analyzeFile(). */
export interface FileResult {
  /** File path as supplied. */
  path: string
  /** Total line count (including blank lines). */
  totalLines: number
  /** Number of comment lines. */
  commentLines: number
  /** commentLines / totalLines * 100; 0 when totalLines is 0. */
  commentsPer100: number
  /** 1-based line numbers of every comment line. */
  lines: number[]
  /** True when the file was excluded by D-8 rules or linguist-generated. */
  excluded: boolean
  /** Human-readable exclusion reason (present when excluded is true). */
  excludedReason?: string
  /** True when the result was served from the SHA-1 cache. */
  fromCache?: boolean
}

/** Result returned by analyzeFiles(). */
export interface FilesResult {
  /** Per-file results (one entry per input, including excluded files). */
  files: FileResult[]
  /**
   * Aggregate comment density across non-excluded files:
   * totalCommentLines / totalLines * 100; 0 when totalLines is 0.
   */
  aggregatePer100: number
}

/**
 * Returns true if the file at `filePath` should be excluded from analysis.
 * Checks D-8 exclusion patterns and, when opts.gitattributesText is provided,
 * the linguist-generated attribute.
 */
export declare function isExcluded(filePath: string, opts?: ExcludeOpts): boolean

/**
 * Analyze a single file. Returns immediately from SHA-1 cache if content
 * is unchanged from a prior call.
 */
export declare function analyzeFile(filePath: string, content: string, opts?: ExcludeOpts): FileResult

/**
 * Analyze multiple files and compute the aggregate comment density across
 * all non-excluded files.
 */
export declare function analyzeFiles(
  entries: Array<{ path: string; content: string }>,
  opts?: ExcludeOpts,
): FilesResult
