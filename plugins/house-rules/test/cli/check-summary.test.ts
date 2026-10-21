import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { formatFindingLine } from '../../src/cli/report.js';
import { formatCoverage } from '../../src/engine/run.js';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');
const RULES_DIR = path.resolve(import.meta.dir, '../../rules');

const DENSE = [
  '// one', '// two', '// three', '// four', '// five', '// six',
  'export const a = 1;', '', 'export const b = 2;', '',
  'export const c = 3;', '', 'export const d = 4;',
].join('\n') + '\n';

const ESCAPES = 'export const k = {} as unknown as string;\n';

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function git(dir: string, ...args: string[]) {
  return spawnSync('git', ['-C', dir, '-c', 'user.email=t@t.com', '-c', 'user.name=T', ...args], { encoding: 'utf8' });
}

function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hr-summary-')));
  tempDirs.push(dir);
  git(dir, 'init', '-b', 'main');
  for (const [rel, content] of [['src/a.ts', DENSE], ['src/b.ts', ESCAPES + DENSE]]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'files');
  return dir;
}

function run(dir: string, args: string[]) {
  const base = ['--repo', dir, '--rules-dir', RULES_DIR, '--baseline-file', path.join(dir, 'no-baseline.json')];
  const [sub, ...rest] = args;
  return spawnSync(BIN, [sub, ...rest, ...base], { cwd: dir, encoding: 'utf8', env: childEnv() });
}

interface JsonFinding { ruleId: string; path: string; line?: number; severity: string; message: string }

function groundTruth(dir: string) {
  const r = run(dir, ['check', '--all', '--format', 'json']);
  return { report: JSON.parse(r.stdout), status: r.status };
}

const sidecarOf = (dir: string) => path.join(dir, '.house-rules/check-report.json');

describe('check summary default output', () => {
  it('fixture yields findings from at least two rules and two files', () => {
    const { report } = groundTruth(makeRepo());
    const f = report.findings as JsonFinding[];
    expect(new Set(f.map(x => x.ruleId)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(f.map(x => x.path)).size).toBeGreaterThanOrEqual(2);
  });

  it('summary counts per rule and total match the json findings; no rows, no finding(s)', () => {
    const dir = makeRepo();
    const { report } = groundTruth(dir);
    const findings = report.findings as JsonFinding[];
    const r = run(dir, ['check', '--all']);
    const counts = new Map<string, number>();
    for (const f of findings) counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
    const ruleLines = r.stdout.split('\n').filter(l => l.startsWith('rule '));
    expect(ruleLines.length).toBe(counts.size);
    for (const [id, n] of counts) expect(ruleLines).toContain(`rule ${id}: ${n}`);
    expect(r.stdout).toContain(`total: ${findings.length}\n`);
    for (const f of findings) expect(r.stdout).not.toContain(formatFindingLine(f));
    expect(r.stdout).not.toContain('finding(s)');
  });

  it('prints the sidecar path, writes it, and keeps only the report out of git', () => {
    const dir = makeRepo();
    const r = run(dir, ['check', '--all']);
    expect(r.stdout).toContain(`full report: ${sidecarOf(dir)}\n`);
    expect(fs.existsSync(sidecarOf(dir))).toBe(true);
    const exclude = fs.readFileSync(path.join(dir, '.git/info/exclude'), 'utf8').split('\n');
    expect(exclude.some(l => l.trim() === '.house-rules/check-report.json')).toBe(true);
    expect(exclude.some(l => l.trim() === '.house-rules/')).toBe(false);
    const porcelain = git(dir, 'status', '--porcelain', '--untracked-files=all').stdout;
    expect(porcelain).not.toContain('check-report.json');
  });

  it('sidecar findings deep-equal --format json findings in order', () => {
    const dir = makeRepo();
    const { report } = groundTruth(dir);
    run(dir, ['check', '--all']);
    const side = JSON.parse(fs.readFileSync(sidecarOf(dir), 'utf8'));
    const pick = (f: JsonFinding) => ({ ruleId: f.ruleId, path: f.path, line: f.line, severity: f.severity, message: f.message });
    expect(side.findings.length).toBeGreaterThan(0);
    expect(side.findings.map(pick)).toEqual(report.findings.map(pick));
  });
});

describe('check --verbose', () => {
  it('stdout is the old row output byte for byte and writes no sidecar', () => {
    const dir = makeRepo();
    const { report } = groundTruth(dir);
    const findings = report.findings as JsonFinding[];
    const r = run(dir, ['check', '--all', '--verbose']);
    const head = findings.map(formatFindingLine).join('\n') + '\n' + `${findings.length} finding(s)\n`;
    const cov = formatCoverage(report.coverage, 'note:', '  ');
    expect(r.stdout.startsWith(head)).toBe(true);
    const tail = r.stdout.slice(head.length);
    expect(cov.length === 0 ? tail : '').toBe('');
    for (const line of cov) expect(tail).toContain(line);
    expect(r.stdout).not.toContain('total:');
    expect(fs.existsSync(sidecarOf(dir))).toBe(false);
  });

  it('exits 2 on a non-check subcommand', () => {
    const dir = makeRepo();
    expect(run(dir, ['baseline', '--verbose']).status).toBe(2);
  });
});

describe('check exit codes and json', () => {
  it('default, --verbose and json agree on exit status; error finding gives 1', () => {
    const dir = makeRepo();
    const { status } = groundTruth(dir);
    expect(status).toBe(1);
    expect(run(dir, ['check', '--all']).status).toBe(status);
    expect(run(dir, ['check', '--all', '--verbose']).status).toBe(status);
  });

  it('exit 0 stays 0 for all modes on a clean repo', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hr-summary-clean-')));
    tempDirs.push(dir);
    git(dir, 'init', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'ok.ts'), 'export const a = 1;\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-m', 'ok');
    expect(run(dir, ['check', '--all']).status).toBe(0);
    expect(run(dir, ['check', '--all', '--verbose']).status).toBe(0);
    expect(run(dir, ['check', '--all', '--format', 'json']).status).toBe(0);
  });

  it('--format json writes no sidecar', () => {
    const dir = makeRepo();
    run(dir, ['check', '--all', '--format', 'json']);
    expect(fs.existsSync(sidecarOf(dir))).toBe(false);
  });
});

describe('check --fix summary', () => {
  it('default output has total and fixed lines and writes the sidecar', () => {
    const dir = makeRepo();
    const r = run(dir, ['check', '--all', '--fix']);
    expect(r.stdout).toMatch(/^total: \d+$/m);
    expect(r.stdout).toMatch(/^\d+ fixed$/m);
    expect(fs.existsSync(sidecarOf(dir))).toBe(true);
  });
});
