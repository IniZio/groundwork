import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function mktemp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function childEnv(ledgerDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = ledgerDir;
  return env;
}

function git(dir: string, args: string[]): string {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

function initRepo(dir: string): string {
  git(dir, ['init']);
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'init']);
  return git(dir, ['rev-parse', 'HEAD']);
}

function addAndCommit(dir: string, files: string[], msg: string): string {
  for (const f of files) {
    git(dir, ['add', f]);
  }
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function run(args: string[], ledgerDir: string): string {
  const r = spawnSync(BIN, ['housekeep', ...args], {
    encoding: 'utf8',
    env: childEnv(ledgerDir),
  });
  return r.stdout;
}

function lastNonEmptyLine(s: string): string {
  return s.split('\n').filter(l => l.trim()).at(-1) ?? '';
}

function manualLines(stdout: string): string[] {
  const lines = stdout.split('\n');
  const hdrIdx = lines.findIndex(l => l.startsWith('Needs manual fix'));
  if (hdrIdx === -1) return [];
  return lines.slice(hdrIdx + 1).filter(l => l.startsWith('  ') && !l.trimStart().startsWith('['));
}

function extractDiff(stdout: string): string {
  const lines = stdout.split('\n');
  const start = lines.findIndex(l => l.startsWith('diff --git '));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('Needs manual fix') || /^\d+ fixed,/.test(l)));
  const slice = end === -1 ? lines.slice(start) : lines.slice(start, end);
  return slice.join('\n');
}

// Fixture content
const SVC_BASE = `package svc

func Foo() {} // old-inline
func Bar() {} // old-inline2
func C() {}
func D() {}
func E() {}
func F() {}
func G() {}
func H() {}
func I() {}
func J() {}
func K() {}
func L() {}
func M() {}
func N() {}
`;

const SVC_NEW = `package svc

func Foo() {} // new-inline
func Bar() {} // new-inline2
func C() {}
func D() {}
func E() {}
func F() {}
func G() {}
func H() {}
func I() {}
func J() {}
func K() {}
func L() {}
func M() {}
func N() {}
// standalone nonDoc1

// standalone nonDoc2

func O() {}
func P() {}
`;

const FIX_TS = `// c1
// c2
// c3
// c4
// c5
// c6
export const a = 1;
export const b = 2;
`;

const TOOL_PY = `# c1
# c2
# c3
# c4
# c5
# c6
a = 1
b = 2
`;

function buildFixture(): { repoDir: string; baseSha: string } {
  const repoDir = mktemp('hr-dryr-');
  initRepo(repoDir);
  fs.writeFileSync(path.join(repoDir, 'svc.go'), SVC_BASE);
  addAndCommit(repoDir, ['svc.go'], 'base');
  const baseSha = git(repoDir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repoDir, 'svc.go'), SVC_NEW);
  fs.writeFileSync(path.join(repoDir, 'fix.ts'), FIX_TS);
  fs.writeFileSync(path.join(repoDir, 'tool.py'), TOOL_PY);
  addAndCommit(repoDir, ['svc.go', 'fix.ts', 'tool.py'], 'add files');
  return { repoDir, baseSha };
}

const SUMMARY = '1 fixed, 2 need manual fix';
const MANUAL_SVC = '  svc.go comment-density 25.0/100 (2 comments in 8 added lines; rows 17, 19) — autofix failed: still over cap after fix';
const MANUAL_PY  = '  tool.py comment-density 75.0/100 (6 comments in 8 added lines; rows 1, 2, 3, 4, 5) — autofix not enabled for python (preview)';

