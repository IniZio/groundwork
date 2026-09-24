import { createHash } from 'node:crypto';
import type { Finding } from './types.js';

export interface Baseline {
  version: 1;
  base?: string;
  entries: Array<{ rule: string; path: string; fingerprint: string }>;
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function fingerprint(f: Finding): string {
  const input = f.ruleId + '\0' + f.path + '\0' + normalize(f.fingerprintBasis);
  return createHash('sha256').update(input).digest('hex');
}

export function toBaseline(findings: Finding[], base?: string): Baseline {
  const seen = new Set<string>();
  const entries: Array<{ rule: string; path: string; fingerprint: string }> = [];

  for (const f of findings) {
    const fp = fingerprint(f);
    const key = f.ruleId + '\0' + f.path + '\0' + fp;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ rule: f.ruleId, path: f.path, fingerprint: fp });
    }
  }

  entries.sort((a, b) => {
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.fingerprint !== b.fingerprint) return a.fingerprint < b.fingerprint ? -1 : 1;
    return 0;
  });

  const result: Baseline = { version: 1, entries };
  if (base !== undefined) result.base = base;
  return result;
}

export async function writeBaseline(file: string, findings: Finding[], base?: string): Promise<void> {
  const baseline = toBaseline(findings, base);
  const content = JSON.stringify(baseline, null, 2) + '\n';
  await Bun.write(file, content);
}

export async function readBaseline(file: string): Promise<Baseline> {
  if (!(await Bun.file(file).exists())) {
    return { version: 1, entries: [] };
  }

  let parsed: unknown;
  try {
    const text = await Bun.file(file).text();
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Invalid or unrecognised baseline format in ${file}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>)['version'] !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>)['entries'])
  ) {
    throw new Error(`Invalid or unrecognised baseline format in ${file}`);
  }

  const entries = (parsed as Record<string, unknown>)['entries'] as unknown[];
  for (const entry of entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>)['rule'] !== 'string' ||
      typeof (entry as Record<string, unknown>)['path'] !== 'string' ||
      !/^[0-9a-f]{64}$/.test((entry as Record<string, unknown>)['fingerprint'] as string)
    ) {
      throw new Error(`Invalid or unrecognised baseline format in ${file}`);
    }
  }

  return parsed as Baseline;
}

export function subtractBaseline<T extends Finding>(findings: T[], baseline: Baseline): T[] {
  const keys = new Set(
    baseline.entries.map((e) => e.rule + '\0' + e.path + '\0' + e.fingerprint),
  );
  return findings.filter((f) => !keys.has(f.ruleId + '\0' + f.path + '\0' + fingerprint(f)));
}
