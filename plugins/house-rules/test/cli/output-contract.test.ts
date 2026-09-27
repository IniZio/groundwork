import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');
const BIN = path.join(PLUGIN_ROOT, 'bin/house-rules');

const tempDirs: string[] = [];

function mktemp(prefix = 'hr-oc-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function initRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
    'commit', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function commitAll(dir: string, msg = 'files'): void {
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg], { cwd: dir });
}

function runBIN(args: string[], cwd: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDE_PROJECT_DIR' && v !== undefined) env[k] = v;
  }
  return spawnSync(BIN, args, { cwd, encoding: 'utf8', env });
}

const jqAvailable = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

function writeStub(rulesDir: string, id: string, opts: {
  perFile?: boolean;     // report finding per file (not just first)
  withFix?: boolean;     // rule has a fix method
  smartFix?: boolean;    // fix only works once (check passes if '// hr-fixed' present)
  declineFix?: boolean;  // fix returns 'declined'
  noFindings?: boolean;  // always returns []
} = {}): void {
  const ruleDir = path.join(rulesDir, id);
  fs.mkdirSync(ruleDir, { recursive: true });

  const { perFile = false, withFix = false, smartFix = false, declineFix = false, noFindings = false } = opts;
  const qid = JSON.stringify(id);

  let checkBody: string;
  if (noFindings) {
    checkBody = 'return [];';
  } else if (smartFix) {
    checkBody = `
    const f = (ctx.files ?? [])[0];
    if (!f) return [];
    if ((f.text ?? '').includes('// hr-fixed')) return [];
    return [{ ruleId: ${qid}, path: f.path, line: 1, message: 'stub finding', fingerprintBasis: f.path + '-${id}' }];`;
  } else if (perFile) {
    checkBody = `
    return (ctx.files ?? []).map(f => ({ ruleId: ${qid}, path: f.path, line: 1, message: 'stub finding', fingerprintBasis: f.path + '-${id}' }));`;
  } else {
    checkBody = `
    const f = (ctx.files ?? [])[0];
    if (!f) return [];
    return [{ ruleId: ${qid}, path: f.path, line: 1, message: 'stub finding', fingerprintBasis: f.path + '-${id}' }];`;
  }

  let fixMethod = '';
  if (withFix) {
    if (declineFix) {
      fixMethod = `,
  async fix(ctx) {
    const f = (ctx.files ?? [])[0];
    if (!f) return { fixed: 0, skipped: 0, files: [] };
    return { fixed: 0, skipped: 1, files: [{ path: f.path, status: 'declined', before: f.text ?? '', after: f.text ?? '', reason: 'rule declined' }] };
  }`;
    } else {
      fixMethod = `,
  async fix(ctx, opts) {
    const f = (ctx.files ?? [])[0];
    if (!f) return { fixed: 0, skipped: 0, files: [] };
    const before = f.text ?? '';
    const after = before + '// hr-fixed\\n';
    if (opts?.write !== false) {
      const absPath = require('path').join(ctx.repoRoot, f.path);
      require('fs').writeFileSync(absPath, after, 'utf8');
    }
    return { fixed: 1, skipped: 0, files: [{ path: f.path, status: 'fixed', before, after }] };
  }`;
    }
  }

  fs.writeFileSync(path.join(ruleDir, 'index.js'), `
const rule = {
  id: ${qid},
  meta: { description: 'stub' },
  vehicles: ['tree'],
  check(ctx) { ${checkBody}
  }${fixMethod}
};
export default rule;
`);
}

// Make a repo with one tracked file; return repoDir
function makeRepo(content = 'export const x = 1;\n'): string {
  const dir = mktemp();
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'src.ts'), content);
  commitAll(dir);
  return dir;
}

// ── AC1 ──────────────────────────────────────────────────────────────────────

