import { describe, test, it, expect } from 'bun:test';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildAllTrackedContext, EMPTY_TREE } from '../../src/cli/scope.js';
import { addedHunks } from '../../src/hooks/lib/work-scope.js';

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-scope-empty-tree-'));
  spawnSync('git', ['init', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  return dir;
}

function commitAll(dir: string, msg: string): void {
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', msg], { encoding: 'utf8' });
}

describe('buildAllTrackedContext EMPTY_TREE fast path', () => {
  describe('parity: fast path matches addedHunks per file', () => {
    test('normal .py file, .ts file, trailing-newline, no-trailing-newline, empty, deleted, symlink', () => {
      const dir = makeTempRepo();
      try {
        fs.writeFileSync(path.join(dir, 'a.py'), 'def foo():\n    pass\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'b.ts'), 'export const x = 1;\nexport const y = 2;', 'utf8');
        fs.writeFileSync(path.join(dir, 'c_trail.ts'), 'line1\nline2\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'd_notail.ts'), 'line1\nline2', 'utf8');
        fs.writeFileSync(path.join(dir, 'e_empty.ts'), '', 'utf8');
        fs.writeFileSync(path.join(dir, 'f_delete.ts'), 'will be deleted\n', 'utf8');
        fs.symlinkSync('a.py', path.join(dir, 'g_symlink.py'));
        commitAll(dir, 'init');

        fs.unlinkSync(path.join(dir, 'f_delete.ts'));

        const ctx = buildAllTrackedContext(dir);
        const fileMap = new Map(ctx.files!.map(f => [f.path, f]));

        const cases: Array<{ relPath: string; expectedBase: string; existsOnDisk: boolean }> = [
          { relPath: 'a.py',         expectedBase: '', existsOnDisk: true },
          { relPath: 'b.ts',         expectedBase: '', existsOnDisk: true },
          { relPath: 'c_trail.ts',   expectedBase: '', existsOnDisk: true },
          { relPath: 'd_notail.ts',  expectedBase: '', existsOnDisk: true },
          { relPath: 'e_empty.ts',   expectedBase: '', existsOnDisk: true },
          { relPath: 'f_delete.ts',  expectedBase: '', existsOnDisk: false },
          { relPath: 'g_symlink.py', expectedBase: '', existsOnDisk: true },
        ];

        for (const { relPath, expectedBase, existsOnDisk } of cases) {
          const fast = fileMap.get(relPath);
          expect(fast, `file ${relPath} missing from context`).toBeDefined();
          expect(fast!.baseText, `${relPath} baseText`).toBe(expectedBase);
          expect(fast!.tracked, `${relPath} tracked`).toBe(true);

          const absPath = path.join(dir, relPath);
          const refHunks = existsOnDisk ? (addedHunks(absPath, EMPTY_TREE) ?? []) : [];
          expect(fast!.addedHunks, `${relPath} addedHunks`).toEqual(refHunks);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('spawn count: zero git spawns per file in EMPTY_TREE path', () => {
    test('only the initial ls-files spawn fires, none per file', () => {
      const dir = makeTempRepo();
      try {
        fs.writeFileSync(path.join(dir, 'x.ts'), 'const a = 1;\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'y.ts'), 'const b = 2;\n', 'utf8');
        commitAll(dir, 'two files');

        let spawnCount = 0;
        const countingSpawn = (cmd: string, args: string[], opts: { encoding: 'utf8' }): SpawnSyncReturns<string> => {
          spawnCount++;
          return spawnSync(cmd, args, opts);
        };

        buildAllTrackedContext(dir, undefined, undefined, countingSpawn);

        expect(spawnCount).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('non-EMPTY_TREE base: unchanged behaviour', () => {
    test('uses git spawns for real base commit', () => {
      const dir = makeTempRepo();
      try {
        fs.writeFileSync(path.join(dir, 'z.ts'), 'const z = 0;\n', 'utf8');
        commitAll(dir, 'init z');
        const base = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

        fs.writeFileSync(path.join(dir, 'z.ts'), 'const z = 99;\n', 'utf8');
        commitAll(dir, 'update z');

        let spawnCount = 0;
        const countingSpawn = (cmd: string, args: string[], opts: { encoding: 'utf8' }): SpawnSyncReturns<string> => {
          spawnCount++;
          return spawnSync(cmd, args, opts);
        };

        buildAllTrackedContext(dir, base, undefined, countingSpawn);

        expect(spawnCount).toBeGreaterThan(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe('buildAllTrackedContext EMPTY_TREE pinned hunks', () => {
  test('trailing newline "a\\nb\\n" → added [1,2]', () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'trail.ts'), 'a\nb\n', 'utf8');
      commitAll(dir, 'init');
      const ctx = buildAllTrackedContext(dir);
      const f = ctx.files!.find(x => x.path === 'trail.ts')!;
      expect(f.addedHunks).toEqual([{ added: [1, 2], removed: [], removedBaseLineNos: [] }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('no trailing newline "a\\nb" → added [1,2]', () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'notail.ts'), 'a\nb', 'utf8');
      commitAll(dir, 'init');
      const ctx = buildAllTrackedContext(dir);
      const f = ctx.files!.find(x => x.path === 'notail.ts')!;
      expect(f.addedHunks).toEqual([{ added: [1, 2], removed: [], removedBaseLineNos: [] }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('empty file → added []', () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'empty.ts'), '', 'utf8');
      commitAll(dir, 'init');
      const ctx = buildAllTrackedContext(dir);
      const f = ctx.files!.find(x => x.path === 'empty.ts')!;
      expect(f.addedHunks).toEqual([{ added: [], removed: [], removedBaseLineNos: [] }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gitlink entry (mode 160000) → addedHunks [] and text undefined', () => {
    const dir = makeTempRepo();
    try {
      // Need at least one real commit before update-index
      fs.writeFileSync(path.join(dir, 'readme.ts'), 'x\n', 'utf8');
      commitAll(dir, 'init');
      // Add a gitlink (submodule index entry) without real checkout
      spawnSync('git', [
        '-C', dir, 'update-index', '--add', '--cacheinfo',
        '160000,deadbeefdeadbeefdeadbeefdeadbeefdeadbeef,subm',
      ], { encoding: 'utf8' });

      const ctx = buildAllTrackedContext(dir);
      const f = ctx.files!.find(x => x.path === 'subm')!;
      expect(f, 'subm entry present').toBeDefined();
      expect(f.addedHunks, 'gitlink addedHunks').toEqual([]);
      expect(f.text, 'gitlink text').toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf((process.getuid?.() ?? -1) === 0)(
    'unreadable tracked file → no throw, addedHunks [] and text undefined',
    () => {
      const dir = makeTempRepo();
      const filePath = path.join(dir, 'secret.ts');
      try {
        fs.writeFileSync(filePath, 'secret\n', 'utf8');
        commitAll(dir, 'init');
        fs.chmodSync(filePath, 0o000);

        let ctx: ReturnType<typeof buildAllTrackedContext>;
        expect(() => { ctx = buildAllTrackedContext(dir); }).not.toThrow();
        const f = ctx!.files!.find(x => x.path === 'secret.ts')!;
        expect(f, 'secret.ts present').toBeDefined();
        expect(f.addedHunks, 'unreadable addedHunks').toEqual([]);
        expect(f.text, 'unreadable text').toBeUndefined();
      } finally {
        try { fs.chmodSync(filePath, 0o644); } catch { /* best effort */ }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
