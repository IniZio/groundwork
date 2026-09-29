import { describe, it, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectPreset,
  hasGitMessage,
  hasCommitlintConfig,
  readLastSubjects,
  CONVENTIONAL_SUBJECT_RE,
  PRESET_HANDBOOK,
  PRESET_CONVENTIONAL,
  PRESET_SUBJECT_ONLY,
} from '../../src/config/detect.mjs';

const env: NodeJS.ProcessEnv = { ...process.env };
delete env.CLAUDE_PROJECT_DIR;

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env, stdio: 'ignore' });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-detect-'));
  tmpDirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'user.email', 't@t.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, subject: string): void {
  git(dir, 'commit', '--allow-empty', '-q', '-m', subject);
}

function commitMany(dir: string, subject: (i: number) => string, count: number): void {
  for (let i = 0; i < count; i++) commit(dir, subject(i));
}

const HANDBOOK = { value: 'handbook', source: 'default' } as const;

describe('detectPreset', () => {
  it('constants have the documented string values', () => {
    expect(PRESET_HANDBOOK).toBe('handbook');
    expect(PRESET_CONVENTIONAL).toBe('conventional');
    expect(PRESET_SUBJECT_ONLY).toBe('subject-only');
  });

  it('.gitmessage yields subject-only from gitmessage', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitmessage'), '# template\n');
    expect(detectPreset(repo)).toEqual({ value: 'subject-only', source: 'gitmessage' });
  });

  it('commitlint.config.js yields conventional from commitlint', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'commitlint.config.js'), 'module.exports = {};\n');
    expect(detectPreset(repo)).toEqual({ value: 'conventional', source: 'commitlint' });
  });

  it('.commitlintrc.json yields conventional from commitlint', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.commitlintrc.json'), '{}\n');
    expect(detectPreset(repo)).toEqual({ value: 'conventional', source: 'commitlint' });
  });

  it('package.json with a commitlint key yields conventional from commitlint', () => {
    const repo = makeRepo();
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'x', commitlint: { extends: ['@commitlint/config-conventional'] } }),
    );
    expect(detectPreset(repo)).toEqual({ value: 'conventional', source: 'commitlint' });
  });

  it('package.json without a commitlint key is not commitlint', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'x' }));
    expect(detectPreset(repo)).toEqual(HANDBOOK);
  });

  it('history with exactly 10 of 20 conventional yields conventional from history', () => {
    const repo = makeRepo();
    commitMany(repo, (i) => `fix: thing ${i}`, 10);
    commitMany(repo, (i) => `Update thing ${i}`, 10);
    expect(detectPreset(repo)).toEqual({ value: 'conventional', source: 'history' });
  });

  it('history with 9 of 20 conventional falls back to handbook', () => {
    const repo = makeRepo();
    commitMany(repo, (i) => `fix: thing ${i}`, 9);
    commitMany(repo, (i) => `Update thing ${i}`, 11);
    expect(detectPreset(repo)).toEqual(HANDBOOK);
  });

  it('reads only the last 20 subjects', () => {
    const repo = makeRepo();
    commitMany(repo, (i) => `feat: old ${i}`, 20);
    commitMany(repo, (i) => `Update new ${i}`, 20);
    expect(detectPreset(repo)).toEqual(HANDBOOK);
  });

  it('empty repo without commits yields handbook default', () => {
    const repo = makeRepo();
    expect(detectPreset(repo)).toEqual(HANDBOOK);
  });

  it('null and empty string yield handbook default', () => {
    expect(detectPreset(null as unknown as string)).toEqual(HANDBOOK);
    expect(detectPreset('')).toEqual(HANDBOOK);
  });

  it('.gitmessage wins over commitlint config', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitmessage'), '# template\n');
    fs.writeFileSync(path.join(repo, 'commitlint.config.js'), 'module.exports = {};\n');
    expect(detectPreset(repo)).toEqual({ value: 'subject-only', source: 'gitmessage' });
  });

  it('commitlint config wins over non-conventional history', () => {
    const repo = makeRepo();
    commitMany(repo, (i) => `Update thing ${i}`, 5);
    fs.writeFileSync(path.join(repo, 'commitlint.config.js'), 'module.exports = {};\n');
    expect(detectPreset(repo)).toEqual({ value: 'conventional', source: 'commitlint' });
  });

  it('commitlint config wins over conventional history source label', () => {
    const repo = makeRepo();
    commitMany(repo, (i) => `feat: thing ${i}`, 5);
    fs.writeFileSync(path.join(repo, 'commitlint.config.js'), 'module.exports = {};\n');
    expect(detectPreset(repo).source).toBe('commitlint');
  });
});

describe('readLastSubjects', () => {
  it('excludes merge commits', () => {
    const repo = makeRepo();
    commit(repo, 'chore: base');
    git(repo, 'checkout', '-q', '-b', 'topic');
    commit(repo, 'feat: on topic');
    git(repo, 'checkout', '-q', '-');
    commit(repo, 'Update on main');
    git(repo, 'merge', '--no-ff', '-q', '-m', 'Merge branch topic', 'topic');
    const subjects = readLastSubjects(repo, 20);
    expect(subjects).toEqual(['Update on main', 'chore: base']);
  });

  it('returns an empty list for a repo with no commits', () => {
    expect(readLastSubjects(makeRepo(), 20)).toEqual([]);
  });
});

describe('helper exports', () => {
  it('hasGitMessage is false for empty and non-string input', () => {
    expect(hasGitMessage('')).toBe(false);
    expect(hasGitMessage(null)).toBe(false);
    expect(hasGitMessage(undefined)).toBe(false);
    expect(hasGitMessage(42)).toBe(false);
  });

  it('hasGitMessage and hasCommitlintConfig reflect files on disk', () => {
    const repo = makeRepo();
    expect(hasGitMessage(repo)).toBe(false);
    expect(hasCommitlintConfig(repo)).toBe(false);
    fs.writeFileSync(path.join(repo, '.gitmessage'), 'x\n');
    fs.writeFileSync(path.join(repo, '.commitlintrc.yml'), 'extends: []\n');
    expect(hasGitMessage(repo)).toBe(true);
    expect(hasCommitlintConfig(repo)).toBe(true);
  });

  it('CONVENTIONAL_SUBJECT_RE matches typed subjects only', () => {
    expect(CONVENTIONAL_SUBJECT_RE.test('feat(x): y')).toBe(true);
    expect(CONVENTIONAL_SUBJECT_RE.test('fix!: y')).toBe(true);
    expect(CONVENTIONAL_SUBJECT_RE.test('Fix: y')).toBe(false);
    expect(CONVENTIONAL_SUBJECT_RE.test('WIP: y')).toBe(false);
    expect(CONVENTIONAL_SUBJECT_RE.test('feat:y')).toBe(false);
  });
});
