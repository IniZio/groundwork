import { describe, it, expect, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveConfig,
  resolveConfigText,
  pointer,
  DEFAULT_SEVERITY,
} from '../../src/config/resolve.mjs';
import type { ManifestOptions } from '../../src/config/resolve.mjs';
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
      options: {},
      sources: { severity: 'default' },
    },
    'artifact-structure': {
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
  });

  it('default severities match BUILTIN_POLICY', () => {
    const { rules } = resolveConfig(makeRepo());
    expect<string>(rules['comment-density'].severity).toEqual(BUILTIN_POLICY['comment-density'].severity);
    expect<string>(rules['artifact-structure'].severity).toEqual(BUILTIN_POLICY['artifact-structure'].severity);
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
  it('explicit severity has no options', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'comment-density': 'error' } });
    expect(resolveConfig(repo).rules['comment-density']).toEqual({
      severity: 'error',
      options: {},
      sources: { severity: 'explicit' },
    });
  });

  it('off severity is rejected', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'comment-density': 'off' } });
    const e = caught(() => resolveConfig(repo)) as ConfigError;
    expect(e).toBeInstanceOf(ConfigError);
    expect(e.path).toEqual('rules["comment-density"]');
    expect(e.message).toContain('invalid severity; allowed: error');
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
    expect(pointer(resolved, 'artifact-structure', 'severity')).toBe(
      'rules["artifact-structure"] (active: error, source: default)',
    );
  });

  it('describes explicit option', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'commit-message': ['error', { preset: 'conventional' }] } });
    expect(pointer(resolveConfig(repo), 'commit-message', 'preset')).toBe(
      'rules["commit-message"].preset (active: conventional, source: explicit)',
    );
  });
});

describe('resolveConfig rule aliases', () => {
  it('old stray-artifacts key resolves to artifact-structure with explicit source', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'stray-artifacts': 'error' } });
    const resolved = resolveConfig(repo);
    expect(resolved.rules['artifact-structure']).toEqual({
      severity: 'error',
      options: {},
      sources: { severity: 'explicit' },
    });
    expect('stray-artifacts' in resolved.rules).toBe(false);
  });

  it('both keys set throws ConfigError naming both ids', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'stray-artifacts': 'error', 'artifact-structure': 'error' } });
    const err = caught(() => resolveConfig(repo));
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as ConfigError).message;
    expect(msg).toContain('stray-artifacts');
    expect(msg).toContain('artifact-structure');
  });

  it('control: new id alone is accepted with explicit source', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'artifact-structure': 'error' } });
    const resolved = resolveConfig(repo);
    expect(resolved.rules['artifact-structure'].sources).toEqual({ severity: 'explicit' });
  });
});

describe('resolveConfig invalid files', () => {
  it('max_per_100 option throws ConfigError naming file and key', () => {
    const repo = makeRepo();
    const file = writeConfig(repo, {
      rules: { 'comment-density': ['error', { max_per_100: 999 }] },
    });
    const err = caught(() => resolveConfig(repo));
    expect(err).toBeInstanceOf(ConfigError);
    const e = err as ConfigError;
    expect(e.file).toEqual(file);
    expect(e.message).toContain(file);
    expect(e.path).toEqual('rules["comment-density"][1].max_per_100');
    expect(e.message).toContain('rules["comment-density"][1].max_per_100');
    expect(e.message).toContain('unknown option; allowed: no options');
  });

  it('malformed JSON throws ConfigError with file', () => {
    const repo = makeRepo();
    const file = writeConfig(repo, '{ not json');
    const err = caught(() => resolveConfig(repo));
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).file).toEqual(file);
  });
});

