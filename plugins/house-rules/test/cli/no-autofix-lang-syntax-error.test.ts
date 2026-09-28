/**
 * MSG-01: preview-language files with syntax errors must get "autofix not supported for <lang>"
 * (not the syntax-error reason). Languages with autofix (python, kotlin) keep the syntax-error
 * reason unchanged.
 */
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

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
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
  for (const f of files) git(dir, ['add', f]);
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// SQL: 2 comment lines + 1 syntax-error line = 66% comments (well over 5% CAP).
const SQL_OVER_BUDGET_WITH_ERROR = [
  '-- comment one',
  '-- comment two',
  '@@@ broken;',
].join('\n') + '\n';

// Python: 2 comment lines + 1 syntax-error line = 66% comments.
const PY_OVER_BUDGET_WITH_ERROR = [
  '# comment one',
  '# comment two',
  'def broken(:',
].join('\n') + '\n';

describe('preview-lang syntax-error precedence (MSG-01)', () => {
  it('diff mode: sql file with syntax errors gets "autofix not supported for sql", no syntax-error text', () => {
    const repoDir = mktemp('hr-msg01-sql-diff-');
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'query.sql'), SQL_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.sql'], 'add over-budget sql with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    expect(r.stdout).toContain('autofix not supported for sql');
    expect(r.stdout).not.toContain('syntax errors on rows');
    // file must not be rewritten
    expect(fs.readFileSync(path.join(repoDir, 'query.sql'), 'utf8')).toBe(SQL_OVER_BUDGET_WITH_ERROR);
  });

  it('--all mode: sql file with syntax errors gets "autofix not supported for sql", no syntax-error text', () => {
    const repoDir = mktemp('hr-msg01-sql-all-');
    initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'query.sql'), SQL_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.sql'], 'add over-budget sql with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--all', '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    expect(r.stdout).toContain('autofix not supported for sql');
    expect(r.stdout).not.toContain('syntax errors on rows');
    expect(fs.readFileSync(path.join(repoDir, 'query.sql'), 'utf8')).toBe(SQL_OVER_BUDGET_WITH_ERROR);
  });

  it('positive control: python file with syntax errors gets syntax-error reason (autofix lang)', () => {
    const repoDir = mktemp('hr-msg01-py-');
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'bad.py'), PY_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['bad.py'], 'add over-budget python with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    expect(r.stdout).toContain('syntax errors on rows');
    expect(r.stdout).not.toContain('autofix not supported for python');
    expect(fs.readFileSync(path.join(repoDir, 'bad.py'), 'utf8')).toBe(PY_OVER_BUDGET_WITH_ERROR);
  });
});
