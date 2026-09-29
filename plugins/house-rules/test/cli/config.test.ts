import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');
const CLI = path.join(PLUGIN_ROOT, 'src/cli/main.ts');
const SCHEMA_URL: string = JSON.parse(
  fs.readFileSync(path.join(PLUGIN_ROOT, 'house-rules.schema.json'), 'utf8'),
).$id;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]) {
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', ...args], { cwd: dir });
}

function makeRepo(subjects: string[], files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-config-'));
  tempDirs.push(dir);
  spawnSync('git', ['init'], { cwd: dir });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  git(dir, 'add', '.');
  subjects.forEach((s, i) => {
    if (i === 0) git(dir, 'commit', '-m', s);
    else git(dir, 'commit', '--allow-empty', '-m', s);
  });
  return dir;
}

function runConfig(args: string[], cwd: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDE_PROJECT_DIR' && v !== undefined) env[k] = v;
  }
  return spawnSync('bun', [CLI, 'config', ...args], { cwd, encoding: 'utf8', env });
}

const CONVENTIONAL = ['feat: a', 'feat: b', 'fix: c'];
const FORBIDDEN = /env|kill|bypass|disable|HOUSE_RULES_/i;

const DEFAULT_TEXT = (preset: string, why: string) =>
  [
    'config: none (all values default or detected)',
    `schema: ${SCHEMA_URL}`,
    `commit-message  severity=error (default)  preset=${preset} (${why})`,
    `  change with: rules["commit-message"].preset (active: ${preset}, source: ${why})`,
    'comment-density severity=error (default)  max_per_100=5 (default)',
    '  change with: rules["comment-density"] (active: error, source: default)',
    '  change with: rules["comment-density"].max_per_100 (active: 5, source: default)',
    'stray-artifacts severity=error (default)',
    '  change with: rules["stray-artifacts"] (active: error, source: default)',
    '',
  ].join('\n');

const EXPLICIT_FILE = {
  rules: {
    'commit-message': ['error', { preset: 'handbook' }],
    'comment-density': ['warn', { max_per_100: 10 }],
    'stray-artifacts': 'off',
  },
};

function explicitText(file: string) {
  return [
    `config: ${file}`,
    `schema: ${SCHEMA_URL}`,
    'commit-message  severity=error (explicit)  preset=handbook (explicit)',
    '  change with: rules["commit-message"].preset (active: handbook, source: explicit)',
    'comment-density severity=warn (explicit)  max_per_100=10 (explicit)',
    '  change with: rules["comment-density"] (active: warn, source: explicit)',
    '  change with: rules["comment-density"].max_per_100 (active: 10, source: explicit)',
    'stray-artifacts severity=off (explicit)',
    '  change with: rules["stray-artifacts"] (active: off, source: explicit)',
    '',
  ].join('\n');
}

describe('house-rules config', () => {
  it('prints defaults with detected conventional preset from history', () => {
    const repo = makeRepo(CONVENTIONAL);
    const r = runConfig(['--repo', repo], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(DEFAULT_TEXT('conventional', 'history'));
  });

  it('prints explicit values with explicit sources', () => {
    const repo = makeRepo(CONVENTIONAL, { '.house-rules.json': JSON.stringify(EXPLICIT_FILE) });
    const r = runConfig(['--repo', repo], repo);
    expect(r.status).toBe(0);
    expect(r.stdout.split('\n')).toEqual(explicitText(path.join(repo, '.house-rules.json')).split('\n'));
  });

  it('detects subject-only from .gitmessage', () => {
    const repo = makeRepo(['init'], { '.gitmessage': 'subject\n' });
    const r = runConfig(['--repo', repo], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(DEFAULT_TEXT('subject-only', 'gitmessage'));
  });

  it('detects conventional from commitlint config', () => {
    const repo = makeRepo(['init'], { 'commitlint.config.js': 'module.exports = {};\n' });
    const r = runConfig(['--repo', repo], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(DEFAULT_TEXT('conventional', 'commitlint'));
  });

  it('rejects invalid config with exit 2 and a pointer message', () => {
    const bad = { rules: { 'comment-density': ['error', { max_per_100: 500 }] } };
    const repo = makeRepo(CONVENTIONAL, { '.house-rules.json': JSON.stringify(bad) });
    const r = runConfig(['--repo', repo], repo);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Error: ');
    expect(r.stderr).toContain(path.join(repo, '.house-rules.json'));
    expect(r.stderr).toContain('rules["comment-density"][1].max_per_100');
    expect(r.stderr).toContain('allowed: integer 0..100');
  });

  it('emits JSON with ordered keys under --format json', () => {
    const repo = makeRepo(CONVENTIONAL, { '.house-rules.json': JSON.stringify(EXPLICIT_FILE) });
    const r = runConfig(['--repo', repo, '--format', 'json'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout.endsWith('\n')).toBe(true);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({
      schema: SCHEMA_URL,
      file: path.join(repo, '.house-rules.json'),
      rules: {
        'commit-message': {
          severity: 'error',
          options: { preset: 'handbook' },
          sources: { severity: 'explicit', preset: 'explicit' },
        },
        'comment-density': {
          severity: 'warn',
          options: { max_per_100: 10 },
          sources: { severity: 'explicit', max_per_100: 'explicit' },
        },
        'stray-artifacts': { severity: 'off', options: {}, sources: { severity: 'explicit' } },
      },
    });
    expect(Object.keys(out)).toEqual(['schema', 'file', 'rules']);
    expect(Object.keys(out.rules)).toEqual(['commit-message', 'comment-density', 'stray-artifacts']);
    expect(r.stdout).toBe(JSON.stringify(out, null, 2) + '\n');
  });

  it('defaults --repo to the git root of cwd', () => {
    const repo = makeRepo(CONVENTIONAL);
    const withFlag = runConfig(['--repo', repo], repo);
    const without = runConfig([], repo);
    expect(without.status).toBe(0);
    expect(without.stdout).toBe(withFlag.stdout);
    expect(without.stdout).toBe(DEFAULT_TEXT('conventional', 'history'));
  });

  it('lists config in --help', () => {
    const repo = makeRepo(['init']);
    const r = runConfig(['--help'], repo);
    const r2 = spawnSync('bun', [CLI, '--help'], { cwd: repo, encoding: 'utf8' });
    const all = r.stdout + r2.stdout;
    expect(all.split('\n').some((l) => l.startsWith('  house-rules config'))).toBe(true);
  });

  it('never mentions bypass mechanisms in text or json output', () => {
    const plain = makeRepo(CONVENTIONAL);
    const withFile = makeRepo(CONVENTIONAL, { '.house-rules.json': JSON.stringify(EXPLICIT_FILE) });
    for (const repo of [plain, withFile]) {
      for (const fmt of ['text', 'json']) {
        const r = runConfig(['--repo', repo, '--format', fmt], repo);
        expect(r.status).toBe(0);
        const out = r.stdout.replaceAll(repo, '');
        expect(out).not.toMatch(FORBIDDEN);
      }
    }
  });
});
