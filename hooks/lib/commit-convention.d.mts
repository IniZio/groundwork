// Type declarations for commit-convention.mjs

export declare const COMMIT_TYPES: string[]
export declare const SCOPE_PATTERN: RegExp
export declare const SUBJECT_CAP: number
export declare const BODY_MAX_LINES: number
export declare const ATTRIBUTION_TRAILER_PATTERNS: RegExp[]

export interface ProcessVocabEntry {
  pattern: RegExp
  label: string
}
export declare const PROCESS_VOCAB_DENYLIST: ProcessVocabEntry[]

export declare function getMotiveSlugs(): string[]

export interface LintViolation {
  line: number
  reason: string
}

export interface LintResult {
  stripped: string
  violations: LintViolation[]
}

export declare function lintMessage(
  text: string,
  opts?: { motiveSlugs?: string[] },
): LintResult
