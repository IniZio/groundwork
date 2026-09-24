import type { Rule, Finding, RuleContext, Severity } from './types.js';
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

    const findings: Finding[] = await rule.check(ctx);

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
