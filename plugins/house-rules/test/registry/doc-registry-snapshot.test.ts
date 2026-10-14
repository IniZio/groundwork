import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pluginDir = resolve(import.meta.dir, '../..');
const tmpDirs: string[] = [];

function copyPlugin(): string {
  const root = mkdtempSync(join(tmpdir(), 'hr-registry-'));
  tmpDirs.push(root);
  const dest = join(root, 'house-rules');
  cpSync(pluginDir, dest, {
    recursive: true,
    filter: (src) => !src.split('/').includes('node_modules'),
  });
  return dest;
}

function runLoader(copy: string) {
  const loader = join(copy, 'src/registry/doc-registry-snapshot.ts');
  const code = `import { loadRegistrySnapshot } from ${JSON.stringify(loader)}; console.log(JSON.stringify(loadRegistrySnapshot()));`;
  return Bun.spawnSync(['bun', '-e', code], { cwd: copy, stdout: 'pipe', stderr: 'pipe' });
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('registry snapshot loader', () => {
  test('loads the snapshot from a plugin copy that has no parent groundwork tree', () => {
    const copy = copyPlugin();
    expect(existsSync(join(copy, '../src'))).toBe(false);
    const res = runLoader(copy);
    expect(res.exitCode).toBe(0);
    const out = JSON.parse(res.stdout.toString());
    const issue = out.types.issue;
    expect(issue).toBeDefined();
    expect(out.types.motive.headings.length).toBeGreaterThan(0);
    expect(typeof issue.template).toBe('string');
    expect(issue.template.endsWith('.md')).toBe(true);
    expect(out.forbidden.length).toBeGreaterThan(0);
    const onDisk = JSON.parse(readFileSync(join(copy, 'src/config/doc-registry.json'), 'utf8'));
    expect(out).toEqual(onDisk);
  });

  test('fails with a message naming doc-registry.json when the snapshot file is missing', () => {
    const copy = copyPlugin();
    rmSync(join(copy, 'src/config/doc-registry.json'));
    const res = runLoader(copy);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain('doc-registry.json');
  });
});
