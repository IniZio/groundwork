import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Tree } from '../../src/hooks/lib/tree-sitter.js';
import { findMissingBlankLines, STATEMENT_PADDING_POLICY } from '../../src/analysis/statement-padding.js';

let parse: (src: string) => Tree;

beforeAll(async () => {
  const r = await getParser('typescript', 'ts');
  if (!r.ok) throw new Error(`typescript grammar unavailable: ${r.reason}`);
  parse = (src) => {
    const t = r.parser.parse(src);
    if (!t) throw new Error('parse failed');
    return t;
  };
});

/** [line, column, endLine, endColumn] of every reported violation. */
type Loc = readonly [number, number, number, number];

function locs(src: string): Loc[] {
  return findMissingBlankLines(parse(src).rootNode).map((v) => [v.line, v.column, v.endLine, v.endColumn] as const);
}

interface Case {
  title: string;
  src: string;
  expected: Loc[];
}

describe('statement padding policy', () => {
  it('has the 11 upstream entries in order', () => {
    expect(STATEMENT_PADDING_POLICY.map((e) => e.blankLine)).toEqual([
      'always', 'always', 'always', 'always', 'always', 'always', 'always', 'always', 'always', 'any', 'any',
    ]);
    expect(STATEMENT_PADDING_POLICY).toHaveLength(11);
  }, { timeout: 10_000 });
});

