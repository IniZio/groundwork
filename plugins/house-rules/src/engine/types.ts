import type { Language } from '../hooks/languages/registry.js';
import type { SourceFileResult } from './source-file.js';
import type { ParserFactory } from '../hooks/languages/parse.js';

export type Severity = 'off' | 'warn' | 'error';

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
  lang?: Language;
  addedHunks?: DiffHunk[];
  tracked?: boolean;
  sessionCreated?: boolean;
}

export interface RuleContext {
  repoRoot: string;
  mode: 'guard' | 'gate' | 'cli';
  files?: ScopedFile[];
  /**
   * Resolves null when the file has no registered language or no text;
   * parses at most once per (language, text) per context.
   * Optional so hand-built contexts in rule-tester/tests keep compiling.
   */
  sourceFile?(file: ScopedFile): Promise<SourceFileResult | null>;
}

export interface FixFileResult {
  path: string;
  status: 'fixed' | 'declined';
  /** Why the file was declined; the gate prints it after the finding message in its block text. */
  reason?: string;
  before?: string;
  after?: string;
  /** Rollout stage of this file's fix: 'preview' fixes are computed but not written. */
  stability?: 'stable' | 'preview';
  applicability?: 'safe' | 'unsafe';
  /** Counts for the caller's success message; set on 'fixed'. */
  removed?: number;
  kept?: number;
  total?: number;
  addedLines?: number;
  /** One line the gate adds to its block notices for this file. */
  notice?: string;
}

/** Who calls fix, so the rule can write its own ledger and shadow logs. */
export interface FixCaller {
  source: 'gate' | 'housekeep';
  sessionId?: string;
  event?: 'Stop' | 'SubagentStop';
  /** Autofix-ledger dir; undefined = the ledger's default. */
  ledgerDir?: string;
  /** Base dir for preview shadow logs; undefined = os.tmpdir(). */
  shadowDir?: string;
}

export interface FixOptions {
  /** false = compute but write no file and no ledger entry. */
  write?: boolean;
  /** Absent = housekeep. */
  caller?: FixCaller;
  /** Opaque test hooks the caller forwards unchanged; only the rule reads them. */
  testOnly?: Record<string, unknown>;
}
export interface FixResult { fixed: number; skipped: number; files: FixFileResult[] }

/** Replace input[start, end) with `text`. Offsets are UTF-16 indexes into PendingEdit.post. */
export interface RangeEdit { start: number; end: number; text: string }

export interface SessionBaseInfo {
  /** Session-base commit sha from sessionBase(transcriptPath, repo). */
  commit: string;
  /** 1-based rows added between the base commit and the pre-edit file (addedRanges), or null. */
  addedRows: number[] | null;
  /** File text at the base commit; null when the file is absent there. */
  baseText: string | null;
  /** diffTextToHunks(baseText, pre); null when baseText is null. */
  preHunks: DiffHunk[] | null;
  /** diffTextToHunks(baseText, post) for THIS rule's post; null when baseText is null. */
  postHunks: DiffHunk[] | null;
}

export interface PendingEdit {
  /** tool_input.file_path, as sent (absolute). */
  path: string;
  tool: 'write' | 'edit' | 'multiedit';
  /** languageForPath(path, firstLine-of-Write-content); null when unregistered. */
  lang: Language | null;
  /** File text before the edit; null when the file does not exist. */
  pre: string | null;
  /** Post-edit text, including every earlier rule's accepted rewrite. */
  post: string;
  /** 0-based rows of the ORIGINAL post-edit text that the tool input changed. */
  changedRows: Set<number>;
  /** Non-null iff the payload has transcript_path and pre !== null. */
  session: SessionBaseInfo | null;
  /** `git -C (cwd ?? dirname(path)) rev-parse --show-toplevel`; null outside git. */
  repoRoot: string | null;
  cwd: string | null;
}

export interface EditCheckEnv {
  /** Parses `post` for `lang` on first call (shared per text); resolves null when lang is null. Lazy so rules that don't read it cost no parse. */
  sourceFile(): Promise<SourceFileResult | null>;
  /** The parser factory the guard was given (tests inject failing/mock parsers). */
  parserFactory: ParserFactory;
  /** Autofix-ledger dir override (tests); undefined = default location. */
  ledgerDir?: string;
}

export interface EditCheckResult {
  /** Policy severity applies: an 'error' finding makes the guard deny with its message. */
  findings: Finding[];
  /** Rewrite of `post`. Must be non-overlapping. comment-density emits one whole-file range. */
  edits?: RangeEdit[];
  /** additionalContext text contributed when this rule's edits are applied (or when it has no edits). */
  notice?: string;
  /** additionalContext text used INSTEAD of `notice` when the guard refuses or cannot map this rule's edits. */
  refusedNotice?: string;
  /** One stderr line (no trailing newline). */
  stderr?: string;
}

export interface Rule {
  id: string;
  meta: { description: string };
  /** Languages whose source files this rule reads. Absent/empty = reads no source; excluded from the coverage report. */
  languages?: readonly Language[];
  check(ctx: RuleContext): Finding[] | Promise<Finding[]>;
  fix?(ctx: RuleContext, opts?: FixOptions): Promise<FixResult>;
  canFixPath?(path: string): boolean;
  /** Edit-time check run by the edit guard, in rule-id order. */
  editCheck?(edit: PendingEdit, env: EditCheckEnv): EditCheckResult | Promise<EditCheckResult>;
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
