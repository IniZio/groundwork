import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');
const CLI = path.join(PLUGIN_ROOT, 'src/cli/main.ts');
const REAL_RULES_DIR = path.join(PLUGIN_ROOT, 'rules');

const tempDirs: string[] = [];

function mktemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runCLI(args: string[], cwd: string) {
  return spawnSync('bun', [CLI, ...args], { cwd, encoding: 'utf8' });
}

/**
 * Create a temp git repo, make an empty initial commit, return its SHA.
 * Then write the given files and commit them.
 */
function makeRepoWithBase(files: Record<string, string>): { repoDir: string; baseSha: string } {
  const repoDir = mktemp('hr-cov-');
  spawnSync('git', ['init'], { cwd: repoDir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
    'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir });
  const shaResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' });
  const baseSha = shaResult.stdout.trim();

  // Write files and commit after the base
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(repoDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', '.'], { cwd: repoDir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'files'], { cwd: repoDir });

  return { repoDir, baseSha };
}

describe('coverage report — not-checked files', () => {
  it('text stdout contains not checked: src/App.kt when .kt file added', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/App.kt': 'fun main() {}\n',
      'a.ts': 'export const x = 1;\n',
    });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json'],
      repoDir,
    );

    expect(r.stdout).toContain('not checked: src/App.kt');
  });

  it('--format json -> report.coverage.notChecked equals [src/App.kt]', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/App.kt': 'fun main() {}\n',
      'a.ts': 'export const x = 1;\n',
    });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json',
       '--format', 'json'],
      repoDir,
    );

    const report = JSON.parse(r.stdout);
    expect(report.coverage.notChecked).toEqual(['src/App.kt']);
  });

  it('text stdout has no not checked when only .ts changed', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'a.ts': 'export const x = 1;\n',
    });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json'],
      repoDir,
    );

    expect(r.stdout).not.toContain('not checked');
    const report_json = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json',
       '--format', 'json'],
      repoDir,
    );
    const report = JSON.parse(report_json.stdout);
    expect(report.coverage.notChecked).toEqual([]);
  });

  it('bad rule declaring unknown language kotlin -> exit 2, stderr names rule and language', () => {
    const rulesDir = mktemp('hr-bad-rules-');
    const ruleDir = path.join(rulesDir, 'bad-rule');
    fs.mkdirSync(ruleDir, { recursive: true });
    fs.writeFileSync(
      path.join(ruleDir, 'index.ts'),
      `import type { Rule } from '${path.join(PLUGIN_ROOT, 'src/engine/types.js')}';
const rule: Rule = {
  id: 'bad-rule',
  meta: { description: 'x' },
  vehicles: [],
  languages: ['kotlin' as any],
  check: () => [],
};
export default rule;
`,
    );

    const repoDir = mktemp('hr-bad-repo-');
    spawnSync('git', ['init'], { cwd: repoDir });
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
      'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir });

    const r = runCLI(
      ['check', '--base', 'HEAD', '--repo', repoDir, '--rules-dir', rulesDir,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline-bad.json'],
      repoDir,
    );

    expect(r.status).toBe(2);
    expect(r.stderr).toContain('bad-rule');
    expect(r.stderr).toContain('kotlin');
  });
});
