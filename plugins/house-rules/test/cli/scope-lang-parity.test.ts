import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildAllTrackedContext, EMPTY_TREE } from '../../src/cli/scope.js';
import { buildContext } from '../../src/engine/context.js';
import { languageForPath, type Language } from '../../src/hooks/languages/registry.js';

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-scope-lang-parity-'));
  spawnSync('git', ['init', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  return dir;
}

function commitAll(dir: string, msg: string): string {
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', msg], { encoding: 'utf8' });
  return spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
}

const FILES: Array<{ name: string; lang: Language | undefined }> = [
  { name: 'a.kt',             lang: 'kotlin' },
  { name: 'build.gradle.kts', lang: 'kotlin' },
  { name: 'App.swift',        lang: 'swift' },
  { name: 'Foo.java',         lang: 'java' },
  { name: 'app.py',           lang: 'python' },
  { name: 'b.ts',             lang: 'typescript' },
  { name: 'x.rb',             lang: undefined },   // ruby not supported
  { name: 'README.md',        lang: undefined },
];

describe('buildAllTrackedContext lang parity', () => {
  test('EMPTY_TREE path: lang matches buildContext(EMPTY_TREE) and languageForPath', () => {
    const dir = makeTempRepo();
    try {
      for (const { name } of FILES) {
        fs.writeFileSync(path.join(dir, name), `// ${name}\n`, 'utf8');
      }
      commitAll(dir, 'init all files');

      const allCtx = buildAllTrackedContext(dir);
      const diffCtx = buildContext({ repoRoot: dir, mode: 'cli', base: EMPTY_TREE });

      const allMap = new Map((allCtx.files ?? []).map(f => [f.path, f]));
      const diffMap = new Map((diffCtx.files ?? []).map(f => [f.path, f]));

      for (const { name, lang } of FILES) {
        const allFile = allMap.get(name);
        const diffFile = diffMap.get(name);

        expect(allFile, `allCtx missing ${name}`).toBeDefined();
        expect(diffFile, `diffCtx missing ${name}`).toBeDefined();

        // parity: both give the same lang
        expect(allFile!.lang, `lang parity for ${name}`).toBe(diffFile!.lang);

        // identity: matches languageForPath directly
        expect(allFile!.lang, `lang identity for ${name}`).toBe(
          languageForPath(name) ?? undefined,
        );

        // non-vacuous: named files have specific expected langs
        expect(allFile!.lang, `expected lang for ${name}`).toBe(lang);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('EMPTY_TREE path: sourceFile is a function and resolves non-null for .kt', async () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'a.kt'), 'fun main() {}\n', 'utf8');
      commitAll(dir, 'init kt');

      const ctx = buildAllTrackedContext(dir);

      expect(typeof ctx.sourceFile, 'sourceFile is function').toBe('function');

      const ktFile = (ctx.files ?? []).find(f => f.path === 'a.kt');
      expect(ktFile, 'a.kt in files').toBeDefined();

      const result = await ctx.sourceFile!(ktFile!);
      expect(result, 'sourceFile(ktFile) non-null').not.toBeNull();
      expect(result!.ok, 'ok defined').toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--since path: lang matches languageForPath', () => {
    const dir = makeTempRepo();
    try {
      // first commit
      fs.writeFileSync(path.join(dir, 'seed.ts'), 'const x = 0;\n', 'utf8');
      const firstCommit = commitAll(dir, 'seed');

      // second commit: add all test files
      for (const { name } of FILES) {
        fs.writeFileSync(path.join(dir, name), `// ${name}\n`, 'utf8');
      }
      commitAll(dir, 'add all files');

      // use firstCommit as base (--since equivalent)
      const sinceCtx = buildAllTrackedContext(dir, firstCommit);
      const sinceMap = new Map((sinceCtx.files ?? []).map(f => [f.path, f]));

      for (const { name, lang } of FILES) {
        const f = sinceMap.get(name);
        expect(f, `sinceCtx missing ${name}`).toBeDefined();
        expect(f!.lang, `since lang for ${name}`).toBe(lang);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--since path: sourceFile is a function and resolves non-null for .kt', async () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, 'seed.ts'), 'const x = 0;\n', 'utf8');
      const firstCommit = commitAll(dir, 'seed');

      fs.writeFileSync(path.join(dir, 'a.kt'), 'fun main() {}\n', 'utf8');
      commitAll(dir, 'add kt');

      const ctx = buildAllTrackedContext(dir, firstCommit);

      expect(typeof ctx.sourceFile, 'sourceFile is function (since)').toBe('function');

      const ktFile = (ctx.files ?? []).find(f => f.path === 'a.kt');
      expect(ktFile, 'a.kt in since files').toBeDefined();

      const result = await ctx.sourceFile!(ktFile!);
      expect(result, 'sourceFile(ktFile) non-null (since)').not.toBeNull();
      expect(result!.ok, 'ok defined (since)').toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