describe('AC1: check --format json output shape', () => {
  it('parsed stdout has scope.base, numeric scope.files, and finding shape', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density');
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--format', 'json', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    const report = JSON.parse(r.stdout);

    expect(report.scope.base).toBeTruthy();
    expect(typeof report.scope.files).toBe('number');
    expect(report.findings.length).toBeGreaterThan(0);

    const f = report.findings[0];
    expect(f).toHaveProperty('ruleId');
    expect(f).toHaveProperty('path');
    expect(f).toHaveProperty('line');
    expect(f).toHaveProperty('severity');
    expect(f).toHaveProperty('message');
  });

  it.skipIf(!jqAvailable)(
    'jq -e validates scope and finding shape',
    () => {
      const rulesDir = mktemp('hr-rules-');
      writeStub(rulesDir, 'comment-density');
      const repoDir = makeRepo();

      const r = runBIN(
        ['check', '--all', '--format', 'json', '--rules-dir', rulesDir, '--repo', repoDir],
        repoDir,
      );
      const jqFilter =
        '.scope.base and (.scope.files|type=="number") and (.findings[0]|has("ruleId") and has("path") and has("line") and has("severity") and has("message"))';
      const jq = spawnSync('jq', ['-e', jqFilter], {
        input: r.stdout,
        encoding: 'utf8',
      });
      expect(jq.status).toBe(0);
    },
  );
});

// ── AC2 ──────────────────────────────────────────────────────────────────────

describe('AC2: housekeep dry-run vs real summaries equal', () => {
  it('summaries deep-equal and every manual reason is a non-empty string', () => {
    const rulesDir = mktemp('hr-rules-');
    // comment-density → error+autofix: goes to fixed
    writeStub(rulesDir, 'comment-density', { withFix: true });
    // stray-artifacts → error+no autofix: goes to manual
    writeStub(rulesDir, 'stray-artifacts');

    function makeFixture(): string {
      const dir = mktemp();
      initRepo(dir);
      fs.writeFileSync(path.join(dir, 'src.ts'), 'export const x = 1;\n');
      commitAll(dir);
      return dir;
    }

    const dryDir = makeFixture();
    const realDir = makeFixture();

    const dryR = runBIN(
      ['housekeep', '--all', '--format', 'json', '--rules-dir', rulesDir, '--repo', dryDir, '--dry-run'],
      dryDir,
    );
    const realR = runBIN(
      ['housekeep', '--all', '--format', 'json', '--rules-dir', rulesDir, '--repo', realDir],
      realDir,
    );

    const dryReport = JSON.parse(dryR.stdout);
    const realReport = JSON.parse(realR.stdout);

    expect(dryReport.summary).toEqual(realReport.summary);
    expect(dryReport.fixed.length).toBeGreaterThan(0);
    expect(dryReport.manual.length).toBeGreaterThan(0);

    for (const m of dryReport.manual) {
      expect(typeof m.reason).toBe('string');
      expect(m.reason.length).toBeGreaterThan(0);
    }
  });
});

// ── AC3 ──────────────────────────────────────────────────────────────────────

