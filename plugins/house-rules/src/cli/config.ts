import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, pointer } from '../config/resolve.mjs';
import { RULE_SEVERITIES } from '../config/schema.mjs';

const RULE_ORDER = [
  'commit-message',
  'comment-density',
  'artifact-structure',
  'type-escape-hatches',
  'no-module-mocking',
  'code-smells',
  'effect',
  'require-safety-comment-for-type-assertion',
  'require-readable-spacing',
  'silent-early-return-in-test',
] as const;
const OPTION_KEYS: Record<(typeof RULE_ORDER)[number], string[]> = {
  'commit-message': ['preset'],
  'comment-density': [],
  'artifact-structure': [],
  'type-escape-hatches': ['allowInTypeGuards'],
  'no-module-mocking': [],
  'code-smells': [],
  effect: [],
  'require-safety-comment-for-type-assertion': [],
  'require-readable-spacing': [],
  'silent-early-return-in-test': [],
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
        if (r.options[key] === undefined) continue;
        options[key] = r.options[key];
        sources[key] = r.sources[key] ?? 'explicit';
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
  const idWidth = Math.max(...RULE_ORDER.map((id) => id.length)) + 1;
  for (const id of RULE_ORDER) {
    const r = resolved.rules[id] as any;
    let line = id.padEnd(idWidth) + 'severity=' + r.severity + ' (' + r.sources.severity + ')';
    const setKeys = OPTION_KEYS[id].filter((key) => r.options[key] !== undefined);
    for (const key of setKeys) {
      line += '  ' + key + '=' + r.options[key] + ' (' + (r.sources[key] ?? 'explicit') + ')';
    }
    lines.push(line);
    if (RULE_SEVERITIES[id].length > 1) {
      lines.push('  change with: ' + pointer(resolved, id, 'severity'));
    }
    for (const key of setKeys) {
      lines.push(
        r.sources[key] === undefined
          ? '  change with: rules["' + id + '"].' + key + ' (active: ' + r.options[key] + ', source: explicit)'
          : '  change with: ' + pointer(resolved, id, key),
      );
    }
  }
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
