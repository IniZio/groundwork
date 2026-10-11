import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(args: string[], cwd: string) {
  return spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', ...args], { cwd, encoding: 'utf8' });
}

function makeRepo(config?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-policy-'));
  tempDirs.push(dir);
  git(['init', '-b', 'main'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# t\n');
  if (config) fs.writeFileSync(path.join(dir, '.house-rules.json'), JSON.stringify(config));
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  fs.writeFileSync(path.join(dir, 'a.test.ts'), "vi.mock('x');\n");
  git(['add', 'a.test.ts'], dir);
  return dir;
}

function check(dir: string, extra: string[] = []) {
  const env = { ...process.env };
  delete env['CLAUDE_PROJECT_DIR'];
  delete env['CLAUDE_PLUGIN_ROOT'];
  return spawnSync(BIN, ['check', '--base', 'HEAD', ...extra], { cwd: dir, encoding: 'utf8', env });
}

function mockingFindings(stdout: string): { severity: string }[] {
  const report = JSON.parse(stdout);
  return report.findings.filter((f: { ruleId: string }) => f.ruleId === 'no-module-mocking');
}

describe('check uses config-resolved policy', () => {
  it('reports new-rule findings as warn with exit 0', () => {
    const r = check(makeRepo(), ['--format', 'json']);
    const found = mockingFindings(r.stdout);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(f => f.severity === 'warn')).toBe(true);
    expect(r.status).toBe(0);
  });

  it('yields no findings for a rule set off (json)', () => {
    const r = check(makeRepo({ rules: { 'no-module-mocking': 'off' } }), ['--format', 'json']);
    expect(mockingFindings(r.stdout)).toEqual([]);
  });

  it('yields no findings for a rule set off (text)', () => {
    const r = check(makeRepo({ rules: { 'no-module-mocking': 'off' } }), ['--verbose']);
    expect(r.stdout + r.stderr).not.toContain('no-module-mocking');
  });

  it('applies the same policy under --fix', () => {
    const r = check(makeRepo({ rules: { 'no-module-mocking': 'off' } }), ['--fix', '--format', 'json']);
    expect(mockingFindings(r.stdout)).toEqual([]);
  });
});
