import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, pointer } from '../config/resolve.mjs';
import { RULE_SEVERITIES } from '../config/schema.mjs';

const RULE_ORDER = ['commit-message', 'comment-density', 'stray-artifacts'] as const;
const OPTION_KEYS: Record<(typeof RULE_ORDER)[number], string[]> = {
  'commit-message': ['preset'],
  'comment-density': ['max_per_100'],
  'stray-artifacts': [],
};

function schemaUrl(): string {
  const file = path.resolve(import.meta.dir, '../../house-rules.schema.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).$id;
}

export function runConfig(opts: { repoRoot: string; format: 'text' | 'json' }): number {
  let resolved;
  let schema: string;
  try {
    resolved = resolveConfig(opts.repoRoot);
    schema = schemaUrl();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  if (opts.format === 'json') {
    const rules: Record<string, unknown> = {};
    for (const id of RULE_ORDER) {
      const r = resolved.rules[id] as any;
      const options: Record<string, unknown> = {};
      const sources: Record<string, unknown> = { severity: r.sources.severity };
      for (const key of OPTION_KEYS[id]) {
        options[key] = r.options[key];
        sources[key] = r.sources[key];
      }
      rules[id] = { severity: r.severity, options, sources };
    }
    process.stdout.write(JSON.stringify({ schema, file: resolved.file, rules }, null, 2) + '\n');
    return 0;
  }

  const lines: string[] = [
    resolved.file === null
      ? 'config: none (all values default or detected)'
      : `config: ${resolved.file}`,
    `schema: ${schema}`,
  ];
  for (const id of RULE_ORDER) {
    const r = resolved.rules[id] as any;
    let line = id.padEnd(16) + 'severity=' + r.severity + ' (' + r.sources.severity + ')';
    for (const key of OPTION_KEYS[id]) {
      line += '  ' + key + '=' + r.options[key] + ' (' + r.sources[key] + ')';
    }
    lines.push(line);
    if (RULE_SEVERITIES[id].length > 1) {
      lines.push('  change with: ' + pointer(resolved, id, 'severity'));
    }
    for (const key of OPTION_KEYS[id]) {
      lines.push('  change with: ' + pointer(resolved, id, key));
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
