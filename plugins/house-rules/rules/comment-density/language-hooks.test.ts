/**
 * language-hooks.test.ts — AC3
 *
 * Verifies that removing an entry from COMMENT_DENSITY_LANGUAGE_HOOKS falls back
 * to default behaviour without crashing, tested at the rule-tester seam and via
 * direct autoFix invocation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import rule from './index.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import { COMMENT_DENSITY_LANGUAGE_HOOKS, fixEntryFor, type CommentDensityLanguageHook } from './languages.js';
import { autoFix } from '../../src/hooks/lib/comment-density.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n');
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lh-test-'));
  const o = { cwd: dir, encoding: 'utf8' as const };
  spawnSync('git', ['init'], o);
  spawnSync('git', ['config', 'user.email', 't@t.com'], o);
  spawnSync('git', ['config', 'user.name', 'T'], o);
  return dir;
}

const GO_SPACING_INPUT = [
  'package main',
  '',
  'func f(wsMounts []int, cfg int) {',
  '\t_ = runColdBootInit(false, false /*isPid1=false*/, wsMounts, "", cfg, nil)',
  '}',
  '',
].join('\n');

const GO_OVER_CAP = [
  'package main',
  '',
  'func main() {',
  '\t// go comment 0',
  '\t// go comment 1',
  '\t// go comment 2',
  '\t// go comment 3',
  '\t// go comment 4',
  '\t// go comment 5',
  '\t// go comment 6',
  '\t// go comment 7',
  '\t// go comment 8',
  '\t// go comment 9',
  '\tx := 1',
  '\ty := 2',
  '\tz := 3',
  '\t_ = x + y + z',
  '}',
  '',
].join('\n');

const GO_UNDER_CAP = [
  'package main',
  '',
  'func f() {}',
  ...Array.from({ length: 39 }, (_, i) => `func g${i}() {}`),
].join('\n') + '\n';

// 10 comments + 10 code lines (TS, over-cap)
const TS_OVER_CAP = [
  ...Array.from({ length: 10 }, (_, i) => `// ts comment ${i}`),
  ...Array.from({ length: 10 }, (_, i) => `export const v${i} = ${i};`),
].join('\n') + '\n';

// 1 comment + 40 code lines (TS, valid)
const TS_UNDER_CAP = `// single rationale\n${codeLines(40)}\n`;

// All rows (0-based indices), used for autoFix
function allRows(code: string): Set<number> {
  return new Set(code.split('\n').map((_, i) => i));
}


