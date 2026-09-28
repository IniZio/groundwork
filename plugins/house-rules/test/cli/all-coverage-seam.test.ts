/**
 * End-to-end regression for the coverage seam in --all mode.
 *
 * Bug: housekeep/check --all printed "not checked: a.kt" etc. even though
 * comment-density supports kotlin/swift/java/python. Root cause: scope.ts
 * built ScopedFile with lang=undefined and no ctx.sourceFile in --all mode.
 * Additionally, grammar-load failures were silently skipped rather than
 * surfaced in the coverage output.
 *
 * This test is EXPECTED to fail until the sibling slices (scope.ts fix and
 * run.ts notCheckedFiles lang fallback) land. The test itself must not be
 * altered to make it pass.
 */

import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');
const REAL_RULES_DIR = path.resolve(import.meta.dir, '../../rules');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  return { ...env, ...extra };
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-all-cov-'));
  spawnSync('git', ['init', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  return dir;
}

function commitAll(dir: string, msg: string): void {
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', msg], { encoding: 'utf8' });
}

/**
 * File content with 9 comment lines in 12 total (75% density — well above the
 * 5/100 cap). Uses "//" comments for Kotlin/KTS/Swift/Java; "#" variant used
 * for Python/Ruby.
 */
function overBudgetKotlinContent(): string {
  return [
    '// comment line 1',
    '// comment line 2',
    '// comment line 3',
    '// comment line 4',
    '// comment line 5',
    '// comment line 6',
    '// comment line 7',
    '// comment line 8',
    '// comment line 9',
    'val x = 1',
    'val y = 2',
    'val z = 3',
  ].join('\n') + '\n';
}

function overBudgetSwiftContent(): string {
  return [
    'let noop = 0',
    '// comment line 1',
    '// comment line 2',
    '// comment line 3',
    '// comment line 4',
    '// comment line 5',
    '// comment line 6',
    '// comment line 7',
    '// comment line 8',
    '// comment line 9',
    'let y = 1',
    'let z = 2',
  ].join('\n') + '\n';
}

function overBudgetJavaContent(): string {
  return [
    'class Foo {',
    '// comment line 1',
    '// comment line 2',
    '// comment line 3',
    '// comment line 4',
    '// comment line 5',
    '// comment line 6',
    '// comment line 7',
    '// comment line 8',
    '// comment line 9',
    'int x = 1;',
    'int y = 2;',
    '}',
  ].join('\n') + '\n';
}

function overBudgetHashComments(): string {
  return [
    '# comment line 1',
    '# comment line 2',
    '# comment line 3',
    '# comment line 4',
    '# comment line 5',
    '# comment line 6',
    '# comment line 7',
    '# comment line 8',
    '# comment line 9',
    'x = 1',
    'y = 2',
    'z = 3',
  ].join('\n') + '\n';
}

/** Populate a temp repo with one over-budget file per language under test. */
function populateRepo(dir: string): void {
  fs.writeFileSync(path.join(dir, 'a.kt'), overBudgetKotlinContent(), 'utf8');
  fs.writeFileSync(path.join(dir, 'build.gradle.kts'), overBudgetKotlinContent(), 'utf8');
  fs.writeFileSync(path.join(dir, 'App.swift'), overBudgetSwiftContent(), 'utf8');
  fs.writeFileSync(path.join(dir, 'Foo.java'), overBudgetJavaContent(), 'utf8');
  fs.writeFileSync(path.join(dir, 'app.py'), overBudgetHashComments(), 'utf8');
  // x.rb: Ruby has no language adapter → positive control for notChecked output
  fs.writeFileSync(path.join(dir, 'x.rb'), overBudgetHashComments(), 'utf8');
  commitAll(dir, 'initial commit');
}

function runBIN(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    env: childEnv(extraEnv),
    timeout: 30000,
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('all-coverage-seam: --all mode coverage correctness', () => {

  it(
    'housekeep --all --rules comment-density --dry-run: kt/kts/swift/java/py not in notChecked; x.rb in notChecked; kt/swift files in dry-run output',
    () => {
      const dir = makeTempRepo();
      try {
        populateRepo(dir);

        const blFile = path.join(os.tmpdir(), `hr-all-cov-bl-${Date.now()}.json`);
        const r = runBIN(
          [
            'housekeep', '--all',
            '--rules', 'comment-density',
            '--dry-run',
            '--repo', dir,
            '--rules-dir', REAL_RULES_DIR,
            '--baseline-file', blFile,
          ],
          dir,
        );

        const combined = r.stdout + '\n' + r.stderr;

        // Positive control: x.rb MUST appear as "not checked" (Ruby has no adapter)
        expect(combined).toMatch(/^not checked: x\.rb$/m);

        // Primary assertions: kt/kts/swift/java/py must NOT appear as "not checked"
        expect(combined).not.toMatch(/^not checked: a\.kt$/m);
        expect(combined).not.toMatch(/^not checked: build\.gradle\.kts$/m);
        expect(combined).not.toMatch(/^not checked: App\.swift$/m);
        expect(combined).not.toMatch(/^not checked: Foo\.java$/m);
        expect(combined).not.toMatch(/^not checked: app\.py$/m);

        expect(r.stdout).toMatch(/^\s+\[dry-run\]\s+a\.kt\s+comment-density/m);
        expect(r.stdout).toMatch(/^\s+\[dry-run\]\s+App\.swift\s+comment-density/m);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  it(
    'check --all: kt/kts/swift/java/py not in notChecked; x.rb in notChecked',
    () => {
      const dir = makeTempRepo();
      try {
        populateRepo(dir);

        const blFile = path.join(os.tmpdir(), `hr-all-cov-chk-bl-${Date.now()}.json`);
        const r = runBIN(
          [
            'check', '--all',
            '--repo', dir,
            '--rules-dir', REAL_RULES_DIR,
            '--baseline-file', blFile,
          ],
          dir,
        );

        const combined = r.stdout + '\n' + r.stderr;

        // Positive control: x.rb MUST appear as "not checked"
        expect(combined).toMatch(/^not checked: x\.rb$/m);

        // Primary assertions: kt/kts/swift/java/py must NOT appear as "not checked"
        expect(combined).not.toMatch(/^not checked: a\.kt$/m);
        expect(combined).not.toMatch(/^not checked: build\.gradle\.kts$/m);
        expect(combined).not.toMatch(/^not checked: App\.swift$/m);
        expect(combined).not.toMatch(/^not checked: Foo\.java$/m);
        expect(combined).not.toMatch(/^not checked: app\.py$/m);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

  it(
    'housekeep --all with kotlin grammar forced to fail: a.kt appears in failed coverage output or stderr grammar warning',
    () => {
      const dir = makeTempRepo();
      try {
        populateRepo(dir);

        const blFile = path.join(os.tmpdir(), `hr-all-cov-gram-bl-${Date.now()}.json`);
        const r = runBIN(
          [
            'housekeep', '--all',
            '--rules', 'comment-density',
            '--dry-run',
            '--repo', dir,
            '--rules-dir', REAL_RULES_DIR,
            '--baseline-file', blFile,
          ],
          dir,
          // Force kotlin grammar to fail via the test seam
          { HOUSE_RULES_TEST_FAIL_GRAMMARS: 'kotlin' },
        );

        const combined = r.stdout + '\n' + r.stderr;

        const hasCoverageLine = /^failed: a\.kt \(kotlin grammar did not load: forced by HOUSE_RULES_TEST_FAIL_GRAMMARS\)$/m.test(combined);
        const hasStderrWarning = /house-rules warning: the kotlin grammar did not load \(forced by HOUSE_RULES_TEST_FAIL_GRAMMARS\); a\.kt was not checked\./.test(combined);

        // At least one surface must expose the failure
        expect(hasCoverageLine || hasStderrWarning).toBe(true);

        // The precise coverage line in stdout
        expect(r.stdout).toMatch(
          /^failed: a\.kt \(kotlin grammar did not load: forced by HOUSE_RULES_TEST_FAIL_GRAMMARS\)$/m,
        );

        // The grammar warning on stderr
        expect(r.stderr).toMatch(
          /house-rules warning: the kotlin grammar did not load \(forced by HOUSE_RULES_TEST_FAIL_GRAMMARS\); a\.kt was not checked\./,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    30000,
  );

});
