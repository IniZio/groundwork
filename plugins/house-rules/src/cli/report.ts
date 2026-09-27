import type { Scope } from './scope.js';
import { EMPTY_TREE } from './scope.js';

export type OutputFormat = 'text' | 'json';

export interface ReportFinding {
  ruleId: string;
  path: string;
  line: number | null;
  severity: string;
  message: string;
}

export interface ManualEntry extends ReportFinding {
  reason: string;
}

export interface Report {
  scope: { base: string; mode: 'diff' | 'all'; files: number };
  findings: ReportFinding[];
  fixed: ReportFinding[];
  manual: ManualEntry[];
  summary: { fixed: number; manual: number; findings: number };
  coverage: { notChecked: string[] };
}

/** Returns 'all' when scope is all-mode against the empty tree, else the commit ref. */
export function displayBase(scope: Scope): string {
  return scope.mode === 'all' && scope.base === EMPTY_TREE ? 'all' : scope.base;
}

/** One-line scope header for stderr (no trailing newline). */
export function scopeHeader(scope: Scope): string {
  return `house-rules: base=${displayBase(scope)} files=${scope.files.length}`;
}

/** Write scope header to stderr. */
export function writeScopeHeader(scope: Scope): void {
  process.stderr.write(scopeHeader(scope) + '\n');
}

/** Normalise a raw finding shape into a ReportFinding, dropping extra keys. */
export function toReportFinding(f: {
  ruleId: string;
  path: string;
  line?: number | null;
  message: string;
  severity?: string;
}): ReportFinding {
  return {
    ruleId: f.ruleId,
    path: f.path,
    line: f.line ?? null,
    severity: f.severity ?? 'warn',
    message: f.message,
  };
}

/** Assemble a Report; missing arrays default to []; scope.base shows display form. */
export function buildReport(
  scope: Scope,
  parts: { findings?: ReportFinding[]; fixed?: ReportFinding[]; manual?: ManualEntry[]; notChecked?: string[] },
): Report {
  const findings = parts.findings ?? [];
  const fixed = parts.fixed ?? [];
  const manual = parts.manual ?? [];
  const notChecked = parts.notChecked ?? [];
  return {
    scope: { base: displayBase(scope), mode: scope.mode, files: scope.files.length },
    findings,
    fixed,
    manual,
    summary: { fixed: fixed.length, manual: manual.length, findings: findings.length },
    coverage: { notChecked },
  };
}

/** Returns `not checked: <path>` per path; empty array when paths is empty. */
export function formatNotCheckedLines(paths: string[]): string[] {
  return paths.map(p => `not checked: ${p}`);
}

/** Write exactly one JSON line to stdout. */
export function writeJsonReport(report: Report): void {
  process.stdout.write(JSON.stringify(report) + '\n');
}

/** Format a single finding as an eslint-style line. */
export function formatFindingLine(f: {
  path: string;
  line?: number | null;
  ruleId: string;
  message: string;
}): string {
  return f.line != null
    ? `${f.path}:${f.line} ${f.ruleId} ${f.message}`
    : `${f.path} ${f.ruleId} ${f.message}`;
}

/** Exit code 1 iff any remaining finding has severity 'error'. */
export function exitCodeFor(remaining: Array<{ severity: string }>): 0 | 1 {
  return remaining.some(r => r.severity === 'error') ? 1 : 0;
}