describe('comment-density language-hooks positive controls (entry present)', () => {
  it('fixEntryFor go is stable when entry present', () => {
    expect(fixEntryFor('go').stability).toBe('stable');
  });

  it('canFixPath x.go returns true when entry present', () => {
    expect(rule.canFixPath!('x.go')).toBe(true);
  });

  it('fixEntryFor typescript is stable when entry present', () => {
    expect(fixEntryFor('typescript').stability).toBe('stable');
  });

  it('canFixPath x.ts returns true when entry present', () => {
    expect(rule.canFixPath!('x.ts')).toBe(true);
  });

  it('fixEntryFor sql is stable and safe when entry present', () => {
    expect(fixEntryFor('sql')).toEqual({ stability: 'stable', applicability: 'safe' });
  });

  it('canFixPath x.sql returns true when entry present', () => {
    expect(rule.canFixPath!('x.sql')).toBe(true);
  });

  it('fixEntryFor make is stable and safe when entry present', () => {
    expect(fixEntryFor('make')).toEqual({ stability: 'stable', applicability: 'safe' });
  });

  it('canFixPath Makefile and x.mk return true when entry present', () => {
    expect(rule.canFixPath!('Makefile')).toBe(true);
    expect(rule.canFixPath!('x.mk')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Go entry removed
// ---------------------------------------------------------------------------

describe('comment-density language-hooks: go entry removed', () => {
  let savedGo: CommentDensityLanguageHook | undefined;
  let withEntryGoFixed: string | undefined;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    // Capture with-entry autoFix output BEFORE deleting the entry
    const r = await autoFix(GO_SPACING_INPUT, 'go', allRows(GO_SPACING_INPUT));
    withEntryGoFixed = r.ok ? r.fixed : undefined;

    savedGo = COMMENT_DENSITY_LANGUAGE_HOOKS['go'];
    delete COMMENT_DENSITY_LANGUAGE_HOOKS['go'];
  });

  afterAll(() => {
    if (savedGo !== undefined) {
      COMMENT_DENSITY_LANGUAGE_HOOKS['go'] = savedGo;
    }
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // rule-tester seam: check still runs for Go files without crash
  ruleTester(rule, {
    valid: [
      {
        why: 'go file under cap (no entry in hook table)',
        filename: 'x.go',
        code: GO_UNDER_CAP,
      },
    ],
    invalid: [
      {
        why: 'go file over cap flags a finding (no entry in hook table)',
        filename: 'x.go',
        code: GO_OVER_CAP,
        findings: [{ ruleId: 'comment-density' }],
      },
    ],
  });

  it('fixEntryFor go falls back to preview stability', () => {
    expect(fixEntryFor('go')).toEqual({ stability: 'preview', applicability: 'safe' });
  });

  it('canFixPath x.go returns false without go entry', () => {
    expect(rule.canFixPath!('x.go')).toBe(false);
  });

  it('rule.fix declines go file with correct fallback reason', async () => {
    const repoDir = makeRepo();
    tmpDirs.push(repoDir);
    const fname = 'x.go';
    const absPath = path.join(repoDir, fname);
    writeFileSync(absPath, GO_OVER_CAP);

    const hunks = diffTextToHunks('', GO_OVER_CAP);
    const result = await rule.fix!({
      repoRoot: repoDir,
      mode: 'cli',
      files: [{ path: fname, text: GO_OVER_CAP, baseText: '', addedHunks: hunks }],
    });

    expect(result.skipped).toBe(1);
    expect(result.fixed).toBe(0);
    const file = result.files[0];
    expect(file.status).toBe('declined');
    expect(file.reason).toBe('autofix not supported for go');
  });

  it('autoFix without Go hook resolves ok:true with default behaviour', async () => {
    const r = await autoFix(GO_SPACING_INPUT, 'go', allRows(GO_SPACING_INPUT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Default (no repair) output retains the spacing artifact before the comma
    expect(r.fixed).toBe('package main\n\nfunc f(wsMounts []int, cfg int) {\n\t_ = runColdBootInit(false, false , wsMounts, "", cfg, nil)\n}\n');
    // With-entry output did not have the artifact (repair cleaned it)
    expect(withEntryGoFixed).toBeDefined();
    expect(withEntryGoFixed).toBe('package main\n\nfunc f(wsMounts []int, cfg int) {\n\t_ = runColdBootInit(false, false, wsMounts, "", cfg, nil)\n}\n');
    // They differ
    expect(r.fixed).not.toBe(withEntryGoFixed);
  });
});


describe('comment-density language-hooks: typescript entry removed', () => {
  let savedTs: CommentDensityLanguageHook | undefined;

  beforeAll(() => {
    savedTs = COMMENT_DENSITY_LANGUAGE_HOOKS['typescript'];
    delete COMMENT_DENSITY_LANGUAGE_HOOKS['typescript'];
  });

  afterAll(() => {
    if (savedTs !== undefined) {
      COMMENT_DENSITY_LANGUAGE_HOOKS['typescript'] = savedTs;
    }
  });

  ruleTester(rule, {
    valid: [
      {
        why: 'typescript file under cap (no entry in hook table)',
        filename: 'x.ts',
        code: TS_UNDER_CAP,
      },
    ],
    invalid: [
      {
        why: 'typescript file over cap flags a finding (no entry in hook table)',
        filename: 'x.ts',
        code: TS_OVER_CAP,
        findings: [{ ruleId: 'comment-density' }],
      },
    ],
  });

  it('fixEntryFor typescript falls back to preview stability', () => {
    expect(fixEntryFor('typescript')).toEqual({ stability: 'preview', applicability: 'safe' });
  });

  it('canFixPath x.ts returns false without typescript entry', () => {
    expect(rule.canFixPath!('x.ts')).toBe(false);
  });

  it('rule.fix declines typescript file with correct fallback reason', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'lh-ts-fix-'));
    try {
      const o = { cwd: tmpDir, encoding: 'utf8' as const };
      spawnSync('git', ['init'], o);
      spawnSync('git', ['config', 'user.email', 't@t.com'], o);
      spawnSync('git', ['config', 'user.name', 'T'], o);

      const fname = 'x.ts';
      const absPath = path.join(tmpDir, fname);
      writeFileSync(absPath, TS_OVER_CAP);

      const hunks = diffTextToHunks('', TS_OVER_CAP);
      const result = await rule.fix!({
        repoRoot: tmpDir,
        mode: 'cli',
        files: [{ path: fname, text: TS_OVER_CAP, baseText: '', addedHunks: hunks }],
      });

      expect(result.skipped).toBe(1);
      expect(result.fixed).toBe(0);
      const file = result.files[0];
      expect(file.status).toBe('declined');
      expect(file.reason).toBe('autofix not supported for typescript');
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    }
  });
});