describe('housekeep --dry-run parity', () => {

  it('AC1: dry-run summary equals real-run summary; no disk writes during dry-run', () => {
    const { repoDir, baseSha } = buildFixture();
    const ledger = mktemp('hr-ldg-');
    const args = ['--repo', repoDir, '--since', baseSha];

    const dryOut = run([...args, '--dry-run'], ledger);
    const drySummary = lastNonEmptyLine(dryOut);
    expect(drySummary).toBe(SUMMARY);

    const statusAfterDry = spawnSync('git', ['-C', repoDir, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(statusAfterDry.stdout.trim()).toBe('');

    const realOut = run(args, ledger);
    const realSummary = lastNonEmptyLine(realOut);
    expect(realSummary).toBe(SUMMARY);
    expect(drySummary).toBe(realSummary);
  });

  it('AC2: ledger byte-identical after dry-run; differs after real run', () => {
    const { repoDir, baseSha } = buildFixture();
    const ledger = mktemp('hr-ldg-');
    const ledgerFile = path.join(ledger, 'ledger.jsonl');
    const seed = '{"kind":"fix","file":"/tmp/old.ts","fixedHash":"abc","removed":["// seed"],"reason":"test","source":"housekeep","ts":"2024-01-01T00:00:00.000Z"}\n';
    fs.writeFileSync(ledgerFile, seed);
    const before = fs.readFileSync(ledgerFile);

    run(['--repo', repoDir, '--since', baseSha, '--dry-run'], ledger);
    const afterDry = fs.readFileSync(ledgerFile);
    expect(Buffer.compare(before, afterDry)).toBe(0);

    run(['--repo', repoDir, '--since', baseSha], ledger);
    const afterReal = fs.readFileSync(ledgerFile);
    expect(Buffer.compare(before, afterReal)).not.toBe(0);
  });

  it('AC3: needs-manual lines have exact identity and all match em-dash pattern', () => {
    const { repoDir, baseSha } = buildFixture();
    const ledger = mktemp('hr-ldg-');
    const stdout = run(['--repo', repoDir, '--since', baseSha, '--dry-run'], ledger);

    const manual = manualLines(stdout);
    expect(manual).toHaveLength(2);

    const svcLine = manual.find(l => l.includes('svc.go'));
    const pyLine  = manual.find(l => l.includes('tool.py'));
    expect(svcLine).toBe(MANUAL_SVC);
    expect(pyLine).toBe(MANUAL_PY);

    for (const line of manual) {
      expect(line).toMatch(/ — \S/);
    }
  });

  it('AC4: --diff output is git-apply-able; applied fix.ts matches real-run fix.ts', () => {
    const repoA = mktemp('hr-dryrA-');
    const repoB = mktemp('hr-dryrB-');
    const ledgerA = mktemp('hr-ldg-');
    const ledgerB = mktemp('hr-ldg-');

    for (const repoDir of [repoA, repoB]) {
      initRepo(repoDir);
      fs.writeFileSync(path.join(repoDir, 'svc.go'), SVC_BASE);
      addAndCommit(repoDir, ['svc.go'], 'base');
    }
    const baseShaA = git(repoA, ['rev-parse', 'HEAD']);
    const baseShaB = git(repoB, ['rev-parse', 'HEAD']);

    for (const repoDir of [repoA, repoB]) {
      fs.writeFileSync(path.join(repoDir, 'svc.go'), SVC_NEW);
      fs.writeFileSync(path.join(repoDir, 'fix.ts'), FIX_TS);
      fs.writeFileSync(path.join(repoDir, 'tool.py'), TOOL_PY);
      addAndCommit(repoDir, ['svc.go', 'fix.ts', 'tool.py'], 'add files');
    }

    const dryOut = run(['--repo', repoA, '--since', baseShaA, '--dry-run', '--diff'], ledgerA);
    expect(dryOut).toContain('--- a/fix.ts');
    expect(dryOut).toContain('+++ b/fix.ts');

    const diffContent = extractDiff(dryOut);
    expect(diffContent).toBeTruthy();
    const patchFile = path.join(mktemp('hr-patch-'), 'diff.patch');
    fs.writeFileSync(patchFile, diffContent);

    const applyResult = spawnSync('git', ['-C', repoA, 'apply', patchFile], { encoding: 'utf8' });
    expect(applyResult.status, `git apply failed: ${applyResult.stderr}`).toBe(0);

    run(['--repo', repoB, '--since', baseShaB], ledgerB);

    const fixTsA = fs.readFileSync(path.join(repoA, 'fix.ts'));
    const fixTsB = fs.readFileSync(path.join(repoB, 'fix.ts'));
    expect(Buffer.compare(fixTsA, fixTsB)).toBe(0);

    const trackedA = git(repoA, ['ls-files']).split('\n').filter(Boolean);
    for (const relPath of trackedA) {
      const bytesA = fs.readFileSync(path.join(repoA, relPath));
      const bytesB = fs.readFileSync(path.join(repoB, relPath));
      expect(Buffer.compare(bytesA, bytesB), `${relPath} differs`).toBe(0);
    }
  });

  it('AC5: --max 1 dry-run summary equals real-run; capped file line ends with --max limit reached', () => {
    const repoDir = mktemp('hr-max-');
    initRepo(repoDir);
    const baseSha = git(repoDir, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(repoDir, 'fix1.ts'), FIX_TS);
    fs.writeFileSync(path.join(repoDir, 'fix2.ts'), FIX_TS.replace(/c/g, 'd'));
    addAndCommit(repoDir, ['fix1.ts', 'fix2.ts'], 'add two fixable files');

    const ledgerDry = mktemp('hr-ldg-');
    const ledgerReal = mktemp('hr-ldg-');
    const args = ['--repo', repoDir, '--since', baseSha, '--max', '1'];

    const dryOut = run([...args, '--dry-run'], ledgerDry);
    const drySummary = lastNonEmptyLine(dryOut);
    expect(drySummary).toBe('1 fixed, 1 need manual fix');

    const dryManual = manualLines(dryOut);
    expect(dryManual).toHaveLength(1);
    expect(dryManual[0]).toMatch(/ — --max limit reached$/);

    const realOut = run(args, ledgerReal);
    const realSummary = lastNonEmptyLine(realOut);
    expect(realSummary).toBe(drySummary);

    const realManual = manualLines(realOut);
    expect(realManual).toHaveLength(1);
    expect(realManual[0]).toMatch(/ — --max limit reached$/);
  });

});
