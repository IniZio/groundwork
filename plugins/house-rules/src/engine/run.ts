import type { Rule, Finding, RuleContext, Severity, ScopedFile } from './types.js';
import { BUILTIN_POLICY, DEFAULT_IGNORE, type PolicyEntry } from './policy.js';

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
    if (file.lang === undefined || !covered.has(file.lang)) {
      result.push(file.path);
    }
  }
  return result;
}
