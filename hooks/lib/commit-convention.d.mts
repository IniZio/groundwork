// Type declarations for commit-convention.mjs

import type { ConventionRules, PerGroupReport, ValidationReport } from './derive-convention.d.mts'

export declare const GROUNDWORK_RULES: ConventionRules

export declare const UNIVERSAL_RULES: ConventionRules
export declare const UNIVERSAL_RULE_STATEMENTS: string[]

export interface CommitTemplate {
  path: string
  text: string | null
  note?: string
}

export declare function readCommitTemplate(repoRoot: string | null | undefined): CommitTemplate | null

export interface ActiveConvention {
  repoRoot: string | null
  scope: 'groundwork-own-repo' | 'host-repo'
  source: string
  projectTemplate: { path: string | null; text: string | null; note?: string }
  universalRules: string[]
  bodyPermitted: boolean
  enforcedGroups: string[]
  reason: string
}

export declare function activeConvention(repoRoot: string | null | undefined): ActiveConvention

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

export declare function resolveRepoRoot(cwd?: string): string | null

export declare function hasOwnCommitTemplate(repoRoot: string | null | undefined): boolean

export declare function isGroundworkOwnRepo(repoRoot: string | null | undefined): boolean

export interface HostRules {
  applies: boolean
  rules: ConventionRules | null
  reason: string
  validation?: ValidationReport
  perGroup?: PerGroupReport
  template?: CommitTemplate | null
}

export declare function stripAttribution(text: string): string

export declare function resolveHostRules(repoRoot: string | null | undefined): HostRules

export declare function clearHostRulesCache(): void

export declare function getMotiveSlugs(repoRoot?: string): string[]

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
  opts?: { motiveSlugs?: string[]; repoRoot?: string | null },
): LintResult
