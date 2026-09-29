export declare const PRESET_HANDBOOK: 'handbook'
export declare const PRESET_CONVENTIONAL: 'conventional'
export declare const PRESET_SUBJECT_ONLY: 'subject-only'
export declare const CONVENTIONAL_TYPES: string[]
export declare const SCOPE_PATTERN: RegExp

export type CommitPreset = 'handbook' | 'conventional' | 'subject-only'

export interface CommitViolation {
  line: number
  group: 'subject' | 'body'
  reason: string
}

export interface CommitLintResult {
  violations: CommitViolation[]
  preset: CommitPreset
}

export interface CommitLintOptions {
  preset?: CommitPreset
}

export declare function lintCommitMessage(message: string, opts?: CommitLintOptions): CommitLintResult