describe('AC3: exit code matrix', () => {
  it('clean repo exits 0', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density', { noFindings: true });
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(r.status).toBe(0);
  });

  it('warn-only finding exits 0', () => {
    const rulesDir = mktemp('hr-rules-');
    // custom id not in BUILTIN_POLICY → warn severity
    writeStub(rulesDir, 'my-custom-warn-rule');
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(r.status).toBe(0);
  });

  it('error-severity finding exits 1', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density');
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(r.status).toBe(1);
  });

  it('check --fix where all findings are fixable exits 0 and changes file on disk', () => {
    const rulesDir = mktemp('hr-rules-');
    // smart: check returns finding unless '// hr-fixed' present; fix appends it
    writeStub(rulesDir, 'comment-density', { withFix: true, smartFix: true });
    const repoDir = makeRepo();

    const filePath = path.join(repoDir, 'src.ts');
    const before = fs.readFileSync(filePath, 'utf8');

    const r = runBIN(
      ['check', '--fix', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );

    const after = fs.readFileSync(filePath, 'utf8');
    expect(r.status).toBe(0);
    expect(after).not.toBe(before);
  });

  it('check --fix with an unfixable error finding exits 1', () => {
    const rulesDir = mktemp('hr-rules-');
    // stray-artifacts → error, no autofix → finding remains → exit 1
    writeStub(rulesDir, 'stray-artifacts');
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--fix', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(r.status).toBe(1);
  });

  it('unknown flag --bogus exits 2 and stderr mentions --bogus', () => {
    const repoDir = makeRepo();
    const r = runBIN(['check', '--bogus'], repoDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--bogus');
  });

  it('bad --base ref exits 2', () => {
    const repoDir = makeRepo();
    const r = runBIN(['check', '--base', 'nosuchref'], repoDir);
    expect(r.status).toBe(2);
  });

  it('baseline --fix is a usage error and exits 2', () => {
    const repoDir = makeRepo();
    const r = runBIN(['baseline', '--fix'], repoDir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--fix is only valid');
  });

  it('housekeep with unfixable error in manual exits 1', () => {
    const rulesDir = mktemp('hr-rules-');
    // stray-artifacts → error, no autofix → manual entry, error severity → exit 1
    writeStub(rulesDir, 'stray-artifacts');
    const repoDir = makeRepo();

    const r = runBIN(
      ['housekeep', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(r.status).toBe(1);
  });
});

// ── AC4 ──────────────────────────────────────────────────────────────────────

const SCOPE_HEADER_RE = /^house-rules: base=\S+ files=\d+$/m;

describe('AC4: scope header on stderr', () => {
  it('check text mode: stderr line 1 matches scope pattern', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density', { noFindings: true });
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    const firstLine = r.stderr.split('\n')[0];
    expect(firstLine).toMatch(/^house-rules: base=\S+ files=\d+$/);
  });

  it('housekeep text mode: stderr line 1 matches scope pattern', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density', { noFindings: true });
    const repoDir = makeRepo();

    const r = runBIN(
      ['housekeep', '--all', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    const firstLine = r.stderr.split('\n')[0];
    expect(firstLine).toMatch(/^house-rules: base=\S+ files=\d+$/);
  });

  it('json mode: stdout parses as JSON and stderr has no scope header', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density', { noFindings: true });
    const repoDir = makeRepo();

    const r = runBIN(
      ['check', '--all', '--format', 'json', '--rules-dir', rulesDir, '--repo', repoDir],
      repoDir,
    );
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr).not.toMatch(SCOPE_HEADER_RE);
  });
});

// ── AC5 ──────────────────────────────────────────────────────────────────────

describe('AC5: --help', () => {
  it('exits 0 and stdout lists required flags and exit codes', () => {
    const repoDir = makeRepo();
    const r = runBIN(['--help'], repoDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--all');
    expect(r.stdout).toContain('--fix');
    expect(r.stdout).toContain('--format');
    expect(r.stdout).toContain('--dry-run');
    expect(r.stdout).toContain('--diff');
    // exit codes documented
    expect(r.stdout).toMatch(/\b0\b/);
    expect(r.stdout).toMatch(/\b1\b/);
    expect(r.stdout).toMatch(/\b2\b/);
  });
});

// ── AC6 ──────────────────────────────────────────────────────────────────────

describe('AC6: diff-mode pathspec filters by file identity', () => {
  it('check with src/a.ts pathspec reports a.ts and not b.ts', () => {
    const rulesDir = mktemp('hr-rules-');
    writeStub(rulesDir, 'comment-density', { perFile: true });
    const repoDir = mktemp();
    initRepo(repoDir);

    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'src', 'b.ts'), 'export const b = 2;\n');
    commitAll(repoDir);

    // HEAD~1 is the init empty commit; both files are new in HEAD
    const r = runBIN(
      ['check', '--base', 'HEAD~1', '--rules-dir', rulesDir, '--repo', repoDir, 'src/a.ts'],
      repoDir,
    );

    expect(r.stdout).toContain('src/a.ts');
    expect(r.stdout).not.toContain('src/b.ts');
  });
});
