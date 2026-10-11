import type { Finding } from './types.js';

const SAFETY_RULE = 'require-safety-comment-for-type-assertion';
const ESCAPE_RULE = 'type-escape-hatches';

const key = (f: Finding): string => `${f.path}\0${f.line}`;

export function dropOverlappingSafetyFindings(findings: readonly Finding[]): Finding[] {
  const reported = new Set<string>();
  for (const f of findings) {
    if (f.ruleId === ESCAPE_RULE && f.line !== undefined) reported.add(key(f));
  }
  return findings.filter((f) => !(f.ruleId === SAFETY_RULE && f.line !== undefined && reported.has(key(f))));
}