const ENTRIES: Case[] = [
  // 1: prev import, next *
  { title: 'entry 1: statement right after import', src: "import a from 'a';\nfoo();", expected: [[2, 0, 2, 6]] },
  { title: 'entry 1: padded after import', src: "import a from 'a';\n\nfoo();", expected: [] },
  // 2: next top-level non-import
  { title: 'entry 2: top-level statements', src: 'foo();\nbar();', expected: [[2, 0, 2, 6]] },
  { title: 'entry 2: padded top-level', src: 'foo();\n\nbar();', expected: [] },
  { title: 'entry 2: not top-level, no entry applies', src: '{\n  foo();\n  bar();\n}', expected: [] },
  // 3: prev top-level non-import, next *
  { title: 'entry 3: import right after top-level statement', src: "foo();\nimport a from 'a';", expected: [[2, 0, 2, 18]] },
  { title: 'entry 3: padded', src: "foo();\n\nimport a from 'a';", expected: [] },
  // 4: next function/class/interface/type
  { title: 'entry 4: function after statement', src: '{\n  foo();\n  function f() {}\n}', expected: [[3, 2, 3, 17]] },
  { title: 'entry 4: class after statement', src: '{\n  foo();\n  class A {}\n}', expected: [[3, 2, 3, 12]] },
  { title: 'entry 4: interface after statement', src: '{\n  foo();\n  interface I {}\n}', expected: [[3, 2, 3, 16]] },
  { title: 'entry 4: type after statement', src: '{\n  foo();\n  type T = 1;\n}', expected: [[3, 2, 3, 13]] },
  { title: 'entry 4: padded', src: '{\n  foo();\n\n  function f() {}\n}', expected: [] },
  // 5: prev function/class/interface/type
  { title: 'entry 5: statement after class', src: '{\n  class A {}\n  foo();\n}', expected: [[3, 2, 3, 8]] },
  { title: 'entry 5: statement after type', src: '{\n  type T = 1;\n  foo();\n}', expected: [[3, 2, 3, 8]] },
  { title: 'entry 5: padded', src: '{\n  class A {}\n\n  foo();\n}', expected: [] },
  // 6: next multiline binding
  {
    title: 'entry 6: multiline const after statement',
    src: '{\n  foo();\n  const a = {\n    b: 1,\n  };\n}',
    expected: [[3, 2, 3, 13]],
  },
  { title: 'entry 6: multiline let after statement', src: '{\n  foo();\n  let a =\n    1;\n}', expected: [[3, 2, 3, 9]] },
  { title: 'entry 6: multiline var after statement', src: '{\n  foo();\n  var a =\n    1;\n}', expected: [[3, 2, 3, 9]] },
  { title: 'entry 6: single-line const needs nothing', src: '{\n  foo();\n  const a = 1;\n}', expected: [] },
  { title: 'entry 6: padded', src: '{\n  foo();\n\n  const a = {\n    b: 1,\n  };\n}', expected: [] },
  // 7: prev multiline binding
  { title: 'entry 7: statement after multiline const', src: '{\n  const a = {\n    b: 1,\n  };\n  foo();\n}', expected: [[5, 2, 5, 8]] },
  { title: 'entry 7: single-line const needs nothing', src: '{\n  const a = 1;\n  foo();\n}', expected: [] },
  { title: 'entry 7: padded', src: '{\n  const a = {\n    b: 1,\n  };\n\n  foo();\n}', expected: [] },
  // 8: next return/if/switch/try/for/while/do
  { title: 'entry 8: return', src: 'function f() {\n  foo();\n  return 1;\n}', expected: [[3, 2, 3, 11]] },
  { title: 'entry 8: if', src: '{\n  foo();\n  if (a) b();\n}', expected: [[3, 2, 3, 13]] },
  { title: 'entry 8: switch', src: '{\n  foo();\n  switch (a) {}\n}', expected: [[3, 2, 3, 15]] },
  { title: 'entry 8: try', src: '{\n  foo();\n  try {} finally {}\n}', expected: [[3, 2, 3, 19]] },
  { title: 'entry 8: for', src: '{\n  foo();\n  for (;;) {}\n}', expected: [[3, 2, 3, 13]] },
  { title: 'entry 8: for-of', src: '{\n  foo();\n  for (const a of b) {}\n}', expected: [[3, 2, 3, 23]] },
  { title: 'entry 8: while', src: '{\n  foo();\n  while (a) {}\n}', expected: [[3, 2, 3, 14]] },
  { title: 'entry 8: do', src: '{\n  foo();\n  do {} while (a);\n}', expected: [[3, 2, 3, 18]] },
  { title: 'entry 8: padded return', src: 'function f() {\n  foo();\n\n  return 1;\n}', expected: [] },
  { title: 'entry 8: labeled loop is unwrapped', src: '{\n  foo();\n  a: while (b) {}\n}', expected: [[3, 2, 3, 17]] },
  // 9: prev block-like
  { title: 'entry 9: statement after block-like if', src: '{\n  if (a) {\n  }\n  foo();\n}', expected: [[4, 2, 4, 8]] },
  { title: 'entry 9: statement after IIFE', src: '{\n  (() => {})();\n  foo();\n}', expected: [[3, 2, 3, 8]] },
  { title: 'entry 9: non-block-like if needs nothing', src: '{\n  if (a) b();\n  foo();\n}', expected: [] },
  { title: 'entry 9: padded', src: '{\n  if (a) {\n  }\n\n  foo();\n}', expected: [] },
  // 10: import after import overrides entries 1-3
  { title: 'entry 10: import after import', src: "import a from 'a';\nimport b from 'b';", expected: [] },
  { title: 'entry 10: import then non-import still reports', src: "import a from 'a';\nimport b from 'b';\nfoo();", expected: [[3, 0, 3, 6]] },
  // 11: overload signature then overload/implementation overrides entries 2-5
  {
    title: 'entry 11: overloads then implementation',
    src: 'function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: any) {}',
    expected: [],
  },
  { title: 'entry 11: exported overloads', src: 'export function f(): void;\nexport function f() {}', expected: [] },
  { title: 'entry 11: declared overloads', src: 'declare function f(): void;\ndeclare function f(a: 1): void;', expected: [] },
  { title: 'entry 11: plain functions still report', src: 'function a() {}\nfunction b() {}', expected: [[2, 0, 2, 15]] },
];

