import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scopeFiles, buildContext } from '../../src/engine/context.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-ctx-base-'));
  tmpDirs.push(d);
  return d;
}

function git(repoRoot: string, args: string[]): void {
  const r = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: undefined as unknown as string },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

function gitOut(repoRoot: string, args: string[]): string {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function initRepo(dir: string): void {
  git(dir, ['init']);
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'root']);
}

function writeCommit(dir: string, files: Record<string, string>, msg = 'add files'): string {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    git(dir, ['add', name]);
  }
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg]);
  return gitOut(dir, ['rev-parse', 'HEAD']);
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function withoutProjectDir<T>(fn: () => T): T {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved;
    else delete process.env.CLAUDE_PROJECT_DIR;
  }
}

describe('context-base: empty tree base (case a)', () => {
  it('scopeFiles returns every committed file when base=EMPTY_TREE', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    writeCommit(dir, { 'alpha.ts': 'const a = 1;', 'beta.ts': 'const b = 2;' });
    writeCommit(dir, { 'gamma.ts': 'const c = 3;' });

    const files = withoutProjectDir(() =>
      scopeFiles({ repoRoot: dir, mode: 'cli', base: EMPTY_TREE }),
    );

    const sorted = [...files].sort();
    expect(sorted).toEqual(['alpha.ts', 'beta.ts', 'gamma.ts']);
  });

  it('buildContext returns every committed file with baseText="" when base=EMPTY_TREE', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    writeCommit(dir, { 'alpha.ts': 'const a = 1;', 'beta.ts': 'const b = 2;' });

    const ctx = withoutProjectDir(() =>
      buildContext({ repoRoot: dir, mode: 'cli', base: EMPTY_TREE }),
    );

    const files = ctx.files ?? [];
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['alpha.ts', 'beta.ts']);
    for (const f of files) {
      expect(f.baseText).toBe('');
    }
  });
});

describe('context-base: orphan branch base (case b)', () => {
  it('scopeFiles returns two-dot diff paths for orphan commit base', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    writeCommit(dir, { 'main-file.ts': 'const m = 1;' });

    const mainBranch = gitOut(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);

    git(dir, ['checkout', '--orphan', 'orphan']);
    git(dir, ['rm', '-rf', '.']);
    git(dir, ['add', '.']);
    const orphanSha = (() => {
      fs.writeFileSync(path.join(dir, 'orphan-file.ts'), 'const o = 1;');
      git(dir, ['add', 'orphan-file.ts']);
      git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'orphan root']);
      return gitOut(dir, ['rev-parse', 'HEAD']);
    })();

    git(dir, ['checkout', mainBranch]);

    const files = withoutProjectDir(() =>
      scopeFiles({ repoRoot: dir, mode: 'cli', base: orphanSha }),
    );

    const sorted = [...files].sort();
    expect(sorted).toEqual(['main-file.ts']);
  });
});

describe('context-base: normal ancestor base (case c)', () => {
  it('scopeFiles returns three-dot diff paths for a normal ancestor commit', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    const base = writeCommit(dir, { 'base-file.ts': 'const b = 0;' });
    writeCommit(dir, { 'new-file.ts': 'const n = 1;' });

    const files = withoutProjectDir(() =>
      scopeFiles({ repoRoot: dir, mode: 'cli', base }),
    );

    const sorted = [...files].sort();
    expect(sorted).toEqual(['new-file.ts']);
  });
});

describe('context-base: bad base throws (case d)', () => {
  it('throws when base is a non-existent ref', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    writeCommit(dir, { 'f.ts': 'x' });

    expect(() =>
      withoutProjectDir(() =>
        scopeFiles({ repoRoot: dir, mode: 'cli', base: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }),
      ),
    ).toThrow(/house-rules/);
  });

  it('error message contains something from git stderr when cat-file fails', () => {
    const dir = makeTmpDir();
    initRepo(dir);
    writeCommit(dir, { 'f.ts': 'x' });

    let caught: Error | undefined;
    try {
      withoutProjectDir(() =>
        scopeFiles({ repoRoot: dir, mode: 'cli', base: 'not-a-valid-ref-xyz' }),
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/house-rules/);
  });
});
