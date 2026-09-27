import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');
const REAL_RULES_DIR = path.resolve(import.meta.dir, '../../rules');

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

// 6 comment lines / 10 total = 60% density, well above the 5/100 cap.
const VIOLATION_CONTENT = [
  '// comment one',
  '// comment two',
  '// comment three',
  '// comment four',
  '// comment five',
  '// comment six',
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
].join('\n') + '\n';

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-check-all-'));
  // git init -b main so defaultBase finds 'main'
  spawnSync('git', ['init', '-b', 'main', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  return dir;
}

function commitFile(dir: string, relPath: string, content: string): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  spawnSync('git', ['-C', dir, 'add', relPath], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', `add ${relPath}`], { encoding: 'utf8' });
}

function runBIN(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: 'utf8', env: childEnv() });
}

describe('check --all', () => {
  it('test 1: check without --all finds nothing; check --all finds src/a.ts', () => {
    const dir = makeTempRepo();
    try {
      commitFile(dir, 'src/a.ts', VIOLATION_CONTENT);

      const noAll = runBIN(
        ['check', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', path.join(os.tmpdir(), 'nonexistent-check-all-bl.json')],
        dir,
      );
      // Normal diff vs HEAD (same commit) → no new lines → no findings
      expect(noAll.status).toBe(0);
      expect(noAll.stdout).not.toContain('src/a.ts');

      const withAll = runBIN(
        ['check', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', path.join(os.tmpdir(), 'nonexistent-check-all-bl.json')],
        dir,
      );
      expect(withAll.stdout).toContain('src/a.ts');
      expect(withAll.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test 2: check --all src/a.ts reports a.ts but not b.ts', () => {
    const dir = makeTempRepo();
    try {
      commitFile(dir, 'src/a.ts', VIOLATION_CONTENT);
      commitFile(dir, 'src/b.ts', VIOLATION_CONTENT);

      const r = runBIN(
        ['check', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', path.join(os.tmpdir(), 'nonexistent-check-all-bl2.json'),
          'src/a.ts'],
        dir,
      );
      // Positive first: a.ts must appear
      expect(r.stdout).toContain('src/a.ts');
      // Then the absence: b.ts must not appear
      expect(r.stdout).not.toContain('src/b.ts');
      expect(r.status).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test 3: baseline --all then check --all exits 0', () => {
    const dir = makeTempRepo();
    const blFile = path.join(os.tmpdir(), `hr-check-all-bl3-${Date.now()}.json`);
    try {
      commitFile(dir, 'src/a.ts', VIOLATION_CONTENT);

      const blR = runBIN(
        ['baseline', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', blFile],
        dir,
      );
      expect(blR.status).toBe(0);
      // ≥1 entries in the baseline output
      const m = blR.stdout.match(/\((\d+) entries\)/);
      expect(m).not.toBeNull();
      expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(1);

      const chkR = runBIN(
        ['check', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', blFile],
        dir,
      );
      expect(chkR.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      try { fs.unlinkSync(blFile); } catch { /* already gone */ }
    }
  });

  it('test 4: housekeep --all fixes file content; commit count unchanged; check --all exits 0', () => {
    const dir = makeTempRepo();
    try {
      commitFile(dir, 'src/a.ts', VIOLATION_CONTENT);

      const countBefore = spawnSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
      }).stdout.trim();

      const hkR = runBIN(
        ['housekeep', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR],
        dir,
      );
      expect(hkR.status).toBe(0);
      // Positive control: housekeep reported src/a.ts
      expect(hkR.stdout).toContain('src/a.ts');

      // File content must have changed (autofix removed excess comments)
      const afterContent = fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf8');
      expect(afterContent).not.toBe(VIOLATION_CONTENT);
      expect(afterContent).not.toContain('// comment one');

      const countAfter = spawnSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
      }).stdout.trim();
      expect(countAfter).toBe(countBefore);

      const nonexistentBl = path.join(os.tmpdir(), `nonexistent-check-all-bl4-${Date.now()}.json`);
      const chkR = runBIN(
        ['check', '--all', '--repo', dir, '--rules-dir', REAL_RULES_DIR,
          '--baseline-file', nonexistentBl],
        dir,
      );
      expect(chkR.stdout).toContain('0 finding(s)');
      expect(chkR.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test 5: --all --base exits 2 with stderr mentioning --all; --all --since also exits 2', () => {
    const dir = makeTempRepo();
    try {
      commitFile(dir, 'src/a.ts', VIOLATION_CONTENT);

      const r1 = runBIN(
        ['check', '--all', '--base', 'main', '--repo', dir,
          '--rules-dir', REAL_RULES_DIR],
        dir,
      );
      expect(r1.stderr).toContain('--all');
      expect(r1.status).toBe(2);

      const r2 = runBIN(
        ['housekeep', '--all', '--since', 'main', '--repo', dir,
          '--rules-dir', REAL_RULES_DIR],
        dir,
      );
      expect(r2.stderr).toContain('--all');
      expect(r2.status).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