const COMMENTS: Case[] = [
  { title: 'blank before comment is padded', src: 'A();\n\n// c\nB();', expected: [] },
  { title: 'blank after comment is padded', src: 'A();\n// c\n\nB();', expected: [] },
  { title: 'comment without blank is not padded', src: 'A();\n// c\nB();', expected: [[3, 0, 3, 4]] },
  { title: 'same line is not padded', src: 'A(); B();', expected: [[1, 5, 1, 9]] },
  { title: 'trailing comment is not padding', src: 'A(); // t\nB();', expected: [[2, 0, 2, 4]] },
  { title: 'block comment between', src: 'A();\n/* c\n*/\nB();', expected: [[4, 0, 4, 4]] },
  { title: 'comments are not statements', src: '{\n  // c\n  foo();\n}', expected: [] },
  { title: 'semicolon on its own line is skipped', src: 'foo()\n\n;bar()', expected: [] },
];

const SCOPES: Case[] = [
  { title: 'blank line already present', src: 'foo();\n\nbar();\n\nfunction f() {\n  a();\n\n  return 1;\n}', expected: [] },
  { title: 'extra blank lines are never reported', src: 'foo();\n\n\n\nbar();', expected: [] },
  {
    title: 'nested blocks report in position order',
    src: 'foo();\nfunction f() {\n  a();\n  return 1;\n}\nbar();',
    expected: [[2, 0, 2, 14], [4, 2, 4, 11], [6, 0, 6, 6]],
  },
  { title: 'arrow function body', src: 'const f = () => {\n  a();\n  return 1;\n};', expected: [[3, 2, 3, 11]] },
  { title: 'class static block', src: 'class A {\n  static {\n    a();\n    return;\n  }\n}', expected: [[4, 4, 4, 11]] },
  { title: 'namespace body', src: 'namespace N {\n  a();\n  b();\n}\nnamespace M {\n  a();\n  return;\n}', expected: [[5, 0, 5, 13], [7, 2, 7, 9]] },
  { title: 'class members are not paired', src: 'class A {\n  a() {}\n  b() {}\n}', expected: [] },
  { title: 'interface members are not paired', src: 'interface I {\n  a(): void;\n  b(): void;\n}', expected: [] },
    {
    title: 'multiline next reports to end of its first line',
    src: 'foo();\nif (a) {\n  b();\n}',
    expected: [[2, 0, 2, 8]],
  },
  {
    title: 'switch case consequents',
    src: 'switch (x) {\n  case 1:\n    a();\n    return 1;\n  default:\n    b();\n}',
    expected: [[4, 4, 4, 13]],
  },
  {
    title: 'switch cases are paired with each other (block-like prev)',
    src: 'switch (x) {\n  case 1: {\n  }\n  case 2:\n    b();\n}',
    expected: [[4, 2, 4, 9]],
  },
  {
    title: 'switch cases padded',
    src: 'switch (x) {\n  case 1: {\n  }\n\n  case 2:\n    b();\n}',
    expected: [],
  },
  { title: 'case value is not a statement', src: 'switch (x) {\n  case a:\n  case b:\n    c();\n}', expected: [] },
  { title: 'non-ASCII before statement on its line', src: "const s = '😀'; foo();", expected: [[1, 16, 1, 22]] },
  { title: 'multiline next with non-ASCII first line', src: "const s = '😀';\nif (a) { // é\n}", expected: [[2, 0, 2, 13]] },
];

describe('findMissingBlankLines', () => {
  for (const group of [ENTRIES, COMMENTS, SCOPES]) {
    for (const c of group) {
      it(
        c.title,
        () => {
          expect(locs(c.src)).toEqual(c.expected as Loc[]);
        },
        { timeout: 10_000 },
      );
    }
  }

  it('returns prev/next nodes compared by id', () => {
    const tree = parse('foo();\nbar();');
    const [v] = findMissingBlankLines(tree.rootNode);
    const stmts = tree.rootNode.namedChildren;
    expect(v?.prev.id).toBe(stmts[0]?.id);
    expect(v?.next.id).toBe(stmts[1]?.id);
  }, { timeout: 10_000 });

  it('is sorted by position', () => {
    const lines = findMissingBlankLines(parse('a();\nb();\nfunction f() {\n  c();\n  return 1;\n}\nd();').rootNode).map((v) => v.line);
    expect(lines).toEqual([...lines].sort((x, y) => x - y));
  }, { timeout: 10_000 });
});
