/**
 * MSG-01: every registry language is now stable autofix, so files with syntax errors get the
 * syntax-error reason through the CLI. The "autofix not supported for <lang>" precedence branch
 * (preview language wins over syntax-error text) is covered in-process by forcing rust to preview
 * via runHousekeep's testOnly_fixTableOverride.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runHousekeep } from '../../src/cli/housekeep.js';

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

// Rust: 2 comment lines + 1 syntax-error line = 66% comments (well over 5% CAP).
const RUST_OVER_BUDGET_WITH_ERROR = [
  '// comment one',
  '// comment two',
  '@@@ broken;',
].join('\n') + '\n';

// Python: 2 comment lines + 1 syntax-error line = 66% comments.
const PY_OVER_BUDGET_WITH_ERROR = [
  '# comment one',
  '# comment two',
  'def broken(:',
].join('\n') + '\n';

function captureRunHousekeep(opts: Parameters<typeof runHousekeep>[0]): Promise<string> {
  return new Promise(async (resolve) => {
    let output = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    const origExit = process.exit.bind(process);
    const restore = () => {
      process.stdout.write = origWrite;
      (process as unknown as Record<string, unknown>).exit = origExit;
    };
    process.stdout.write = (chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };
    (process as unknown as Record<string, unknown>).exit = () => {
      restore();
      resolve(output);
    };
    try {
      await runHousekeep(opts);
    } catch {
      // fall through: output captured so far is the observable result
    }
    restore();
    resolve(output);
  });
}

const RUST_PREVIEW_OVERRIDE = { testOnly_fixTableOverride: { rust: { stability: 'preview', applicability: 'safe' } } };

describe('syntax-error reason for autofix languages (MSG-01)', () => {
  it('diff mode: rust (stable autofix) file with syntax errors gets the syntax-error reason, not "autofix not supported"', () => {
    const repoDir = mktemp('hr-msg01-rust-diff-');
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'query.rs'), RUST_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.rs'], 'add over-budget rust with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    expect(r.stdout).toContain('syntax errors on rows');
    expect(r.stdout).not.toContain('autofix not supported for rust');
    // file must not be rewritten
    expect(fs.readFileSync(path.join(repoDir, 'query.rs'), 'utf8')).toBe(RUST_OVER_BUDGET_WITH_ERROR);
  });

  it('--all mode: rust (stable autofix) file with syntax errors gets the syntax-error reason, not "autofix not supported"', () => {
    const repoDir = mktemp('hr-msg01-rust-all-');
    initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'query.rs'), RUST_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.rs'], 'add over-budget rust with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--all', '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    expect(r.stdout).toContain('syntax errors on rows');
    expect(r.stdout).not.toContain('autofix not supported for rust');
    expect(fs.readFileSync(path.join(repoDir, 'query.rs'), 'utf8')).toBe(RUST_OVER_BUDGET_WITH_ERROR);
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

describe('preview language precedence over syntax-error reason (MSG-01, in-process)', () => {
  it('diff mode: rust forced to preview via override with syntax errors gets "autofix not supported for rust", not the syntax-error reason', async () => {
    const repoDir = mktemp('hr-msg01-rust-preview-diff-');
    const baseSha = initRepo(repoDir);
    fs.writeFileSync(path.join(repoDir, 'query.rs'), RUST_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.rs'], 'add over-budget rust with syntax error');

    const out = await captureRunHousekeep({ repo: repoDir, since: baseSha, testOnly: RUST_PREVIEW_OVERRIDE });

    expect(out).toContain('autofix not supported for rust');
    expect(out).not.toContain('syntax errors on rows');
    expect(fs.readFileSync(path.join(repoDir, 'query.rs'), 'utf8')).toBe(RUST_OVER_BUDGET_WITH_ERROR);
  });

  it('--all mode: rust forced to preview via override with syntax errors gets "autofix not supported for rust", not the syntax-error reason', async () => {
    const repoDir = mktemp('hr-msg01-rust-preview-all-');
    initRepo(repoDir);
    fs.writeFileSync(path.join(repoDir, 'query.rs'), RUST_OVER_BUDGET_WITH_ERROR);
    addAndCommit(repoDir, ['query.rs'], 'add over-budget rust with syntax error');

    const out = await captureRunHousekeep({ repo: repoDir, all: true, testOnly: RUST_PREVIEW_OVERRIDE });

    expect(out).toContain('autofix not supported for rust');
    expect(out).not.toContain('syntax errors on rows');
    expect(fs.readFileSync(path.join(repoDir, 'query.rs'), 'utf8')).toBe(RUST_OVER_BUDGET_WITH_ERROR);
  });
});
