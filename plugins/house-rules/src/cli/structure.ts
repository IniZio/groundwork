import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.mjs';
import { renderStructure, resolveWhere, scaffold } from '../config/structure.mjs';

function loadManifest(repoRoot: string) {
  return resolveConfig(repoRoot).rules['artifact-structure'].options;
}

function fail(err: unknown): number {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  return 1;
}

export function runStructure(opts: { repoRoot: string }): number {
  try {
    process.stdout.write(renderStructure(loadManifest(opts.repoRoot)).join('\n') + '\n');
    return 0;
  } catch (err) {
    return fail(err);
  }
}

export function runWhere(opts: { repoRoot: string; query: string }): number {
  try {
    const res = resolveWhere(opts.query, loadManifest(opts.repoRoot));
    if (res.kind === 'unknown') {
      process.stderr.write(
        `unknown type "${opts.query}"\ntypes: ${res.types.join(', ')}\n`,
      );
      return 1;
    }
    if (res.kind === 'type') {
      process.stdout.write(`${res.type}: ${res.generates}\n`);
      if (res.instruction) process.stdout.write(`${res.instruction}\n`);
      return 0;
    }
    for (const r of res.ranked) {
      process.stdout.write(`${r.type}: ${r.generates}\n`);
      if (r.instruction) process.stdout.write(`  ${r.instruction}\n`);
    }
    return 0;
  } catch (err) {
    return fail(err);
  }
}

export function runNew(opts: {
  repoRoot: string;
  type: string;
  params: Record<string, string>;
}): number {
  let out: { path: string; content: string };
  try {
    const today = new Date().toISOString().slice(0, 10);
    out = scaffold(opts.type, opts.params, loadManifest(opts.repoRoot), today);
  } catch (err) {
    return fail(err);
  }
  const abs = path.join(opts.repoRoot, out.path);
  if (fs.existsSync(abs)) {
    process.stderr.write(`Error: target exists: ${out.path}\n`);
    return 1;
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out.content, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      process.stderr.write(`Error: target exists: ${out.path}\n`);
      return 1;
    }
    return fail(err);
  }
  process.stdout.write(out.path + '\n');
  return 0;
}
