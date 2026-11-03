import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderAll, staleFiles } from '../scripts/gen-validators.js';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hr-validators-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('validators-fresh', () => {
  it('--check passes on the committed generated validators', () => {
    const result = Bun.spawnSync(['bun', path.join(PLUGIN_ROOT, 'scripts/gen-validators.ts'), '--check'], {
      cwd: path.resolve(PLUGIN_ROOT, '../..'),
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    expect(new TextDecoder().decode(result.stderr)).toBe('');
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^validators checked: \d+$/);
  });

  it('reports a generated file that no longer matches its schema, and a missing one', () => {
    const files = [...renderAll()];
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const [rel, text] of files) {
      mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      writeFileSync(path.join(tmp, rel), text);
    }
    expect(staleFiles(tmp)).toEqual([]);

    const [edited, removed] = files.map(([rel]) => rel);
    writeFileSync(path.join(tmp, edited!), files[0]![1].replace('"string"', '"number"'));
    rmSync(path.join(tmp, removed!));
    expect(staleFiles(tmp).sort()).toEqual([edited!, removed!].sort());
  });
});
