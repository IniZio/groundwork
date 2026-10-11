import type { Scope } from './scope.js';
import { EMPTY_TREE } from './scope.js';
import type { Coverage } from '../engine/run.js';
import { EMPTY_COVERAGE } from '../engine/run.js';

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
  coverage: Coverage;
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
  parts: { findings?: ReportFinding[]; fixed?: ReportFinding[]; manual?: ManualEntry[]; coverage?: Coverage },
): Report {
  const findings = parts.findings ?? [];
  const fixed = parts.fixed ?? [];
  const manual = parts.manual ?? [];
  const coverage = parts.coverage ?? EMPTY_COVERAGE;
  return {
    scope: { base: displayBase(scope), mode: scope.mode, files: scope.files.length },
    findings,
    fixed,
    manual,
    summary: { fixed: fixed.length, manual: manual.length, findings: findings.length },
    coverage,
  };
}

/** Serialise a Report exactly as `--format json` emits it (no trailing newline). */
export function serializeReport(report: Report): string {
  return JSON.stringify(report);
}

/** Write exactly one JSON line to stdout. */
export function writeJsonReport(report: Report): void {
  process.stdout.write(serializeReport(report) + '\n');
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function ranked(m: Map<string, number>): Array<[string, number]> {
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function normaliseHint(prose: string): string {
  return prose.replace(/`[^`]*`/g, '`<name>`').replace(/"[^"\n]*"|'[^'\n]*'/g, '<name>');
}

/** Compact findings summary: counts per rule/check, top 10 files, each hint once per check. */
export function formatSummary(report: Report, fullReportPath: string): string {
  const rules = new Map<string, number>();
  const checks = new Map<string, number>();
  const files = new Map<string, number>();
  const hints = new Map<string, Map<string, number>>();
  for (const f of report.findings) {
    const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(f.message);
    const check = m ? m[1] : '(none)';
    const prose = m ? m[2] : f.message;
    bump(rules, f.ruleId);
    bump(checks, check);
    bump(files, f.path);
    if (!hints.has(check)) hints.set(check, new Map());
    bump(hints.get(check)!, normaliseHint(prose));
  }
  const out: string[] = [];
  for (const [k, n] of ranked(rules)) out.push(`rule ${k}: ${n}`);
  for (const [k, n] of ranked(checks)) {
    out.push(`check ${k}: ${n}`);
    out.push(`  hint: ${ranked(hints.get(k)!)[0][0]}`);
  }
  for (const [k, n] of ranked(files).slice(0, 10)) out.push(`file ${k}: ${n}`);
  out.push(`total: ${report.findings.length}`);
  out.push(`full report: ${fullReportPath}`);
  return out.join('\n');
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

/** Exit code 1 iff any remaining finding has severity 'error' or coverage has failed grammars. */
export function exitCodeFor(remaining: Array<{ severity: string }>, coverage?: Coverage): 0 | 1 {
  return remaining.some(r => r.severity === 'error') || (coverage != null && coverage.failed.length > 0) ? 1 : 0;
}
