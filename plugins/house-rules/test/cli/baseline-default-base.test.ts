import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');
const BIN = path.join(PLUGIN_ROOT, 'bin/house-rules');
const REAL_RULES_DIR = path.join(PLUGIN_ROOT, 'rules');

const tempDirs: string[] = [];

function mktemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function git(args: string[], cwd: string) {
  return spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function initRepo(dir: string): void {
  git(['init', '-b', 'main'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  git(['add', 'README.md'], dir);
  git(['commit', '-m', 'init'], dir);
}

function runBin(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env['CLAUDE_PROJECT_DIR'];
  delete env['CLAUDE_PLUGIN_ROOT'];
  return spawnSync(BIN, args, { cwd, encoding: 'utf8', env });
}

function revParse(ref: string, cwd: string): string {
  return spawnSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' }).stdout.trim();
}

describe('baseline default base matches check default base', () => {
  it('baseline and check use same default base (no origin → main)', () => {
    const repoDir = mktemp('hr-default-base-');
    initRepo(repoDir);

    git(['checkout', '-b', 'feat'], repoDir);

    // File with many comments over the density cap
    fs.writeFileSync(
      path.join(repoDir, 'feature.ts'),
      [
        '// comment one',
        '// comment two',
        '// comment three',
        '// comment four',
        '// comment five',
        '// comment six',
        'export const x = 1;',
      ].join('\n') + '\n',
    );
    git(['add', 'feature.ts'], repoDir);
    git(['commit', '-m', 'add feature'], repoDir);

    const baselineFile = path.join(repoDir, '.house-rules', 'baseline.json');

    const blResult = runBin(
      ['baseline', '--rules-dir', REAL_RULES_DIR, '--baseline-file', baselineFile],
      repoDir,
    );
    expect(blResult.status).toBe(0);

    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

    const mainSha = revParse('main', repoDir);
    expect(baseline.base).toBe(mainSha);

    const entry = baseline.entries.find(
      (e: { rule: string; path: string }) => e.rule === 'comment-density' && e.path === 'feature.ts',
    );
    expect(entry).toBeDefined();

    const checkResult = runBin(
      ['check', '--rules-dir', REAL_RULES_DIR, '--baseline-file', baselineFile],
      repoDir,
    );
    expect(checkResult.status).toBe(0);
  });
});
