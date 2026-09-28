import path from 'node:path';
import type { Rule, Finding, RuleContext, Severity, ScopedFile } from './types.js';
import type { Language } from '../hooks/languages/registry.js';
import { languageForPath } from '../hooks/languages/registry.js';
import { BUILTIN_POLICY, DEFAULT_IGNORE, type PolicyEntry } from './policy.js';

const SOURCE_CODE_EXTENSIONS = new Set([
  ".kt", ".kts", ".java", ".scala", ".groovy",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh",
  ".m", ".mm", ".cs", ".fs", ".swift",
  ".rb", ".php", ".pl", ".pm", ".lua", ".r",
  ".dart", ".ex", ".exs", ".erl", ".hs", ".ml",
  ".clj", ".elm", ".vue", ".svelte",
  ".js", ".jsx", ".mjs", ".cjs",
  ".zig", ".nim", ".jl", ".ps1", ".bat",
]);

const SOURCE_CODE_BASENAMES = new Set([
  "Gemfile", "Rakefile", "CMakeLists.txt",
]);

function isSourceCodeFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (SOURCE_CODE_BASENAMES.has(base)) return true;
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_CODE_EXTENSIONS.has(ext);
}

export interface FindingWithSeverity extends Finding {
  severity: Severity;
}

function isIgnored(filePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => new Bun.Glob(pattern).match(filePath));
}

/**
 * Run all rules against the context.
 * Drops findings where the policy severity is 'off'.
 * Drops findings whose path matches any ignore glob (repo-relative, forward slashes).
 * Annotates each kept finding with its resolved severity.
 */
export async function runRules(
  rules: Rule[],
  ctx: RuleContext,
  policy: Record<string, PolicyEntry> = BUILTIN_POLICY,
  ignore: string[] = DEFAULT_IGNORE,
): Promise<FindingWithSeverity[]> {
  const results: FindingWithSeverity[] = [];

  for (const rule of rules) {
    const severity: Severity = policy[rule.id]?.severity ?? 'warn';
    if (severity === 'off') {
      continue;
    }

    const hasLanguages = rule.languages && rule.languages.length > 0;
    const ruleCtx: RuleContext = hasLanguages ? ctx : { ...ctx, sourceFile: undefined };
    const findings: Finding[] = await rule.check(ruleCtx);

    for (const finding of findings) {
      if (isIgnored(finding.path, ignore)) {
        continue;
      }
      results.push({ ...finding, severity });
    }
  }

  return results;
}

/**
 * Returns true iff any finding has severity 'error'
 */
export function isBlocking(findings: FindingWithSeverity[]): boolean {
  return findings.some((f) => f.severity === 'error');
}

export interface PartialEntry { path: string; rows: number[] }
export interface FailedEntry  { path: string; language: Language; reason: string }
export interface Coverage { notChecked: string[]; partiallyChecked: PartialEntry[]; failed: FailedEntry[] }
export const EMPTY_COVERAGE: Coverage = { notChecked: [], partiallyChecked: [], failed: [] };

export async function coverageReport(rules: Rule[], ctx: RuleContext): Promise<Coverage> {
  const notChecked = notCheckedFiles(rules, ctx.files ?? []);

  const covered = new Set<string>();
  for (const rule of rules) {
    if (rule.languages) {
      for (const lang of rule.languages) {
        covered.add(lang);
      }
    }
  }

  const partiallyChecked: PartialEntry[] = [];
  const failed: FailedEntry[] = [];
  const seenPaths = new Set<string>();

  for (const file of ctx.files ?? []) {
    if (file.text === undefined) continue;
    if (seenPaths.has(file.path)) continue;
    seenPaths.add(file.path);
    const lang = file.lang ?? languageForPath(file.path) ?? undefined;
    if (lang === undefined || !covered.has(lang)) continue;

    const fileForSource = file.lang === undefined ? { ...file, lang } : file;
    const r = await ctx.sourceFile?.(fileForSource);
    if (r == null) continue;

    if (!r.ok) {
      failed.push({ path: file.path, language: lang, reason: r.reason });
    } else if (r.source.errorRows.size > 0) {
      const rows = [...r.source.errorRows].map(row => row + 1).sort((a, b) => a - b);
      partiallyChecked.push({ path: file.path, rows });
    }
  }

  return { notChecked, partiallyChecked, failed };
}

