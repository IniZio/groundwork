import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  isOverloadOrImplementation,
  isOverloadSignature,
  matchesStatementType,
  unwrapLabeled,
  type PaddingStatementType,
} from '../../src/analysis/padding-statement-types.js';

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

/** First top-level statement of the source (comments skipped). */
function stmt(src: string): Node {
  const first = parse(src).rootNode.namedChildren.find((c: Node) => c.type !== 'comment');
  if (!first) throw new Error(`no statement in ${src}`);
  return first;
}

type Row = [title: string, src: string, expected: boolean, pick?: string];

const TYPE_CASES: Record<PaddingStatementType, Row[]> = {
  import: [
    ['import', "import a from 'a';", true],
    ['import type', "import type { A } from 'a';", true],
    ['export from is not import', "export * from 'a';", false],
  ],
  function: [
    ['declaration', 'function f() {}', true],
    ['generator', 'function* g() {}', true],
    ['overload signature', 'function f(): void;', false],
    ['export function', 'export function f() {}', false],
  ],
  class: [
    ['class', 'class C {}', true],
    ['export class', 'export class C {}', false],
    ['abstract class', 'abstract class C {}', false],
    ['declare class', 'declare class C {}', false],
    ['decorated class', '@d class C {}', false],
  ],
  interface: [
    ['interface', 'interface I {}', true],
    ['export interface', 'export interface I {}', false],
    ['type alias', 'type T = {};', false],
  ],
  type: [
    ['type alias', 'type T = string;', true],
    ['export type', 'export type T = string;', false],
    ['interface', 'interface I {}', false],
  ],
  'multiline-const': [
    ['multiline', 'const a = {\n  b: 1,\n};', true],
    ['single line', 'const a = 1;', false],
    ['export const', 'export const a = {\n  b: 1,\n};', false],
    ['multiline let', 'let a = {\n  b: 1,\n};', false],
  ],
  'multiline-let': [
    ['multiline', 'let a = {\n  b: 1,\n};', true],
    ['single line', 'let a = 1;', false],
    ['multiline const', 'const a = {\n  b: 1,\n};', false],
  ],
  'multiline-var': [
    ['multiline', 'var a = {\n  b: 1,\n};', true],
    ['single line', 'var a = 1;', false],
    ['multiline let', 'let a = {\n  b: 1,\n};', false],
  ],
  // tree-sitter-typescript 0.23 parses `using x = f();` as an assignment expression statement: not mirrored.
  'multiline-using': [
    ['using parses as expression, not mirrored', 'using x = f(\n  1,\n);', false],
    ['await using parses as expression, not mirrored', 'await using x = f(\n  1,\n);', false],
    ['const is not using', 'const x = f(\n  1,\n);', false],
  ],
  return: [
    ['return', 'function f() { return 1; }', true, 'return_statement'],
    ['if', 'if (x) y;', false],
  ],
  if: [
    ['if', 'if (x) y;', true],
    ['while', 'while (x) y;', false],
  ],
  switch: [
    ['switch', 'switch (x) {}', true],
    ['if', 'if (x) y;', false],
  ],
  try: [
    ['try', 'try {} catch {}', true],
    ['if', 'if (x) y;', false],
  ],
  for: [
    ['for', 'for (;;) {}', true],
    ['for-of', 'for (const a of b) {}', true],
    ['for-in', 'for (const a in b) {}', true],
    ['for await', 'async function f() { for await (const a of b) {} }', true, 'for_in_statement'],
    ['labeled for', 'L: for (;;) {}', true],
    ['while', 'while (x) {}', false],
  ],
  while: [
    ['while', 'while (x) {}', true],
    ['do-while', 'do {} while (x);', false],
    ['for', 'for (;;) {}', false],
  ],
  do: [
    ['do', 'do {} while (x);', true],
    ['while', 'while (x) {}', false],
  ],
  'block-like': [
    ['function declaration', 'function f() {}', true],
    ['if/else', 'if (x) {} else {}', true],
    ['try/finally', 'try {} finally {}', true],
    ['arrow const', 'const f = () => {}', true],
    ['arrow const with semicolon', 'const f = () => {};', true],
    ['export function', 'export function f() {}', true],
    ['switch', 'switch (x) { case 1: break; }', true],
    ['do block', 'do {} while (x);', true],
    ['IIFE', '(function () {})();', true],
    ['arrow IIFE', '(() => {})();', true],
    ['unary IIFE', '!function () {}();', true],
    ['sequence callee IIFE', '(0, function () {})();', true],
    ['labeled block', 'L: { }', true],
    ['class', 'class C {}', false],
    ['object literal', 'const o = {};', false],
    ['interface', 'interface I {}', false],
    ['enum', 'enum E {}', false],
    ['namespace', 'namespace N {}', false],
    ['declare module', "declare module 'm' {}", false],
    ['static block in class', 'class C { static {} }', false],
    ['type literal', 'type T = {};', false],
    ['if without block', 'if (x) y;', false],
    ['call with non-function callee', 'foo();', false],
    ['do without block', 'do x(); while (y);', false],
  ],
};

const COMMENT_AND_LABELS = [
  ['comment is never a statement', '// hi', 'block-like'],
] as const;

describe('matchesStatementType', () => {
  for (const [type, rows] of Object.entries(TYPE_CASES) as [PaddingStatementType, Row[]][]) {
    for (const [title, src, expected, pick] of rows) {
      it(
        `${type}: ${title}`,
        () => {
          const node = pick ? parse(src).rootNode.descendantsOfType(pick)[0] : stmt(src);
          if (!node) throw new Error(`no node in ${src}`);
          expect(matchesStatementType(node, type)).toBe(expected);
        },
        { timeout: 10_000 },
      );
    }
  }

  for (const [title, src, type] of COMMENT_AND_LABELS) {
    it(
      title,
      () => {
        const comment = parse(src).rootNode.namedChildren.find((c: Node) => c.type === 'comment');
        if (!comment) throw new Error('no comment');
        expect(matchesStatementType(comment, type)).toBe(false);
      },
      { timeout: 10_000 },
    );
  }
});

describe('unwrapLabeled', () => {
  it(
    'unwraps nested labels',
    () => {
      const node = stmt('A: B: for (;;) {}');
      expect(unwrapLabeled(node).type).toBe('for_statement');
    },
    { timeout: 10_000 },
  );

  it(
    'returns unlabeled node unchanged',
    () => {
      const node = stmt('for (;;) {}');
      expect(unwrapLabeled(node).id).toBe(node.id);
    },
    { timeout: 10_000 },
  );
});

const OVERLOAD_CASES: [title: string, src: string, signature: boolean, either: boolean][] = [
  ['signature', 'function f(): void;', true, true],
  ['export signature', 'export function f(): void;', true, true],
  ['declare signature', 'declare function f(): void;', true, true],
  ['export declare signature', 'export declare function f(): void;', true, true],
  ['implementation', 'function f() {}', false, true],
  ['export implementation', 'export function f() {}', false, true],
  ['const', 'const f = 1;', false, false],
  ['class', 'class C {}', false, false],
  ['export const', 'export const f = 1;', false, false],
  ['declare class', 'declare class C {}', false, false],
];

describe('overload selectors', () => {
  for (const [title, src, signature, either] of OVERLOAD_CASES) {
    it(
      `isOverloadSignature: ${title}`,
      () => expect(isOverloadSignature(stmt(src))).toBe(signature),
      { timeout: 10_000 },
    );
    it(
      `isOverloadOrImplementation: ${title}`,
      () => expect(isOverloadOrImplementation(stmt(src))).toBe(either),
      { timeout: 10_000 },
    );
  }
});
