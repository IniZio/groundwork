import { describe, it, expect, afterEach } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSourceFiles } from '../../src/engine/source-file.js';
import { buildContext } from '../../src/engine/context.js';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { ParserFactory } from '../../src/hooks/languages/parse.js';
import type { LoadResult } from '../../src/hooks/lib/tree-sitter-loader.js';

// ---------------------------------------------------------------------------
// Counting factory
// ---------------------------------------------------------------------------

interface Counts {
  factory: number;
  parse: number;
}

function makeCountingFactory(base: ParserFactory = getParser): { factory: ParserFactory; counts: Counts } {
  const counts: Counts = { factory: 0, parse: 0 };

  const factory: ParserFactory = async (lang) => {
    counts.factory++;
    const result: LoadResult = await base(lang);
    if (!result.ok) return result;
    const realParser = result.parser;
    const realParse = realParser.parse.bind(realParser);
    // Wrap parse to count; only parse() is accessed by parseText()
    const wrappedParser = Object.assign(Object.create(realParser as object) as typeof realParser, {
      parse(text: string) {
        counts.parse++;
        return realParse(text);
      },
    });
    return { ok: true, parser: wrappedParser, language: result.language };
  };

  return { factory, counts };
}

// ---------------------------------------------------------------------------
// Temp repo helpers (guard mode needs HEAD:<path>)
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];

function tmpDir(label: string): string {
  const d = path.join(os.tmpdir(), `gw-sf-${label}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  tmpRoots.push(d);
  return d;
}

afterEach(() => {
  for (const r of tmpRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ }
  }
  tmpRoots.length = 0;
});

function initRepo(dir: string): void {
  execSync('command git init', { cwd: dir, shell: '/bin/bash' });
  execSync('command git config user.email "t@t.com"', { cwd: dir, shell: '/bin/bash' });
  execSync('command git config user.name "T"', { cwd: dir, shell: '/bin/bash' });
}

function commit(dir: string): void {
  execSync('command git add -A', { cwd: dir, shell: '/bin/bash' });
  execSync('command git commit -m "init"', { cwd: dir, shell: '/bin/bash' });
}

// ---------------------------------------------------------------------------
// Test texts
// ---------------------------------------------------------------------------

// TypeScript text with exactly 2 line comments
const TS_TWO_COMMENTS = `// first comment
const a = 1;
// second comment
const b = 2;
`;

// TypeScript with a syntax error (mismatched braces)
const TS_SYNTAX_ERROR = `function broken( {
  const x = 1;
`;

// ---------------------------------------------------------------------------
// AC1 — memoization: same text+lang → parse count 1
// ---------------------------------------------------------------------------

describe('createSourceFiles — memoization', () => {
  it('parsing the same text twice returns the cached result (parse count 1)', async () => {
    const { factory, counts } = makeCountingFactory();
    const sf = createSourceFiles(factory);

    try {
      const r1 = await sf.get('typescript', TS_TWO_COMMENTS);
      const r2 = await sf.get('typescript', TS_TWO_COMMENTS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) throw new Error('unexpected fail');

      // Same source object from cache
      expect(r1.source).toBe(r2.source);

      // Parser called exactly once despite two get() calls
      expect(counts.parse).toBe(1);

      // Language and text preserved
      expect(r1.source.language).toBe('typescript');
      expect(r1.source.text).toBe(TS_TWO_COMMENTS);

      // 2 line comments in the fixture
      expect(r1.source.comments).toHaveLength(2);
      expect(r1.source.comments[0].text).toContain('first comment');
      expect(r1.source.comments[1].text).toContain('second comment');

      // Clean source — no error rows
      expect(r1.source.errorRows.size).toBe(0);
    } finally {
      sf.dispose();
    }
  });


  it('different text produces a separate parse (parse count 2)', async () => {
    const { factory, counts } = makeCountingFactory();
    const sf = createSourceFiles(factory);

    try {
      const r1 = await sf.get('typescript', TS_TWO_COMMENTS);
      const r2 = await sf.get('typescript', 'const z = 42;\n');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) throw new Error('unexpected fail');

      expect(r1.source).not.toBe(r2.source);

      expect(counts.parse).toBe(2);
    } finally {
      sf.dispose();
    }
  });


  it('same text under a different language produces a separate parse (parse count 2)', async () => {
    const { factory, counts } = makeCountingFactory();
    const sf = createSourceFiles(factory);

    try {
      const r1 = await sf.get('typescript', TS_TWO_COMMENTS);
      const r2 = await sf.get('tsx', TS_TWO_COMMENTS);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      if (!r1.ok || !r2.ok) throw new Error('unexpected fail');

      expect(r1.source).not.toBe(r2.source);

      expect(counts.parse).toBe(2);

      expect(r1.source.language).toBe('typescript');
      expect(r2.source.language).toBe('tsx');
    } finally {
      sf.dispose();
    }
  });


  it('syntax-error text returns ok:true with non-empty errorRows', async () => {
    const { factory } = makeCountingFactory();
    const sf = createSourceFiles(factory);

    try {
      const result = await sf.get('typescript', TS_SYNTAX_ERROR);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected fail');

      expect(result.source.errorRows.size).toBeGreaterThan(0);
      expect(result.source.language).toBe('typescript');
      expect(result.source.text).toBe(TS_SYNTAX_ERROR);
    } finally {
      sf.dispose();
    }
  });


  it('failing factory propagates ok:false with the factory reason', async () => {
    const failingFactory: ParserFactory = async () => ({ ok: false, reason: 'x' });
    const sf = createSourceFiles(failingFactory);

    try {
      const result = await sf.get('typescript', 'const x = 1;\n');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected ok');

      expect(result.reason).toBe('x');
    } finally {
      sf.dispose();
    }
  });
});


describe('buildContext — sourceFile memoization', () => {
  it('ctx.sourceFile() twice returns the same parse, count 1; non-language file returns null', async () => {
    const repo = tmpDir('sf-ctx');
    initRepo(repo);

    writeFileSync(path.join(repo, 'a.ts'), 'const old = 1;\n');
    commit(repo);

    const { factory, counts } = makeCountingFactory();

    const postText = TS_TWO_COMMENTS;

    const ctx = buildContext({
      repoRoot: repo,
      mode: 'guard',
      files: ['a.ts'],
      postText,
      parserFactory: factory,
    });

    expect(ctx.sourceFile).toBeDefined();
    const sourceFile = ctx.sourceFile!;

    const f = ctx.files![0];
    expect(f.path).toBe('a.ts');
    expect(f.lang).toBe('typescript');

    const r1 = await sourceFile(f);
    expect(r1).not.toBeNull();
    expect(r1!.ok).toBe(true);

    const r2 = await sourceFile(f);
    expect(r2).not.toBeNull();
    expect(r2!.ok).toBe(true);

    if (!r1!.ok || !r2!.ok) throw new Error('unexpected fail');
    expect(r1!.source).toBe(r2!.source);

    expect(counts.parse).toBe(1);

    const noLangFile = { path: 'README.md', text: '# Hello\n' };
    const nullResult = await sourceFile(noLangFile);
    expect(nullResult).toBeNull();

    expect(counts.parse).toBe(1);
  });
});
