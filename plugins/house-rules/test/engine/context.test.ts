import { describe, it, expect, afterEach } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContext } from '../../src/engine/context.js';

const tmpRoots: string[] = [];

function tmpDir(label: string): string {
  const d = path.join(os.tmpdir(), `gw-ctx-${label}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  tmpRoots.push(d);
  return d;
}

afterEach(() => {
  for (const r of tmpRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ }
  }
  tmpRoots.length = 0;
});

function initRepo(dir: string): void {
  execSync('command git init', { cwd: dir, shell: '/bin/bash' });
  execSync('command git config user.email "t@t.com"', { cwd: dir, shell: '/bin/bash' });
  execSync('command git config user.name "T"', { cwd: dir, shell: '/bin/bash' });
}

function commit(dir: string, msg: string, date?: string): string {
  execSync('command git add -A', { cwd: dir, shell: '/bin/bash' });
  const envPrefix = date ? `GIT_COMMITTER_DATE="${date}" GIT_AUTHOR_DATE="${date}"` : '';
  const dateFlag = date ? `--date="${date}"` : '';
  execSync(`${envPrefix} command git commit ${dateFlag} -m "${msg}"`, { cwd: dir, shell: '/bin/bash' });
  return execSync('command git rev-parse HEAD', { cwd: dir, shell: '/bin/bash' }).toString().trim();
}

/** Minimal JSONL transcript line: a user message with timestamp. */
function makeUserLine(ts: string): string {
  return JSON.stringify({ type: 'user', timestamp: ts, uuid: 't1' }) + '\n';
}

/** JSONL line: an assistant message with a single Write tool_use for the given absolute path. */
function makeWriteLine(absFilePath: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        name: 'Write',
        input: { file_path: absFilePath, content: '' },
      }],
    },
  }) + '\n';
}

/** JSONL line: an assistant message with a single Edit tool_use for the given absolute path. */
function makeEditLine(absFilePath: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        name: 'Edit',
        input: { file_path: absFilePath, old_string: '', new_string: '' },
      }],
    },
  }) + '\n';
}

// ---------------------------------------------------------------------------
// AC1: guard mode
// ---------------------------------------------------------------------------

describe('buildContext — guard mode', () => {
  it('returns text, lang, baseText, addedHunks, tracked, sessionCreated for a tracked file', () => {
    const repo = tmpDir('guard');
    initRepo(repo);
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'foo.ts'), 'const x = 1;\n');
    const sha = commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    const ctx = buildContext({
      repoRoot: repo,
      mode: 'guard',
      files: ['src/foo.ts'],
      base: sha,
      postText: 'const x = 2;\n',
    });

    expect(ctx.mode).toBe('guard');
    expect(ctx.files).toHaveLength(1);
    const f = ctx.files![0];
    expect(f.path).toBe('src/foo.ts');
    expect(f.text).toBe('const x = 2;\n');
    expect(f.lang).toBe('typescript');
    expect(f.baseText).toBe('const x = 1;\n');
    expect(f.addedHunks).toBeDefined();
    expect(f.addedHunks!.length).toBeGreaterThan(0);
    // The added hunk should contain line 1 (the changed line)
    const allAdded = f.addedHunks!.flatMap((h) => h.added);
    expect(allAdded).toContain(1);
    expect(f.tracked).toBe(true);
    expect(f.sessionCreated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC1: cli mode
// ---------------------------------------------------------------------------

describe('buildContext — cli mode', () => {
  it('returns text, lang, baseText, addedHunks, tracked, sessionCreated for a committed change', () => {
    const repo = tmpDir('cli');
    initRepo(repo);
    writeFileSync(path.join(repo, 'bar.ts'), 'export const a = 1;\n');
    const baseSha = commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    writeFileSync(path.join(repo, 'bar.ts'), 'export const a = 2;\n');
    commit(repo, 'change', '2026-01-02T00:00:00+00:00');

    const ctx = buildContext({ repoRoot: repo, mode: 'cli', base: baseSha });

    expect(ctx.mode).toBe('cli');
    const f = ctx.files!.find((x) => x.path === 'bar.ts');
    expect(f).toBeDefined();
    expect(f!.text).toBe('export const a = 2;\n');
    expect(f!.lang).toBe('typescript');
    expect(f!.baseText).toBe('export const a = 1;\n');
    expect(f!.addedHunks).toBeDefined();
    expect(f!.addedHunks!.length).toBeGreaterThan(0);
    expect(f!.tracked).toBe(true);
    expect(f!.sessionCreated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2: gate/cli parity
// ---------------------------------------------------------------------------

describe('buildContext — gate vs cli addedHunks parity', () => {
  it('gate-mode and cli-mode addedHunks are deep-equal for the same committed change', () => {
    const repo = tmpDir('parity');
    initRepo(repo);
    writeFileSync(path.join(repo, 'parity.ts'), 'line 1\n');
    const baseSha = commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    writeFileSync(path.join(repo, 'parity.ts'), 'line 1\nline 2\n');
    commit(repo, 'change', '2026-01-02T00:00:00+00:00');

    const absFilePath = path.join(repo, 'parity.ts');
    const transcriptPath = path.join(repo, 'transcript.jsonl');
    // Transcript: user line (for sessionBase) + Edit so touchedFiles picks up the file
    writeFileSync(
      transcriptPath,
      makeUserLine('2026-01-01T06:00:00Z') + makeEditLine(absFilePath),
    );

    const ctxGate = buildContext({
      repoRoot: repo,
      mode: 'gate',
      transcriptPath,
      sessionId: 's1',
      base: baseSha,
    });

    const ctxCli = buildContext({
      repoRoot: repo,
      mode: 'cli',
      base: baseSha,
    });

    const gateFile = ctxGate.files!.find((x) => x.path === 'parity.ts');
    const cliFile = ctxCli.files!.find((x) => x.path === 'parity.ts');

    expect(gateFile).toBeDefined();
    expect(cliFile).toBeDefined();
    expect(gateFile!.addedHunks).toBeDefined();
    expect(cliFile!.addedHunks).toBeDefined();
    expect(gateFile!.addedHunks).toEqual(cliFile!.addedHunks);
  });
});

// ---------------------------------------------------------------------------
// AC3: session-created file included in gate; untracked excluded in gate/cli
// ---------------------------------------------------------------------------

describe('buildContext — untracked / session-created file scoping', () => {
  it('gate mode: session-created (Write) untracked file is included with sessionCreated=true', () => {
    const repo = tmpDir('gate-sc');
    initRepo(repo);
    writeFileSync(path.join(repo, 'existing.ts'), 'export {};\n');
    commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    // Create an untracked new file (not git-added)
    const newFileAbs = path.join(repo, 'new-file.ts');
    writeFileSync(newFileAbs, 'export const x = 1;\n');

    // Transcript: user line + Write for new-file.ts
    const transcriptPath = path.join(repo, 'transcript.jsonl');
    writeFileSync(
      transcriptPath,
      makeUserLine('2026-01-01T06:00:00Z') + makeWriteLine(newFileAbs),
    );

    const ctx = buildContext({
      repoRoot: repo,
      mode: 'gate',
      transcriptPath,
      sessionId: 'test-session',
    });

    const f = ctx.files!.find((x) => x.path === 'new-file.ts');
    expect(f).toBeDefined();
    expect(f!.tracked).toBe(false);
    expect(f!.sessionCreated).toBe(true);
  });

  it('gate mode: plain untracked non-session file is excluded', () => {
    const repo = tmpDir('gate-excl');
    initRepo(repo);
    writeFileSync(path.join(repo, 'existing.ts'), 'export {};\n');
    commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    // Create an untracked file NOT mentioned in transcript as a Write
    writeFileSync(path.join(repo, 'orphan.ts'), 'export const x = 1;\n');

    // Transcript without any Write for orphan.ts
    const transcriptPath = path.join(repo, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeUserLine('2026-01-01T06:00:00Z'));

    const ctx = buildContext({
      repoRoot: repo,
      mode: 'gate',
      transcriptPath,
      sessionId: 'test-session',
    });

    const f = ctx.files?.find((x) => x.path === 'orphan.ts');
    expect(f).toBeUndefined();
  });

  it('cli mode: untracked files are excluded', () => {
    const repo = tmpDir('cli-excl');
    initRepo(repo);
    writeFileSync(path.join(repo, 'tracked.ts'), 'export const x = 1;\n');
    const baseSha = commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    // Commit a change to the tracked file
    writeFileSync(path.join(repo, 'tracked.ts'), 'export const x = 2;\n');
    commit(repo, 'change', '2026-01-02T00:00:00+00:00');

    // Add an untracked file
    writeFileSync(path.join(repo, 'untracked.ts'), 'hello\n');

    const ctx = buildContext({ repoRoot: repo, mode: 'cli', base: baseSha });

    const untracked = ctx.files?.find((x) => x.path === 'untracked.ts');
    expect(untracked).toBeUndefined();

    const tracked = ctx.files?.find((x) => x.path === 'tracked.ts');
    expect(tracked).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CLAUDE_PROJECT_DIR independence
// ---------------------------------------------------------------------------

describe('buildContext — CLAUDE_PROJECT_DIR independence', () => {
  it('result is determined by repoRoot, not CLAUDE_PROJECT_DIR', () => {
    const repo = tmpDir('cwd-indep');
    initRepo(repo);
    writeFileSync(path.join(repo, 'foo.ts'), 'const x = 1;\n');
    const baseSha = commit(repo, 'init', '2026-01-01T00:00:00+00:00');

    writeFileSync(path.join(repo, 'foo.ts'), 'const x = 2;\n');
    commit(repo, 'change', '2026-01-02T00:00:00+00:00');

    const origCPD = process.env['CLAUDE_PROJECT_DIR'];
    process.env['CLAUDE_PROJECT_DIR'] = os.tmpdir(); // set to unrelated dir

    let ctx;
    try {
      ctx = buildContext({ repoRoot: repo, mode: 'cli', base: baseSha });
    } finally {
      if (origCPD === undefined) {
        delete process.env['CLAUDE_PROJECT_DIR'];
      } else {
        process.env['CLAUDE_PROJECT_DIR'] = origCPD;
      }
    }

    expect(ctx.repoRoot).toBe(repo);
    expect(ctx.files).toBeDefined();
    expect(ctx.files!.length).toBeGreaterThan(0);
    const f = ctx.files!.find((x) => x.path === 'foo.ts');
    expect(f).toBeDefined();
    expect(f!.text).toBe('const x = 2;\n');
  });
});
