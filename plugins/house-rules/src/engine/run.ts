import path from 'node:path';
import type { Rule, Finding, RuleContext, Severity, ScopedFile } from './types.js';
import type { Language } from '../hooks/languages/registry.js';
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
    if (file.lang === undefined || !covered.has(file.lang)) continue;

    const r = await ctx.sourceFile?.(file);
    if (r == null) continue;

    if (!r.ok) {
      failed.push({ path: file.path, language: file.lang, reason: r.reason });
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
    lines.push(`${indent}partially checked: ${e.path} (rows ${e.rows.join(", ")})`);
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
    if ((file.lang === undefined || !covered.has(file.lang)) && isSourceCodeFile(file.path)) {
      result.push(file.path);
    }
  }
  return result;
}
