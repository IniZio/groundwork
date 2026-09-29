import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from '../rules/artifact-structure/index.js';
import type { RuleContext } from '../src/engine/types.js';
import { buildContext, detectBashCreatedDocs } from '../src/engine/context.js';

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

describe('artifact-structure gitignore integration', () => {
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

describe('artifact-structure real-path probe (AC3)', () => {
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

describe('Bash-created doc detection at gate', () => {
  const MANIFEST = {
    rules: {
      'artifact-structure': [
        'error',
        {
          govern: ['**/*.md'],
          types: { spec: { tier: 'product', generates: 'doc/spec/*.md' } },
        },
      ],
    },
  };
  const T0 = '2026-01-01T00:00:00.000Z';
  const T0_S = Date.parse(T0) / 1000;

  function setup(config: unknown = MANIFEST): { repo: string; transcript: string } {
    const repo = mktemp();
    initRepo(repo);
    fs.writeFileSync(path.join(repo, '.house-rules.json'), JSON.stringify(config));
    const transcript = path.join(path.dirname(repo), `${path.basename(repo)}.jsonl`);
    fs.writeFileSync(transcript, JSON.stringify({ type: 'user', timestamp: T0 }) + '\n');
    tmpDirs.push(transcript);
    return { repo, transcript };
  }

  function stamp(file: string, epochSec: number): void {
    fs.utimesSync(file, epochSec, epochSec);
  }

  // Never reassign process.env: in Bun it detaches from the real environ for the whole process.
  const ENV_KEYS = ['GIT_CONFIG_GLOBAL', 'CLAUDE_PROJECT_DIR'] as const;
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const setEnv = () => {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    delete process.env.CLAUDE_PROJECT_DIR;
  };
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('returns stray.md for an untracked governed file newer than the transcript start', () => {
    setEnv();
    const { repo, transcript } = setup();
    fs.writeFileSync(path.join(repo, 'stray.md'), 'x\n');
    stamp(path.join(repo, 'stray.md'), T0_S + 60);
    expect(detectBashCreatedDocs(repo, transcript)).toEqual(['stray.md']);
  });

  it('excludes the same file when it is gitignored', () => {
    setEnv();
    const { repo, transcript } = setup();
    fs.writeFileSync(path.join(repo, '.gitignore'), 'stray.md\n');
    fs.writeFileSync(path.join(repo, 'stray.md'), 'x\n');
    stamp(path.join(repo, 'stray.md'), T0_S + 60);
    expect(detectBashCreatedDocs(repo, transcript)).toEqual([]);
  });

  it('excludes an untracked file whose mtime predates session start', () => {
    setEnv();
    const { repo, transcript } = setup();
    fs.writeFileSync(path.join(repo, 'stray.md'), 'x\n');
    stamp(path.join(repo, 'stray.md'), T0_S - 3600);
    expect(detectBashCreatedDocs(repo, transcript)).toEqual([]);
  });

  it('excludes non-governed untracked files (src/a.ts)', () => {
    setEnv();
    const { repo, transcript } = setup();
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/a.ts'), 'x\n');
    stamp(path.join(repo, 'src/a.ts'), T0_S + 60);
    expect(detectBashCreatedDocs(repo, transcript)).toEqual([]);
  });

  it('returns [] when the config has no types', () => {
    setEnv();
    const { repo, transcript } = setup({ rules: { 'artifact-structure': ['error', { govern: ['**/*.md'] }] } });
    fs.writeFileSync(path.join(repo, 'stray.md'), 'x\n');
    stamp(path.join(repo, 'stray.md'), T0_S + 60);
    expect(detectBashCreatedDocs(repo, transcript)).toEqual([]);
  });

  it('fail-open: a throwing dependency yields [] (allow), never an exception', () => {
    setEnv();
    const { repo, transcript } = setup();
    const deps = { listUntracked: () => { throw new Error('boom'); } };
    expect(detectBashCreatedDocs(repo, transcript, deps)).toEqual([]);
  });

  it('fail-open at buildContext: throwing detection leaves gate scope empty without exception', () => {
    setEnv();
    const { repo, transcript } = setup();
    const ctx = buildContext({
      repoRoot: repo,
      mode: 'gate',
      transcriptPath: transcript,
      detectDeps: { listUntracked: () => { throw new Error('boom'); } },
    });
    expect(ctx.files).toEqual([]);
  });

  it('buildContext gate marks a Bash-created doc tracked:false sessionCreated:true', () => {
    setEnv();
    const { repo, transcript } = setup();
    fs.writeFileSync(path.join(repo, 'stray.md'), 'x\n');
    stamp(path.join(repo, 'stray.md'), T0_S + 60);
    const ctx = buildContext({ repoRoot: repo, mode: 'gate', transcriptPath: transcript });
    const f = ctx.files?.find((x) => x.path === 'stray.md');
    expect(f?.tracked).toBe(false);
    expect(f?.sessionCreated).toBe(true);
  });

  it('AC4: staged-added non-conforming notes/x.md is flagged; a committed-then-modified one is not', async () => {
    setEnv();
    const { repo } = setup();
    fs.mkdirSync(path.join(repo, 'notes'));
    fs.writeFileSync(path.join(repo, 'notes/x.md'), 'x\n');
    gitAdd(repo, 'notes/x.md');
    const added = await rule.check({
      repoRoot: repo,
      mode: 'gate',
      files: [{ path: 'notes/x.md', tracked: true, sessionCreated: true, baseText: '' }],
    });
    expect(added.some((f) => f.path === 'notes/x.md')).toBe(true);

    const repo2 = setup().repo;
    fs.mkdirSync(path.join(repo2, 'notes'));
    fs.writeFileSync(path.join(repo2, 'notes/x.md'), 'x\n');
    gitAdd(repo2, 'notes/x.md');
    gitCommit(repo2);
    fs.writeFileSync(path.join(repo2, 'notes/x.md'), 'x2\n');
    const modified = await rule.check({
      repoRoot: repo2,
      mode: 'gate',
      files: [{ path: 'notes/x.md', tracked: true, sessionCreated: false, baseText: 'x\n' }],
    });
    expect(modified.filter((f) => f.path === 'notes/x.md')).toHaveLength(0);
  });
});
