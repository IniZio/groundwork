import { describe, it, expect, afterAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import { parserForPath } from '../../src/hooks/languages/parse.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  classifyUnsafeDictionary,
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
  isPopulatedObjectExpression,
} from '../../src/analysis/dictionary-types.js';

const loaded = await parserForPath(getParser, 'x.ts')('typescript');
if (!loaded.ok) throw new Error(`typescript grammar unavailable: ${loaded.reason}`);
const trees: Tree[] = [];
afterAll(() => {
  for (const t of trees) t.delete();
});

function parse(src: string): Tree {
  const t = loaded.ok ? loaded.parser.parse(src) : null;
  if (!t) throw new Error('parse failed');
  trees.push(t);
  return t;
}

function target(src: string): string | null {
  const root = parse(src.includes('type Target') ? `${src}\ntype Probe = Target;` : src).rootNode;
  const probe = root.descendantsOfType('type_alias_declaration').find((a: Node | null) => a?.childForFieldName('name')?.text === 'Probe');
  const value = probe?.childForFieldName('value');
  if (!value) throw new Error('no probe');
  return classifyWideningTarget(value, createTypeEnvironment(root))?.kind ?? null;
}

function expr(src: string): Node {
  const v = parse(`const x = ${src};`).rootNode.descendantsOfType('variable_declarator')[0]?.childForFieldName('value');
  if (!v) throw new Error('no value');
  return v;
}

describe('classifyWideningTarget', () => {
  const cases: [string, string, string | null][] = [
    ['unknown', 'type Target = unknown;', 'unknown'],
    ['object keyword', 'type Target = object;', 'object'],
    ['paren readonly unknown', 'type Target = readonly (unknown);', 'unknown'],
    ['index signature', 'type Target = { [k: string]: number };', 'open dictionary'],
    ['anonymous object', 'type Probe = { a: number };', 'anonymous object'],
    ['empty literal', 'type Probe = {};', null],
    ['mapped type', 'type Probe = { [K in "a"]: number };', 'open dictionary'],
    ['Record string', 'type Target = Record<string, number>;', 'open dictionary'],
    ['Record PropertyKey', 'type Target = Record<PropertyKey, number>;', 'open dictionary'],
    ['Record literal keys', 'type Target = Record<"a" | "b", number>;', null],
    ['Partial<Record>', 'type Target = Partial<Record<string, number>>;', 'open dictionary'],
    ['shadowed Record', 'type Record<K, V> = { a: V };\ntype Target = Record<string, number>;', null],
    ['alias to unknown', 'type U = unknown;\ntype Target = U;', 'unknown'],
    ['alias to dictionary', 'type D = { [k: string]: 1 };\ntype Target = D;', 'open dictionary'],
    ['alias to anonymous object is not broad', 'type O = { a: 1 };\ntype Target = O;', null],
    ['generic dictionary container', 'type Box<T> = { [k: string]: T };\ntype Probe = Box<number>;', 'generic container'],
    ['alias of generic dictionary', 'type Box<T> = { [k: string]: T };\ntype Target = Box<number>;', 'open dictionary'],
    ['generic non-dictionary', 'type Box<T> = { v: T };\ntype Probe = Box<number>;', null],
    ['alias mapped broad key', 'type M = { [K in string]: 1 };\ntype Target = M;', 'open dictionary'],
    ['alias mapped narrow key', 'type M = { [K in "a" | "b"]: 1 };\ntype Target = M;', null],
    ['alias Record via key alias', 'type K = string;\ntype R = Record<K, 1>;\ntype Target = R;', 'open dictionary'],
    ['plain string', 'type Target = string;', null],
    ['unknown reference', 'type Target = Missing;', null],
    ['cyclic alias', 'type A = B;\ntype B = A;\ntype Target = A;', null],
  ];
  for (const [name, src, want] of cases) it(name, () => expect(target(src)).toBe(want));
});

describe('isPopulatedObjectExpression', () => {
  for (const [src, want] of [
    ['{ a: 1 }', true],
    ['({ a: 1 })', true],
    ['{ a: 1 } as X', true],
    ['<X>{ a: 1 }', true],
    ['y!', false],
    ['{}', false],
    ['{ /* c */ }', false],
    ['[1]', false],
    ['{ a: 1 } satisfies X', false],
    ['foo', false],
  ] as const) it(src, () => expect(isPopulatedObjectExpression(expr(src))).toBe(want));
});

describe('isKnownEvidenceExpression', () => {
  for (const [src, want] of [
    ['{}', true],
    ['[]', true],
    ['() => 1', true],
    ['function () {}', true],
    ['class {}', true],
    ['new Foo()', true],
    ['1', true],
    ['"s"', true],
    ['null', true],
    ['true', true],
    ['`t`', true],
    ['-1', true],
    ['({}) as X', true],
    ['({}) satisfies X', true],
    ['foo', false],
    ['foo()', false],
    ['a.b', false],
    ['a + b', false],
    ['undefined', false],
  ] as const) it(src, () => expect(isKnownEvidenceExpression(expr(src))).toBe(want));
});

describe('classifyUnsafeDictionary unchanged', () => {
  it('still flags Record<string, unknown>', () => {
    const root = parse('type T = Record<string, unknown>;').rootNode;
    const v = root.descendantsOfType('type_alias_declaration')[0]?.childForFieldName('value');
    expect(classifyUnsafeDictionary(v!, createTypeEnvironment(root))).toBe('unknown');
  });
});
