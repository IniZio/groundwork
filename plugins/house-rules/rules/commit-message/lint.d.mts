export declare const PRESET_HANDBOOK: 'handbook'
export declare const PRESET_CONVENTIONAL: 'conventional'
export declare const PRESET_BODY_ONLY: 'body-only'
export declare const CONVENTIONAL_TYPES: string[]
export declare const SCOPE_PATTERN: RegExp

export type CommitPreset = 'handbook' | 'conventional' | 'body-only'

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
  repoRoot?: string | null
}

export declare function readConfigPreset(repoRoot: string | null | undefined): CommitPreset
export declare function lintCommitMessage(message: string, opts?: CommitLintOptions): CommitLintResult