export function grammarFailureWarning(path: string, language: string, reason: string): string {
  return `house-rules warning: the ${language} grammar did not load (${reason}); ${path} was not checked.`;
}

/**
 * Format a sorted list of 1-based row numbers as compact ranges.
 * Consecutive rows collapse into "start-end" ranges.
 * Shows at most 8 segments; if more exist, appends "+N more" where N is the
 * remaining row count (not segment count).
 *
 * Examples:
 *   [3,4,5,6,...,232]      → "3-232"
 *   [14,15,16,17,42,61]    → "14-17, 42, 61"
 *   [1,2,...,+many more]   → "1-5, 7, 9, ..., +N more"
 */
export function formatRowList(rows: number[]): string {
  if (rows.length === 0) return '';

  // Build segments (runs of consecutive numbers)
  const segments: Array<[number, number]> = [];
  let start = rows[0];
  let prev = rows[0];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i] === prev + 1) {
      prev = rows[i];
    } else {
      segments.push([start, prev]);
      start = rows[i];
      prev = rows[i];
    }
  }
  segments.push([start, prev]);

  const MAX_SEGMENTS = 8;
  const fmt = ([s, e]: [number, number]) => s === e ? `${s}` : `${s}-${e}`;

  if (segments.length <= MAX_SEGMENTS) {
    return segments.map(fmt).join(', ');
  }

  const shown = segments.slice(0, MAX_SEGMENTS);
  const remaining = segments.slice(MAX_SEGMENTS);
  const remainingCount = remaining.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
  return `${shown.map(fmt).join(', ')}, +${remainingCount} more`;
}

export function formatCoverage(cov: Coverage, prefix: string, indent: string): string[] {
  const { notChecked, partiallyChecked, failed } = cov;
  if (notChecked.length === 0 && partiallyChecked.length === 0 && failed.length === 0) return [];

  const lines: string[] = [];
  const onlyNotChecked = partiallyChecked.length === 0 && failed.length === 0;
  if (onlyNotChecked) {
    lines.push(`${prefix} files no language adapter recognises were not checked.`);
  } else {
    lines.push(`${prefix} some changed files were not fully checked.`);
  }

  for (const p of notChecked) {
    lines.push(`${indent}not checked: ${p}`);
  }
  for (const e of partiallyChecked) {
    lines.push(`${indent}partially checked: ${e.path} (parse errors: rows ${formatRowList(e.rows)})`);
  }
  for (const e of failed) {
    lines.push(`${indent}failed: ${e.path} (${e.language} grammar did not load: ${e.reason})`);
  }

  return lines;
}

export function grammarWarnings(cov: Coverage): string[] {
  return cov.failed.map(f => grammarFailureWarning(f.path, f.language, f.reason));
}

/**
 * Returns paths of files that no language-declaring rule can check.
 * Deleted files (text === undefined) are excluded.
 * If no rule declares any languages, returns [].
 */
export function notCheckedFiles(rules: Rule[], files: ScopedFile[]): string[] {
  const covered = new Set<string>();
  for (const rule of rules) {
    if (rule.languages) {
      for (const lang of rule.languages) {
        covered.add(lang);
      }
    }
  }
  if (covered.size === 0) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const file of files) {
    if (file.text === undefined) continue;
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const lang = file.lang ?? languageForPath(file.path) ?? undefined;
    if ((lang === undefined || !covered.has(lang)) && isSourceCodeFile(file.path)) {
      result.push(file.path);
    }
  }
  return result;
}
