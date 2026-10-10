import type { Severity } from './types.js';
import { resolveConfig, type ResolvedConfig } from '../config/resolve.mjs';

export interface PolicyEntry {
  severity: Severity;
  autofix: boolean;
}

export const BUILTIN_POLICY: Record<string, PolicyEntry> = {
  'comment-density': { severity: 'error', autofix: true },
  'artifact-structure': { severity: 'error', autofix: false },
  'type-escape-hatches': { severity: 'warn', autofix: false },
  'no-module-mocking': { severity: 'warn', autofix: false },
  'code-smells': { severity: 'warn', autofix: false },
};

const CONFIGURABLE_IDS = ['type-escape-hatches', 'no-module-mocking', 'code-smells'] as const;

/** Overlays configured severity for the grouped rules; 'off' is kept as severity 'off' (runRules skips it). */
export function policyFor(resolved: ResolvedConfig): Record<string, PolicyEntry> {
  const policy: Record<string, PolicyEntry> = { ...BUILTIN_POLICY };
  for (const id of CONFIGURABLE_IDS) {
    policy[id] = { ...BUILTIN_POLICY[id], severity: resolved.rules[id].severity };
  }
  return policy;
}

/** Reads .house-rules.json under projectDir; falls back to BUILTIN_POLICY when missing or invalid. */
export function policyForRoot(projectDir: string): Record<string, PolicyEntry> {
  try {
    return policyFor(resolveConfig(projectDir));
  } catch {
    return BUILTIN_POLICY;
  }
}

export const DEFAULT_IGNORE: string[] = [
  '**/test/fixtures/**',
  '**/node_modules/**',
  '.git/**',
];
