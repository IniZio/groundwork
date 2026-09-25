import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from '../rules/stray-artifacts/index.js';
import type { RuleContext } from '../src/engine/types.js';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '..');
const CLI = path.join(PLUGIN_ROOT, 'src/cli/main.ts');
const GUARD = path.join(PLUGIN_ROOT, 'src/hooks/guard.ts');

const tmpDirs: string[] = [];

function mktemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-git-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function initRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'config', 'commit.gpgsign', 'false'], { cwd: dir });
}

function gitAdd(dir: string, ...files: string[]): void {
  spawnSync('git', ['add', ...files], { cwd: dir });
}

function gitCommit(dir: string, msg = 'init'): void {
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg, '--allow-empty'], { cwd: dir });
}

describe('stray-artifacts gitignore integration', () => {
  it('(a) tracked doc/ + gitignored docs/ → no finding', async () => {
    const repo = mktemp();
    initRepo(repo);

    fs.mkdirSync(path.join(repo, 'doc'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'doc/a.md'), '# doc\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'docs/\n');
    gitAdd(repo, 'doc/a.md', '.gitignore');
    gitCommit(repo);

    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/gen.html'), '<html/>\n');

    const ctx: RuleContext = {
      repoRoot: repo,
      mode: 'cli',
      files: [{ path: 'doc/a.md', tracked: true, sessionCreated: false }],
    };
    const findings = await rule.check(ctx);
    expect(findings, 'gitignored docs/ must not trigger coexistence finding').toHaveLength(0);
  });

  it('(b) tracked doc/ + untracked non-ignored docs/ → finding', async () => {
    const repo = mktemp();
    initRepo(repo);

    fs.mkdirSync(path.join(repo, 'doc'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'doc/a.md'), '# doc\n');
    gitAdd(repo, 'doc/a.md');
    gitCommit(repo);

    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/readme.md'), '# docs\n');

    const ctx: RuleContext = {
      repoRoot: repo,
      mode: 'cli',
      files: [{ path: 'doc/a.md', tracked: true, sessionCreated: false }],
    };
    const findings = await rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('doc/a.md');
    expect(findings[0].message).toContain('docs/');
  });
});

describe('stray-artifacts real-path probe (AC3)', () => {
  it('check exits 0: tracked doc/ + gitignored docs/ with modified file in scope', () => {
    const repo = mktemp();
    initRepo(repo);

    fs.mkdirSync(path.join(repo, 'doc'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'doc/a.md'), '# doc\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'docs/\n');
    gitAdd(repo, 'doc/a.md', '.gitignore');
    gitCommit(repo);

    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/gen.html'), '<html/>\n');

    // Modify doc/a.md so it appears in git diff HEAD
    fs.writeFileSync(path.join(repo, 'doc/a.md'), '# doc v2\n');

    const result = spawnSync('bun', [CLI, 'check'], { cwd: repo, encoding: 'utf8' });
    console.log('check stdout:', result.stdout.trim());
    console.log('check stderr:', result.stderr.trim());
    console.log('check exit:', result.status);
    expect(result.status).toBe(0);
  });

  it('guard allows Write to doc/b.md when docs/ is gitignored', () => {
    const repo = mktemp();
    initRepo(repo);

    fs.mkdirSync(path.join(repo, 'doc'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'doc/a.md'), '# doc\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'docs/\n');
    gitAdd(repo, 'doc/a.md', '.gitignore');
    gitCommit(repo);

    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs/gen.html'), '<html/>\n');

    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(repo, 'doc/b.md'), content: 'x' },
      cwd: repo,
    });

    const result = spawnSync('bun', [GUARD], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });

    console.log('guard stdout:', result.stdout.trim());
    console.log('guard stderr:', result.stderr.trim());
    console.log('guard exit:', result.status);

    const out = result.stdout.trim();
    if (out) {
      const parsed = JSON.parse(out) as Record<string, unknown>;
      const hookOut = parsed?.hookSpecificOutput as Record<string, unknown> | undefined;
      const decision = hookOut?.permissionDecision;
      expect(decision, 'guard must allow, not deny').not.toBe('deny');
    }
    expect(result.status).toBe(0);
  });
});
