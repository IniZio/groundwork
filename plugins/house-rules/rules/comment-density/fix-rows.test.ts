import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import rule from './index.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';
import { atomicWrite, normalizeTrailingNewline } from '../../src/hooks/lib/atomic-write.js';

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'fix-rows-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { }
  }
  tmpDirs = [];
});

function initGitRepo(dir: string): void {
  const o = { cwd: dir, encoding: 'utf8' as const };
  spawnSync('git', ['init'], o);
  spawnSync('git', ['config', 'user.email', 't@t.com'], o);
  spawnSync('git', ['config', 'user.name', 'T'], o);
}

function gitCommit(dir: string, msg: string): void {
  const o = { cwd: dir, encoding: 'utf8' as const };
  spawnSync('git', ['add', '-A'], o);
  spawnSync('git', ['commit', '--allow-empty', '-m', msg], o);
}

const CODE_LINES = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`);

describe('fix-rows: rule fix() with real git repo', () => {
  it('added comments at END of file: pre-existing comment kept, added removed', async () => {
    const dir = makeTmpDir();
    initGitRepo(dir);

    const baseLines = ['// pre-existing rationale', ...CODE_LINES];
    const baseText = baseLines.join('\n') + '\n';
    const fname = 'target.ts';
    const fp = path.join(dir, fname);
    writeFileSync(fp, baseText);
    gitCommit(dir, 'base');

    const addedComments = Array.from({ length: 10 }, (_, i) => `// added comment ${i}`);
    const postText = baseText + addedComments.join('\n') + '\n';
    writeFileSync(fp, postText);

    const hunks = diffTextToHunks(baseText, postText);
    expect(hunks.length).toBeGreaterThan(0);

    const result = await rule.fix!({
      repoRoot: dir,
      mode: 'cli',
      files: [{ path: fname, text: postText, baseText, addedHunks: hunks }],
    });

    expect(result.fixed).toBe(1);
    expect(result.skipped).toBe(0);
    const actual = readFileSync(fp, 'utf8');
    expect(actual).toBe(baseText);
  });

  it('added comments at TOP of file: added removed, pre-existing code kept', async () => {
    const dir = makeTmpDir();
    initGitRepo(dir);

    const baseText = CODE_LINES.join('\n') + '\n';
    const fname = 'target-top.ts';
    const fp = path.join(dir, fname);
    writeFileSync(fp, baseText);
    gitCommit(dir, 'base');

    const addedComments = Array.from({ length: 10 }, (_, i) => `// top comment ${i}`);
    const postText = addedComments.join('\n') + '\n' + baseText;
    writeFileSync(fp, postText);

    const hunks = diffTextToHunks(baseText, postText);
    expect(hunks.length).toBeGreaterThan(0);

    const result = await rule.fix!({
      repoRoot: dir,
      mode: 'cli',
      files: [{ path: fname, text: postText, baseText, addedHunks: hunks }],
    });

    expect(result.fixed).toBe(1);
    expect(result.skipped).toBe(0);
    const actual = readFileSync(fp, 'utf8');
    expect(actual).toBe(baseText);
  });
});

describe('fix-rows: stale snapshot vs disk', () => {
  it('skips file when disk content differs from snapshot text', async () => {
    const dir = makeTmpDir();
    initGitRepo(dir);

    const baseText = '';
    const addedCode = Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
    const addedComments = Array.from({ length: 10 }, (_, i) => `// comment ${i}`).join('\n') + '\n';
    const snapshotText = addedCode + addedComments;

    const fname = 'stale.ts';
    const fp = path.join(dir, fname);
    writeFileSync(fp, baseText);
    gitCommit(dir, 'base');

    const hunks = diffTextToHunks(baseText, snapshotText);
    expect(hunks.length).toBeGreaterThan(0);

    // simulate file changed on disk after context snapshot was built
    const newerDiskText = snapshotText + 'export function added() {}\n';
    writeFileSync(fp, newerDiskText);

    const result = await rule.fix!({
      repoRoot: dir,
      mode: 'cli',
      files: [{ path: fname, text: snapshotText, baseText, addedHunks: hunks }],
    });

    expect(result.skipped).toBe(1);
    expect(result.fixed).toBe(0);
    expect(readFileSync(fp, 'utf8')).toBe(newerDiskText);
  });
});

describe('fix-rows: atomicWrite helper', () => {
  it('write succeeds and file contains expected content', async () => {
    const dir = makeTmpDir();
    const fp = path.join(dir, 'aw.ts');
    const original = 'const a = 1;\n';
    writeFileSync(fp, original);
    const { createHash } = await import('node:crypto');
    const origHash = createHash('sha256').update(original, 'utf8').digest('hex');
    const newContent = 'const a = 2;\n';
    const wr = atomicWrite(fp, newContent, origHash);
    expect(wr.ok).toBe(true);
    expect(readFileSync(fp, 'utf8')).toBe(newContent);
  });

  it('fails when tmp is tampered after write (verifyContent mismatch)', async () => {
    const dir = makeTmpDir();
    const fp = path.join(dir, 'tamper.ts');
    const original = 'const a = 1;\n';
    writeFileSync(fp, original);
    const { createHash } = await import('node:crypto');
    const origHash = createHash('sha256').update(original, 'utf8').digest('hex');
    const newContent = 'const a = 2;\n';
    const tampered = 'const a = 999;\n';
    const wr = atomicWrite(fp, newContent, origHash, {
      afterTmpWrite: (tmp) => { writeFileSync(tmp, tampered); },
      verifyContent: newContent,
    });
    expect(wr.ok).toBe(false);
    expect(wr.ok === false && wr.reason).toMatch(/mismatch/);
    expect(readFileSync(fp, 'utf8')).toBe(original);
  });

  it('fails when file changed on disk before rename', async () => {
    const dir = makeTmpDir();
    const fp = path.join(dir, 'changed.ts');
    const original = 'const a = 1;\n';
    writeFileSync(fp, original);
    const { createHash } = await import('node:crypto');
    const origHash = createHash('sha256').update(original, 'utf8').digest('hex');
    const newContent = 'const a = 2;\n';
    const wr = atomicWrite(fp, newContent, origHash, {
      afterTmpWrite: (_tmp, dest) => { writeFileSync(dest, 'const a = RACE;\n'); },
    });
    expect(wr.ok).toBe(false);
    expect(wr.ok === false && wr.reason).toMatch(/changed on disk/);
  });

  it('normalizeTrailingNewline adds newline when missing', () => {
    expect(normalizeTrailingNewline('abc', true)).toBe('abc\n');
  });

  it('normalizeTrailingNewline strips newline when original had none', () => {
    expect(normalizeTrailingNewline('abc\n', false)).toBe('abc');
  });
});
