import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import rule from './index.js';
import { loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import type { ScopedFile } from '../../src/engine/types.js';

const CHECKS_DIR = path.join(import.meta.dir, 'checks');
const MSG = '[require-readable-spacing] Expected blank line before this statement.';
const T = 60_000;

for (const { rule: view, cases } of await loadIsolatedCases(rule, CHECKS_DIR)) ruleTester(view, cases);

function fileFor(p: string, text: string, lang: ScopedFile['lang'] = 'typescript'): ScopedFile {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return {
    path: p,
    text,
    lang,
    addedHunks: [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }],
  };
}

const run = (p: string, text: string, lang: ScopedFile['lang'] = 'typescript') =>
  rule.check({ repoRoot: '/tmp', mode: 'cli', files: [fileFor(p, text, lang)] });

describe('require-readable-spacing behaviour', () => {
  it('reports the exact message and ruleId on the line of the statement after the missing blank line', async () => {
    const f = await run('src/a.ts', 'const a = 1;\nconst b = 2;\n');
    expect(f.map((x) => ({ line: x.line, message: x.message }))).toEqual([{ line: 2, message: MSG }]);
    expect(f[0].ruleId).toBe('require-readable-spacing');
  }, T);

  it('reports the later statement line when earlier pairs are padded', async () => {
    const f = await run('src/a.ts', 'import { a } from "a";\n\nconst b = a;\nconst c = b;\n');
    expect(f.map((x) => ({ line: x.line, message: x.message }))).toEqual([{ line: 4, message: MSG }]);
  }, T);

  it('is warn-only: findings carry no fix', async () => {
    const f = await run('src/a.ts', 'const a = 1;\nconst b = 2;\n');
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect((x as { fix?: unknown }).fix).toBeUndefined();
    expect((rule as { fix?: unknown }).fix).toBeUndefined();
  }, T);

  it('never asks to remove extra blank lines', async () => {
    const f = await run('src/a.ts', 'const a = 1;\n\n\n\nconst b = 2;\n');
    expect(f).toHaveLength(0);
  }, T);

  it('is silent when blank lines are present', async () => {
    const f = await run('src/a.ts', 'const a = 1;\n\nconst b = 2;\n');
    expect(f).toHaveLength(0);
  }, T);

  it('checks .js files too (tsOnly=false)', async () => {
    const f = await run('src/a.js', 'const a = 1;\nconst b = 2;\n', 'typescript');
    expect(f.map((x) => ({ line: x.line, message: x.message }))).toEqual([{ line: 2, message: MSG }]);
  }, T);
});
