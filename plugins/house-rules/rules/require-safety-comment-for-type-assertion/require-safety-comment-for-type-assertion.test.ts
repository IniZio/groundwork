import { describe, it, expect, beforeAll } from 'bun:test';
import path from 'node:path';
import rule from './index.js';
import * as checkModule from './checks/require-safety-comment-for-type-assertion.js';
import { loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import { parserForPath } from '../../src/hooks/languages/parse.js';
import { findComments } from '../../src/hooks/lib/comment-density.js';
import type { ScopedFile } from '../../src/engine/types.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';

const CHECKS_DIR = path.join(import.meta.dir, 'checks');
const MSG = '[require-safety-comment-for-type-assertion] This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.';
const T = 60_000;

for (const { rule: view, cases } of await loadIsolatedCases(rule, CHECKS_DIR)) ruleTester(view, cases);

function fileFor(p: string, text: string): ScopedFile {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return {
    path: p,
    text,
    lang: 'typescript',
    addedHunks: [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }],
  };
}

describe('require-safety-comment-for-type-assertion behaviour', () => {
  it('reports the exact message on the assertion line', async () => {
    const f = await rule.check({ repoRoot: '/tmp', mode: 'cli', files: [fileFor('src/a.ts', 'const a = 1;\nconst y = x as Foo;\n')] });
    expect(f.map((x) => ({ line: x.line, message: x.message }))).toEqual([{ line: 2, message: MSG }]);
    expect(f[0].ruleId).toBe('require-safety-comment-for-type-assertion');
  }, T);

  it('reports the assertion line, not the statement line, for a multi-line statement', async () => {
    const src = 'const y = foo(\n  x as Foo,\n);\n';
    const f = await rule.check({ repoRoot: '/tmp', mode: 'cli', files: [fileFor('src/a.ts', src)] });
    expect(f.map((x) => x.line)).toEqual([2]);
  }, T);

  it('is silent for a justified assertion', async () => {
    const f = await rule.check({ repoRoot: '/tmp', mode: 'cli', files: [fileFor('src/a.ts', '// SAFETY: x checked above\nconst y = x as Foo;\n')] });
    expect(f).toHaveLength(0);
  }, T);
});

describe('require-safety-comment-for-type-assertion / comment-density seam', () => {
  let parse: (src: string) => Tree;
  const tsParser = parserForPath(getParser, 'sample.ts');

  beforeAll(async () => {
    const r = await getParser('typescript', 'ts');
    if (!r.ok) throw new Error(`typescript grammar unavailable: ${r.reason}`);
    parse = (src) => {
      const t = r.parser.parse(src);
      if (!t) throw new Error('parse failed');
      return t;
    };
  }, T);

  interface Row { name: string; code: string; hasAssertion: boolean; expected: boolean }
  const rows: Row[] = [
    { name: 'justified as', code: '// SAFETY: x checked above\nconst y = x as Foo;\n', hasAssertion: true, expected: true },
    { name: 'export-wrapped', code: '// SAFETY: x checked above\nexport const y = x as Foo;\n', hasAssertion: true, expected: true },
    { name: 'angle-bracket', code: '// SAFETY: x checked above\nconst y = <Foo>x;\n', hasAssertion: true, expected: true },
    { name: 'blank-line gap', code: '// SAFETY: x checked above\n\nconst y = x as Foo;\n', hasAssertion: true, expected: true },
    { name: 'comment after', code: 'const y = x as Foo;\n// SAFETY: x checked above\n', hasAssertion: true, expected: false },
    { name: 'SAFETY with nothing', code: '// SAFETY:\nconst z = 1;\nconst y = x as Foo;\n', hasAssertion: true, expected: false },
    { name: 'as const', code: '// SAFETY: literal\nconst y = [1, 2] as const;\n', hasAssertion: false, expected: false },
    { name: 'satisfies', code: '// SAFETY: shape checked\nconst y = x satisfies Foo;\n', hasAssertion: false, expected: false },
  ];

  const ruleSilent = (code: string): boolean => {
    const root: Node = parse(code).rootNode;
    return checkModule.check(root, code, undefined, 'src/a.ts').length === 0;
  };

  const safetyExempt = async (code: string): Promise<boolean> => {
    const r = await findComments(code, 'typescript', tsParser);
    if (!r.ok) throw new Error(`findComments failed: ${r.reason}`);
    const safety = r.comments.filter((c) => c.text.includes('SAFETY'));
    expect(safety.length).toBe(1);
    return safety.every((c) => c.exempt && c.exemptReason === 'safety');
  };

  for (const row of rows.filter((r) => r.hasAssertion)) {
    it(`agree on "${row.name}" and both equal ${row.expected}`, async () => {
      const silent = ruleSilent(row.code);
      const exempt = await safetyExempt(row.code);
      expect({ silent, exempt }).toEqual({ silent: row.expected, exempt: row.expected });
      expect(silent).toBe(exempt);
    }, T);
  }

  for (const row of rows.filter((r) => !r.hasAssertion)) {
    it(`"${row.name}": rule silent, comment not exempt as safety`, async () => {
      expect(ruleSilent(row.code)).toBe(true);
      expect(await safetyExempt(row.code)).toBe(false);
    }, T);
  }

  it('fixture set is non-vacuous on both sides', () => {
    const asserted = rows.filter((r) => r.hasAssertion);
    expect(asserted.some((r) => r.expected)).toBe(true);
    expect(asserted.some((r) => !r.expected)).toBe(true);
  }, T);
});
