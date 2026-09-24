import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const BIN = join(PLUGIN_ROOT, 'bin/house-rules');
const REPO = resolve(PLUGIN_ROOT, '../..');

function cloneRepo(dest: string): void {
  const r = spawnSync('git', ['clone', REPO, dest], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
}

function gitAdd(repoRoot: string, ...files: string[]): void {
  const r = spawnSync('git', ['-C', repoRoot, 'add', ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git add failed: ${r.stderr}`);
}

function runCLI(args: string[], repoRoot: string): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  delete env['CLAUDE_PROJECT_DIR'];
  delete env['CLAUDE_PLUGIN_ROOT'];
  return spawnSync(BIN, args, { cwd: repoRoot, encoding: 'utf8', env });
}

// Over-budget comment block: 6 comment lines in 10 total lines = 60/100
const DENSE_SRC = [
  '// comment 1',
  '// comment 2',
  '// comment 3',
  '// comment 4',
  '// comment 5',
  '// comment 6',
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
].join('\n') + '\n';

describe('dogfood e2e', () => {
  it('check exits 1 and names both stray-artifacts and comment-density', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'hr-e2e-'));
    try {
      cloneRepo(tmpDir);

      // baseline against HEAD so only our additions are checked
      const bl = runCLI(['baseline', '--base', 'HEAD'], tmpDir);
      expect(bl.status).toBe(0);

      // stray-artifacts: docs/ is a non-canonical synonym for doc/
      mkdirSync(join(tmpDir, 'docs'), { recursive: true });
      writeFileSync(join(tmpDir, 'docs', 'guide.md'), '# guide\n');
      gitAdd(tmpDir, 'docs/guide.md');

      // comment-density: 6 comments in 10 added lines = 60/100 (cap is 5/100)
      writeFileSync(join(tmpDir, 'src', 'dense.ts'), DENSE_SRC);
      gitAdd(tmpDir, 'src/dense.ts');

      const result = runCLI(['check', '--base', 'HEAD'], tmpDir);
      const output = result.stdout + result.stderr;

      expect(result.status).toBe(1);
      expect(output).toContain('stray-artifacts');
      expect(output).toContain('comment-density');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('gen-rule-readmes --check reports exactly 2 rules', () => {
    const r = spawnSync(
      'bun',
      ['plugins/house-rules/scripts/gen-rule-readmes.ts', '--check'],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('rules checked: 2');
  });
});
