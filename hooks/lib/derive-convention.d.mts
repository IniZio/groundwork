// Type declarations for derive-convention.mjs

export declare const SAMPLE_SIZE: number
export declare const MIN_SAMPLE_SIZE: number
export declare const MIN_PASS_RATE: number

export type ConventionShape = 'type-scope' | 'scope-only'

export type RuleGroup = 'subjectShape' | 'subjectCap' | 'body'

export declare const RULE_GROUPS: RuleGroup[]

export interface ConventionRules {
  shape: ConventionShape
  types: string[] | null
  scopes: string[] | null
  bodyPermitted: boolean
  bodySectionDeclared: boolean
  templatePath: string | null
  breakingMarker?: boolean
  scopePattern?: RegExp
  subjectCap?: number
  bodyMaxLines?: number
  enforce?: RuleGroup[]
}

export interface ValidationReport {
  sampled: number
  passed: number
  passRate: number
  threshold: number
  enoughHistory: boolean
  ok: boolean
  failures: string[]
}

export interface DerivedConvention {
  confident: boolean
  rules: ConventionRules | null
  reason: string
  validation: ValidationReport | null
}

export interface SubjectVerdict {
  ok: boolean
  reason: string | null
}

export interface MessageViolation {
  line: number
  group: 'subject' | 'body'
  reason: string
}

export interface MessageVerdict {
  violations: MessageViolation[]
}

export interface PerGroupReport {
  sampled: number
  enoughHistory: boolean
  groups: Record<RuleGroup, ValidationReport>
}

export interface DeriveOptions {
  templatePath?: string
  templateText?: string
  subjects?: string[]
  sampleSize?: number
  minPassRate?: number
}

export declare function parseTemplate(text: string, templatePath?: string | null): ConventionRules | null
export declare function normalizeSubject(subject: string): string
export declare function checkSubject(subject: string, rules: ConventionRules): SubjectVerdict
export declare function describeShape(rules: ConventionRules): string
export declare function describeRules(rules: ConventionRules): string
export declare function checkMessage(message: string, rules: ConventionRules): MessageVerdict
export declare function validateRules(rules: ConventionRules, subjects: string[], minPassRate?: number): ValidationReport
export declare function validateRulesPerGroup(rules: ConventionRules, messages: string[], minPassRate?: number): PerGroupReport
export declare function readRecentSubjects(repoRoot: string, limit?: number): string[] | null
export declare function readRecentMessages(repoRoot: string, limit?: number): string[] | null
export declare function deriveConvention(repoRoot: string | null, opts?: DeriveOptions): DerivedConvention
