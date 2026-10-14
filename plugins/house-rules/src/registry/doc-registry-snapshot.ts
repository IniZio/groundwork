import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RegistrySnapshotType {
  tier: 'product' | 'working' | 'ephemeral';
  generates: string;
  description: string;
  instruction: string;
  template?: string;
  frontmatter: Record<string, unknown>;
  headings: string[];
  headingsWhen?: Array<{ property: string; in: string[]; headings: string[] }>;
}

export interface RegistrySnapshot {
  types: Record<string, RegistrySnapshotType>;
  forbidden: Array<{ pattern: string; redirect: string }>;
}

export function loadRegistrySnapshot(): RegistrySnapshot {
  const file = join(import.meta.dir, '../config/doc-registry.json');
  return JSON.parse(readFileSync(file, 'utf8')) as RegistrySnapshot;
}
