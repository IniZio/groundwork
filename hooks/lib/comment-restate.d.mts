// Type declarations for comment-restate.mjs

export declare function splitIdentifier(name: string): string[]

export declare const STOP_WORDS: Set<string>

export declare const DECL_RE: RegExp
export declare const IDENT_COMMENT_RE: RegExp
export declare const IMPERATIVE_COMMENT_RE: RegExp
export declare const CODE_LINE_RE: RegExp
export declare const COMMENT_WORD_RE: RegExp

/**
 * Single-identifier form: a `// name` comment immediately above its declaration.
 */
export declare function findRestatingComments(lines: string[]): Array<{ line: number; name: string }>

/**
 * Multi-word form: a prose comment whose content words (after stop-word removal)
 * are ALL present in the camelCase/snake_case tokens of the identifier declared below.
 */
export declare function findMultiWordRestatingComments(lines: string[]): Array<{ line: number; comment: string; identName: string }>

/**
 * Prose-paraphrase form: a short imperative comment whose content words all appear
 * in the code line immediately below.
 */
export declare function findProseParaphraseComments(lines: string[]): Array<{ line: number; comment: string; codeLine: string }>

/** Result item from findAllRestatingComments(). */
export interface RestatingResult {
  /** 0-based line index of the comment. */
  line: number
  /** Comment text including the `//` prefix. */
  comment: string
  /** The code line below (trimmed). */
  code: string
  /** Human-readable reason. */
  reason: string
}

export interface FindAllOptions {
  /**
   * Fraction of content words (after stop-word removal) that must appear as
   * identifier tokens for a multi-word restating comment to fire.
   * @default 0.6
   */
  overlapShare?: number
}

/**
 * Public API: find all restating comments in a source string.
 */
export declare function findAllRestatingComments(source: string, opts?: FindAllOptions): RestatingResult[]
