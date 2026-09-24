import { describe, it, expect } from 'bun:test';
import path from 'node:path';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '..');

describe('rules-fresh', () => {
  it('--check passes on the real rules dir', () => {
    const scriptPath = path.join(PLUGIN_ROOT, 'scripts/gen-rule-readmes.ts');
    const result = Bun.spawnSync(['bun', scriptPath, '--check'], {
      cwd: path.resolve(PLUGIN_ROOT, '../..'),
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^rules checked: \d+$/);
  });
});
