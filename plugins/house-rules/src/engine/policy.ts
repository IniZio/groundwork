import type { Severity } from './types.js';

export interface PolicyEntry {
  severity: Severity;
  autofix: boolean;
}

export const BUILTIN_POLICY: Record<string, PolicyEntry> = {
  'comment-density': { severity: 'error', autofix: true },
  'stray-artifacts': { severity: 'error', autofix: false },
};

export const DEFAULT_IGNORE: string[] = [
  '**/test/fixtures/**',
  '**/node_modules/**',
  '.git/**',
];
