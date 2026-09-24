import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const CLI = '/home/newman/.local/share/groundwork/plugins/house-rules/src/cli/main.ts';
const BIN = '/home/newman/.local/share/groundwork/plugins/house-rules/bin/house-rules';
const REAL_RULES_DIR = '/home/newman/.local/share/groundwork/plugins/house-rules/rules';

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

function initRepo(dir: string): void {
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'init'], { cwd: dir });
}

function writeStubRule(rulesDir: string, ruleId: string, severity: 'error' | 'warn' = 'error', line = 42): void {
  const ruleDir = path.join(rulesDir, ruleId);
  fs.mkdirSync(ruleDir, { recursive: true });
  // For error: use 'comment-density' (in BUILTIN_POLICY as error)
  // For warn: use a custom ruleId not in BUILTIN_POLICY
  fs.writeFileSync(
    path.join(ruleDir, 'index.ts'),
    `import type { Rule } from '/home/newman/.local/share/groundwork/plugins/house-rules/src/engine/types.js';
const rule: Rule = {
  id: '${ruleId}',
  meta: { description: 'stub' },
  vehicles: ['tree'],
  check(_ctx) {
    return [{ ruleId: '${ruleId}', path: 'README.md', line: ${line}, message: 'stub finding', fingerprintBasis: 'stub' }];
  }
};
export default rule;
`,
  );
}

function runCLI(args: string[], cwd: string) {
  return spawnSync('bun', [CLI, ...args], { cwd, encoding: 'utf8' });
}

describe('house-rules CLI', () => {
  it('check exits 1 on unbaselined error finding', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    initRepo(repoDir);
    writeStubRule(rulesDir, 'comment-density', 'error');

    const r = runCLI(['check', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', '/tmp/nonexistent-baseline-xyz.json'], repoDir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('README.md:42 comment-density stub finding');
    expect(r.stdout).toContain('1 finding(s)');
  });

  it('check exits 0 when error finding is in baseline', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    const baselineFile = path.join(mktemp('hr-bl-'), 'baseline.json');
    initRepo(repoDir);
    writeStubRule(rulesDir, 'comment-density', 'error');

    // First create baseline
    const bl = runCLI(['baseline', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', baselineFile], repoDir);
    expect(bl.status).toBe(0);

    // Now check — should be 0
    const r = runCLI(['check', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', baselineFile], repoDir);
    expect(r.status).toBe(0);
  });

  it('check exits 0 when only warn findings', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    initRepo(repoDir);
    writeStubRule(rulesDir, 'test-warn-stub', 'warn');

    const r = runCLI(['check', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', '/tmp/nonexistent-baseline-xyz.json'], repoDir);
    expect(r.status).toBe(0);
  });

  it('check output format shows path:line ruleId message', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    initRepo(repoDir);
    writeStubRule(rulesDir, 'comment-density', 'error', 42);

    const r = runCLI(['check', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', '/tmp/nonexistent-baseline-xyz.json'], repoDir);
    const lines = r.stdout.split('\n');
    expect(lines.some((l) => l === 'README.md:42 comment-density stub finding')).toBe(true);
  });

  it('baseline writes file and second run is byte-identical', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    const blDir = mktemp('hr-bl-');
    const baselineFile = path.join(blDir, 'baseline.json');
    initRepo(repoDir);
    writeStubRule(rulesDir, 'comment-density', 'error');

    const r1 = runCLI(['baseline', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', baselineFile], repoDir);
    expect(r1.status).toBe(0);
    expect(fs.existsSync(baselineFile)).toBe(true);
    const content1 = fs.readFileSync(baselineFile, 'utf8');

    const r2 = runCLI(['baseline', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', baselineFile], repoDir);
    expect(r2.status).toBe(0);
    const content2 = fs.readFileSync(baselineFile, 'utf8');

    expect(content1).toBe(content2);
  });

  it('bad --base exits 2 with message', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    initRepo(repoDir);

    const r = runCLI(['check', '--base', 'totally-invalid-sha-xyz-99999', '--rules-dir', rulesDir], repoDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('invalid --base ref');
  });

  it('bin/house-rules spawned by path works', () => {
    const repoDir = mktemp('hr-repo-');
    const rulesDir = mktemp('hr-rules-');
    initRepo(repoDir);

    const r = spawnSync(BIN, ['check', '--base', 'HEAD', '--rules-dir', rulesDir, '--baseline-file', '/tmp/nonexistent-baseline-xyz.json'], {
      cwd: repoDir,
      encoding: 'utf8',
    });
    // exit 0 (no rules → no findings) or 1 (findings); NOT 127 (not found) or 2 (usage error)
    expect(r.status).not.toBe(127);
    expect(r.status).not.toBe(2);
  });

  it('bun run house-rules -- check --base HEAD works from repo root', () => {
    const r = spawnSync('bun', ['run', 'house-rules', '--', 'check', '--base', 'HEAD'], {
      cwd: '/home/newman/.local/share/groundwork',
      encoding: 'utf8',
    });
    // Should NOT exit 2 (usage error); 0 or 1 are both valid
    expect(r.status).not.toBe(2);
    expect(r.stderr).not.toContain('Error: invalid --base ref');
  });

  it('smoke test with real rules dir', () => {
    const repoDir = mktemp('hr-repo-');
    initRepo(repoDir);

    const r = runCLI(['check', '--base', 'HEAD', '--rules-dir', REAL_RULES_DIR, '--baseline-file', '/tmp/nonexistent-baseline-xyz.json'], repoDir);
    // 0–2 rules; exit 0 or 1 are both valid
    expect(r.status === 0 || r.status === 1).toBe(true);
  });
});
