export type Severity = 'off' | 'warn' | 'error';
export type Vehicle = 'tree-sitter' | 'diff' | 'tree';

export interface Finding {
  ruleId: string;
  path: string;
  line?: number;
  message: string;
  fingerprintBasis: string;
}

/** Structural twin of DiffHunk in src/hooks/lib/work-scope.ts — kept local to avoid cross-plugin imports. */
export interface DiffHunk {
  /** New-file 1-based line numbers of added lines in this hunk */
  added: number[];
  /** Texts of removed lines (parallel to removedBaseLineNos) */
  removed: string[];
  /** Base-file 1-based line numbers of the removed lines */
  removedBaseLineNos: number[];
}

export interface ScopedFile {
  path: string;
  text?: string;
  /** Base-commit text used by comment-density to pair against the session base */
  baseText?: string;
  lang?: string;
  addedHunks?: DiffHunk[];
  tracked?: boolean;
  sessionCreated?: boolean;
}

export interface RuleContext {
  repoRoot: string;
  mode: 'guard' | 'gate' | 'cli';
  files?: ScopedFile[];
}

export interface FixResult {
  fixed: number;
  skipped: number;
}

export interface Rule {
  id: string;
  meta: { description: string };
  vehicles: Vehicle[];
  check(ctx: RuleContext): Finding[] | Promise<Finding[]>;
  fix?(ctx: RuleContext): Promise<FixResult>;
}

export interface Case {
  why: string;
  code?: string;
  filename?: string;
  tree?: Record<string, string>;
  /** Base text for a code case; when present, addedHunks = diffTextToHunks(base, code) */
  base?: string;
}

export interface RuleCases {
  valid: Case[];
  invalid: (Case & { findings: Partial<Finding>[] })[];
}
