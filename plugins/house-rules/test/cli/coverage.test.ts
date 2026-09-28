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

function runCLI(args: string[], cwd: string, extraEnv?: Record<string, string>) {
  const env = extraEnv ? { ...process.env, ...extraEnv } : undefined;
  return spawnSync('bun', [CLI, ...args], { cwd, encoding: 'utf8', ...(env ? { env } : {}) });
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
  it('text stdout contains not checked: src/App.scala when .scala file added', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/App.scala': 'fun main() {}\n',
      'a.ts': 'export const x = 1;\n',
    });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json'],
      repoDir,
    );

    expect(r.stdout).toContain('not checked: src/App.scala');
  });

  it('--format json -> report.coverage.notChecked equals [src/App.scala]', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/App.scala': 'fun main() {}\n',
      'a.ts': 'export const x = 1;\n',
    });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', '/tmp/nonexistent-coverage-test-baseline.json',
       '--format', 'json'],
      repoDir,
    );

    const report = JSON.parse(r.stdout);
    expect(report.coverage.notChecked).toEqual(['src/App.scala']);
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

  it('bad rule declaring unknown language scala -> exit 2, stderr names rule and language', () => {
    const rulesDir = mktemp('hr-bad-rules-');
    const ruleDir = path.join(rulesDir, 'bad-rule');
    fs.mkdirSync(ruleDir, { recursive: true });
    fs.writeFileSync(
      path.join(ruleDir, 'index.ts'),
      `import type { Rule } from '${path.join(PLUGIN_ROOT, 'src/engine/types.js')}';
const rule: Rule = {
  id: 'bad-rule',
  meta: { description: 'x' },
  languages: ['scala' as any],
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
    expect(r.stderr).toContain('scala');
  });
});

const FAIL_TS_ENV = { HOUSE_RULES_TEST_FAIL_GRAMMARS: 'typescript' };
const BASELINE_FILE = '/tmp/nonexistent-coverage-test-baseline.json';

describe('coverage report — failed grammar (check, text)', () => {
  it('exit 1, stderr has warning naming typescript, stdout has failed line for src/a.ts', () => {
    const { repoDir, baseSha } = makeRepoWithBase({ 'src/a.ts': 'export const x = 1;\n' });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE],
      repoDir,
      FAIL_TS_ENV,
    );

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('typescript');
    expect(r.stderr).toContain('forced by HOUSE_RULES_TEST_FAIL_GRAMMARS');
    expect(r.stdout).toContain('failed: src/a.ts (typescript grammar did not load: forced by HOUSE_RULES_TEST_FAIL_GRAMMARS)');
  });

  it('same repo without env exits 0 with no failed line', () => {
    const { repoDir, baseSha } = makeRepoWithBase({ 'src/a.ts': 'export const x = 1;\n' });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE],
      repoDir,
    );

    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('failed:');
  });
});

describe('coverage report — failed grammar (check, json)', () => {
  it('exit 1, coverage.failed has entry for src/a.ts with typescript language', () => {
    const { repoDir, baseSha } = makeRepoWithBase({ 'src/a.ts': 'export const x = 1;\n' });

    const r = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE, '--format', 'json'],
      repoDir,
      FAIL_TS_ENV,
    );

    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.coverage.failed).toEqual([
      { path: 'src/a.ts', language: 'typescript', reason: 'forced by HOUSE_RULES_TEST_FAIL_GRAMMARS' },
    ]);
  });
});

describe('coverage report — partially checked (check, text and json)', () => {
  it('text has partially checked line with rows 2; json partiallyChecked entry; exit 0', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/b.ts': 'const x = 1;\nconst y = ;\nconst z = 3;\n',
    });

    const textR = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE],
      repoDir,
    );

    expect(textR.status).toBe(0);
    expect(textR.stdout).toContain('partially checked: src/b.ts (rows 2)');

    const jsonR = runCLI(
      ['check', '--base', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE, '--format', 'json'],
      repoDir,
    );

    const report = JSON.parse(jsonR.stdout);
    expect(report.coverage.partiallyChecked).toEqual([{ path: 'src/b.ts', rows: [2] }]);
  });
});

describe('coverage report — housekeep text and json', () => {
  it('exit 1, text has failed and not-checked lines, json coverage matches check output', () => {
    const { repoDir, baseSha } = makeRepoWithBase({
      'src/a.ts': 'export const x = 1;\n',
      'src/App.scala': 'fun main() {}\n',
    });

    const textR = runCLI(
      ['housekeep', '--since', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE],
      repoDir,
      FAIL_TS_ENV,
    );

    expect(textR.status).toBe(1);
    expect(textR.stdout).toContain('failed: src/a.ts (typescript grammar did not load: forced by HOUSE_RULES_TEST_FAIL_GRAMMARS)');
    expect(textR.stdout).toContain('not checked: src/App.scala');

    const jsonR = runCLI(
      ['housekeep', '--since', baseSha, '--repo', repoDir, '--rules-dir', REAL_RULES_DIR,
       '--baseline-file', BASELINE_FILE, '--format', 'json'],
      repoDir,
      FAIL_TS_ENV,
    );

    expect(jsonR.status).toBe(1);
    const report = JSON.parse(jsonR.stdout);
    expect(report.coverage.failed).toEqual([
      { path: 'src/a.ts', language: 'typescript', reason: 'forced by HOUSE_RULES_TEST_FAIL_GRAMMARS' },
    ]);
    expect(report.coverage.notChecked).toContain('src/App.scala');
  });
});
