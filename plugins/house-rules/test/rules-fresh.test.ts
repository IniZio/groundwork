import { describe, it, expect } from 'bun:test';
import path from 'node:path';

describe('rules-fresh', () => {
  it('--check passes on the real rules dir', () => {
    const scriptPath = path.resolve(import.meta.dir, '../scripts/gen-rule-readmes.ts');
    const result = Bun.spawnSync(['bun', scriptPath, '--check'], {
      cwd: '/home/newman/.local/share/groundwork',
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^rules checked: \d+$/);
  });
});
