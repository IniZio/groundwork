import { describe, it, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveConfig,
  pointer,
  DEFAULT_SEVERITY,
  DEFAULT_MAX_PER_100,
} from '../../src/config/resolve.mjs';
import { ConfigError } from '../../src/config/schema.mjs';
import { BUILTIN_POLICY } from '../../src/engine/policy.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-resolve-'));
  tmpDirs.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'user.email', 't@t.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commits(dir: string, subjects: string[]): void {
  for (const s of subjects) git(dir, 'commit', '--allow-empty', '-q', '-m', s);
}

function writeConfig(dir: string, body: unknown): string {
  const file = path.join(dir, '.house-rules.json');
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

const CONVENTIONAL_HISTORY = ['feat: a', 'feat: b', 'feat: c', 'misc change'];

const ALL_DEFAULTS = {
  file: null,
  rules: {
    'commit-message': {
      severity: 'error',
      options: { preset: 'handbook' },
      sources: { severity: 'default', preset: 'default' },
    },
    'comment-density': {
      severity: 'error',
      options: { max_per_100: 5 },
      sources: { severity: 'default', max_per_100: 'default' },
    },
    'stray-artifacts': {
      severity: 'error',
      options: {},
      sources: { severity: 'default' },
    },
  },
} as const;

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('resolveConfig defaults', () => {
  it('no file and empty history resolves to all defaults', () => {
    const repo = makeRepo();
    expect(resolveConfig(repo)).toEqual(ALL_DEFAULTS);
  });

  it('default constants match documented values', () => {
    expect(DEFAULT_SEVERITY).toBe('error');
    expect(DEFAULT_MAX_PER_100).toBe(5);
  });

  it('default severities match BUILTIN_POLICY', () => {
    const { rules } = resolveConfig(makeRepo());
    expect(rules['comment-density'].severity).toEqual(BUILTIN_POLICY['comment-density'].severity);
    expect(rules['stray-artifacts'].severity).toEqual(BUILTIN_POLICY['stray-artifacts'].severity);
    expect(rules['commit-message'].severity).toEqual('error');
  });
});

describe('resolveConfig preset precedence', () => {
  it('empty rules file still lets history detection pick the preset', () => {
    const repo = makeRepo();
    commits(repo, CONVENTIONAL_HISTORY);
    const file = writeConfig(repo, { rules: {} });
    const resolved = resolveConfig(repo);
    expect(resolved.file).toEqual(file);
    expect(resolved.rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'conventional' },
      sources: { severity: 'default', preset: 'history' },
    });
  });

  it('explicit severity keeps history-detected preset', () => {
    const repo = makeRepo();
    commits(repo, CONVENTIONAL_HISTORY);
    writeConfig(repo, { rules: { 'commit-message': 'error' } });
    expect(resolveConfig(repo).rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'conventional' },
      sources: { severity: 'explicit', preset: 'history' },
    });
  });

  it('explicit preset beats .gitmessage', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitmessage'), '# template\n');
    writeConfig(repo, { rules: { 'commit-message': ['error', { preset: 'handbook' }] } });
    expect(resolveConfig(repo).rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'handbook' },
      sources: { severity: 'explicit', preset: 'explicit' },
    });
  });

  it('.gitmessage alone yields subject-only', () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, '.gitmessage'), '# template\n');
    expect(resolveConfig(repo).rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'subject-only' },
      sources: { severity: 'default', preset: 'gitmessage' },
    });
  });
});

describe('resolveConfig comment-density', () => {
  it('explicit severity and max_per_100', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'comment-density': ['warn', { max_per_100: 8 }] } });
    expect(resolveConfig(repo).rules['comment-density']).toEqual({
      severity: 'warn',
      options: { max_per_100: 8 },
      sources: { severity: 'explicit', max_per_100: 'explicit' },
    });
  });

  it('off alone leaves max_per_100 at default', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'comment-density': 'off' } });
    expect(resolveConfig(repo).rules['comment-density']).toEqual({
      severity: 'off',
      options: { max_per_100: 5 },
      sources: { severity: 'explicit', max_per_100: 'default' },
    });
  });
});

describe('pointer', () => {
  it('describes default preset', () => {
    const resolved = resolveConfig(makeRepo());
    expect(pointer(resolved, 'commit-message', 'preset')).toBe(
      'rules["commit-message"].preset (active: handbook, source: default)',
    );
  });

  it('describes default severity', () => {
    const resolved = resolveConfig(makeRepo());
    expect(pointer(resolved, 'stray-artifacts', 'severity')).toBe(
      'rules["stray-artifacts"] (active: error, source: default)',
    );
  });

  it('describes explicit option', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'comment-density': ['warn', { max_per_100: 8 }] } });
    expect(pointer(resolveConfig(repo), 'comment-density', 'max_per_100')).toBe(
      'rules["comment-density"].max_per_100 (active: 8, source: explicit)',
    );
  });
});

describe('resolveConfig invalid files', () => {
  it('out-of-range option throws ConfigError naming file and key', () => {
    const repo = makeRepo();
    const file = writeConfig(repo, {
      rules: { 'comment-density': ['warn', { max_per_100: 999 }] },
    });
    const err = caught(() => resolveConfig(repo));
    expect(err).toBeInstanceOf(ConfigError);
    const e = err as ConfigError & { file: string };
    expect(e.file).toEqual(file);
    expect(e.message).toContain(file);
    expect(e.message).toContain('max_per_100');
  });

  it('malformed JSON throws ConfigError with file', () => {
    const repo = makeRepo();
    const file = writeConfig(repo, '{ not json');
    const err = caught(() => resolveConfig(repo));
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError & { file: string }).file).toEqual(file);
  });
});