describe('resolveConfigText', () => {
  it('null text equals resolveConfig with no file', () => {
    const repo = makeRepo();
    const resolved = resolveConfigText(repo, null);
    expect(resolved).toEqual(resolveConfig(repo));
    expect(resolved).toEqual(ALL_DEFAULTS);
    expect(resolved.file).toBeNull();
    expect(resolved.rules['comment-density'].options).toEqual({});
  });

  it('explicit text reports the would-be file path with no file on disk', () => {
    const repo = makeRepo();
    const text = JSON.stringify({
      rules: {
        'commit-message': ['error', { preset: 'conventional' }],
        'comment-density': 'error',
      },
    });
    const resolved = resolveConfigText(repo, text);
    expect(fs.existsSync(path.join(repo, '.house-rules.json'))).toBe(false);
    expect(resolved.file).toEqual(path.join(repo, '.house-rules.json'));
    expect(resolved.rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'conventional' },
      sources: { severity: 'explicit', preset: 'explicit' },
    });
    expect(resolved.rules['comment-density']).toEqual({
      severity: 'error',
      options: {},
      sources: { severity: 'explicit' },
    });
  });

  it('matches resolveConfig when text is the on-disk file', () => {
    const repo = makeRepo();
    commits(repo, CONVENTIONAL_HISTORY);
    const file = writeConfig(repo, {
      rules: { 'comment-density': 'error', 'artifact-structure': ['error'] },
    });
    const resolved = resolveConfigText(repo, fs.readFileSync(file, 'utf8'));
    expect(resolved).toEqual(resolveConfig(repo));
    expect(resolved.rules['comment-density'].sources).toEqual({ severity: 'explicit' });
    expect(resolved.rules['artifact-structure'].sources).toEqual({ severity: 'explicit' });
  });

  it('uses the given text, not disk content', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'commit-message': ['error', { preset: 'handbook' }] } });
    const text = JSON.stringify({ rules: { 'commit-message': ['error', { preset: 'conventional' }] } });
    expect(resolveConfigText(repo, text).rules['commit-message'].options.preset).toBe('conventional');
    expect(resolveConfig(repo).rules['commit-message'].options.preset).toBe('handbook');
  });

  it('null text ignores a config on disk', () => {
    const repo = makeRepo();
    writeConfig(repo, { rules: { 'commit-message': ['error', { preset: 'conventional' }] } });
    expect(resolveConfigText(repo, null)).toEqual(ALL_DEFAULTS);
  });

  it('detects preset from history when not explicit', () => {
    const repo = makeRepo();
    commits(repo, CONVENTIONAL_HISTORY);
    expect(resolveConfigText(repo, '{"rules":{}}').rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'conventional' },
      sources: { severity: 'default', preset: 'history' },
    });
  });

  it('explicit preset overrides history detection', () => {
    const repo = makeRepo();
    commits(repo, CONVENTIONAL_HISTORY);
    const text = JSON.stringify({ rules: { 'commit-message': ['error', { preset: 'handbook' }] } });
    expect(resolveConfigText(repo, text).rules['commit-message']).toEqual({
      severity: 'error',
      options: { preset: 'handbook' },
      sources: { severity: 'explicit', preset: 'explicit' },
    });
  });

  it('invalid text throws ConfigError naming file and key path', () => {
    const repo = makeRepo();
    const file = path.join(repo, '.house-rules.json');
    const err = caught(() =>
      resolveConfigText(repo, '{"rules":{"comment-density":{"severity":"loud"}}}'),
    );
    expect(err).toBeInstanceOf(ConfigError);
    const e = err as ConfigError;
    expect(e.file).toEqual(file);
    expect(e.message.startsWith(file)).toBe(true);
    expect(e.message).toContain('rules["comment-density"]');
  });
});

describe('AC2 legacy artifact-structure configs', () => {
  const legacy: [string, unknown][] = [
    ['"artifact-structure":"error"', { rules: { 'artifact-structure': 'error' } }],
    ['"stray-artifacts":"error"', { rules: { 'stray-artifacts': 'error' } }],
    ['"artifact-structure":["error",{}]', { rules: { 'artifact-structure': ['error', {}] } }],
    ['"stray-artifacts":["error",{}]', { rules: { 'stray-artifacts': ['error', {}] } }],
  ];
  for (const [label, body] of legacy) {
    it(`AC2: legacy ${label} resolves with options {} and no types`, () => {
      const repo = makeRepo();
      writeConfig(repo, body);
      const rule = resolveConfig(repo).rules['artifact-structure'];
      expect(rule.options).toEqual({});
      expect('types' in rule.options).toBe(false);
      expect(rule.severity).toBe('error');
    });
  }

  it('AC2: 0.14-style config resolves to pinned snapshot (stray-artifacts key mapped to artifact-structure)', () => {
    const repo = makeRepo();
    const file = writeConfig(repo, {
      $schema: './house-rules.schema.json',
      rules: {
        'commit-message': ['error', { preset: 'conventional' }],
        'comment-density': 'error',
        'stray-artifacts': ['error'],
      },
    });
    const resolved = resolveConfig(repo);
    const pinned = {
      file,
      rules: {
        'commit-message': {
          severity: 'error',
          options: { preset: 'conventional' },
          sources: { severity: 'explicit', preset: 'explicit' },
        },
        'comment-density': {
          severity: 'error',
          options: {},
          sources: { severity: 'explicit' },
        },
        'stray-artifacts': {
          severity: 'error',
          options: {},
          sources: { severity: 'explicit' },
        },
      },
    } as const;
    const { 'artifact-structure': moved, ...rest } = resolved.rules;
    expect({ file: resolved.file, rules: { ...rest, 'stray-artifacts': moved } }).toEqual(pinned);
  });

  it('AC2: manifest config passes through resolve into artifact-structure options unchanged', () => {
    const repo = makeRepo();
    const options: ManifestOptions = {
      govern: ['doc/**'],
      types: {
        research: {
          tier: 'working',
          generates: 'doc/research/{name:kebab}.md',
          description: 'Research notes',
          instruction: 'Write findings.',
          template: '# {name}\n',
          frontmatter: { type: 'object', properties: { title: { type: 'string' } } },
          headings: ['Summary', 'Sources'],
        },
        spec: { tier: 'product', generates: 'doc/spec/{name:kebab}.md' },
      },
      forbidden: [{ pattern: '**/scratch/**', redirect: 'doc/research/{slug}.md' }],
    };
    writeConfig(repo, { rules: { 'artifact-structure': ['error', options] } });
    const rule = resolveConfig(repo).rules['artifact-structure'];
    expect(rule.options).toEqual(options);
    expect(rule.sources).toEqual({ severity: 'explicit' });
  });
});
