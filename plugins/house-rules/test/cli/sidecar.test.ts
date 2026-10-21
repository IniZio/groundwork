import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeSidecar, SIDECAR_REL } from '../../src/cli/sidecar.js';
import { buildReport, type ReportFinding } from '../../src/cli/report.js';

const scope = { base: 'HEAD', mode: 'diff', files: [] } as any;
const dirs: string[] = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

function tmp(): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hr-sidecar-')));
  dirs.push(d);
  return d;
}
function git(cwd: string, ...a: string[]) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
function repo(): string {
  const d = tmp();
  git(d, 'init');
  git(d, 'config', 'user.email', 't@example.com');
  git(d, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a');
  git(d, 'add', '.');
  git(d, 'commit', '-m', 'init');
  return d;
}
const findings: ReportFinding[] = [
  { ruleId: 'r1', path: 'a.ts', line: 3, severity: 'error', message: '[c] one' },
  { ruleId: 'r2', path: 'b.ts', line: null, severity: 'warn', message: '[d] two' },
];
const report = buildReport(scope, { findings });
const REPORT_REL = '.house-rules/check-report.json';
const isIgnored = (d: string, rel: string) =>
  spawnSync('git', ['check-ignore', rel], { cwd: d }).status === 0;
const ignored = (d: string) => isIgnored(d, REPORT_REL);
const excludePath = (d: string) => path.resolve(d, git(d, 'rev-parse', '--git-path', 'info/exclude'));

describe('writeSidecar', () => {
  it('writes full report with every finding and ignores it', () => {
    const d = repo();
    const p = writeSidecar(d, report);
    expect(SIDECAR_REL).toBe(REPORT_REL);
    expect(p).toBe(path.join(d, REPORT_REL));
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(report)));
    for (const x of findings) expect(parsed.findings).toContainEqual(x);
    expect(ignored(d)).toBe(true);
    expect(fs.existsSync(path.join(d, '.gitignore'))).toBe(false);
  });

  it('leaves the committed baseline beside the report trackable', () => {
    const d = repo();
    writeSidecar(d, report);
    expect(fs.readFileSync(excludePath(d), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))).toEqual([REPORT_REL]);
    expect(isIgnored(d, '.house-rules/baseline.json')).toBe(false);
  });

  it('is idempotent and preserves existing lines without trailing newline', () => {
    const d = repo();
    const ex = excludePath(d);
    fs.mkdirSync(path.dirname(ex), { recursive: true });
    fs.writeFileSync(ex, '# keep\nfoo/');
    writeSidecar(d, report);
    writeSidecar(d, report);
    const lines = fs.readFileSync(ex, 'utf8').split('\n');
    expect(lines).toContain('# keep');
    expect(lines).toContain('foo/');
    expect(lines.filter(l => l === REPORT_REL).length).toBe(1);
    expect(ignored(d)).toBe(true);
  });

  it('handles missing exclude file', () => {
    const d = repo();
    const ex = excludePath(d);
    fs.rmSync(ex, { force: true });
    fs.rmSync(path.dirname(ex), { recursive: true, force: true });
    writeSidecar(d, report);
    expect(ignored(d)).toBe(true);
  });

  it('works in a linked worktree', () => {
    const d = repo();
    const wt = path.join(tmp(), 'wt');
    git(d, 'worktree', 'add', wt, '-b', 'side');
    writeSidecar(wt, report);
    writeSidecar(wt, report);
    expect(fs.existsSync(path.join(wt, REPORT_REL))).toBe(true);
    expect(ignored(wt)).toBe(true);
    const lines = fs.readFileSync(excludePath(wt), 'utf8').split('\n');
    expect(lines.filter(l => l === REPORT_REL).length).toBe(1);
  });

  it('outside a git repo writes sidecar and does not throw', () => {
    const d = tmp();
    const p = writeSidecar(d, report);
    expect(JSON.parse(fs.readFileSync(p, 'utf8')).findings.length).toBe(2);
  });
});
