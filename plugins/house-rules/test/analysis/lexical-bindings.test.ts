import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  analyzeBindings,
  bindingBuildCount,
  referencesOf,
  resolve,
  type BindingKind,
  type Namespace,
} from '../../src/analysis/lexical-bindings.js';

type Parse = (src: string) => Tree;
let parse: Parse;

beforeAll(async () => {
  const r = await getParser('typescript', 'ts');
  if (!r.ok) throw new Error(`typescript grammar unavailable: ${r.reason}`);
  parse = (src) => {
    const t = r.parser.parse(src);
    if (!t) throw new Error('parse failed');
    return t;
  };
});

interface Found {
  kind: BindingKind;
  declared?: boolean;
  namespaces?: Namespace[];
}

interface Case {
  title: string;
  src: string;
  ns?: Namespace;
  expected: Found | null;
}

function offsetAfter(src: string, marker: string): number {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`missing ${marker}`);
  let i = at + marker.length;
  while (/\s/.test(src[i] ?? '')) i++;
  return i;
}

function nodeAt(node: Node, offset: number): Node | null {
  if ((node.type === 'identifier' || node.type === 'type_identifier') && node.startIndex === offset) return node;
  for (const c of node.children) {
    if (c.startIndex <= offset && offset < c.endIndex) {
      const hit = nodeAt(c, offset);
      if (hit) return hit;
    }
  }
  return null;
}

const A: Case[] = [
  { title: 'AC1 inner shadow beats outer', src: 'const x = 1; function f() { const /*d*/x = 2; return /*@*/x; }', expected: { kind: 'const' } },
  { title: 'AC1 nearest of several nested', src: 'const x = 1; { const x = 2; { const /*d*/x = 3; /*@*/x; } }', expected: { kind: 'const' } },
  { title: 'AC1 outer binding found from inner function', src: 'const /*d*/x = 1; function f() { return /*@*/x; }', expected: { kind: 'const' } },
  { title: 'AC1 undeclared Reflect is null', src: '/*@*/Reflect.get(a, "b");', expected: null },
  { title: 'AC1 undeclared vi is null', src: '/*@*/vi.mock("x");', expected: null },

  { title: 'AC2 var in nested block hoists past block', src: 'function f() { { var /*d*/a = 1; } return /*@*/a; }', expected: { kind: 'var' } },
  { title: 'AC2 var visible from sibling block', src: 'function f() { if (c) { var /*d*/a = 1; } else { /*@*/a; } }', expected: { kind: 'var' } },
  { title: 'AC2 var in function does not leak to program', src: 'function f() { var a = 1; }\n/*@*/a;', expected: null },
  { title: 'AC2 let in block does not leak', src: '{ let a = 1; }\n/*@*/a;', expected: null },
  { title: 'AC2 const in block does not leak', src: '{ const a = 1; }\n/*@*/a;', expected: null },
  { title: 'AC2 class in block does not leak', src: '{ class K {} }\nnew /*@*/K();', expected: null },
  { title: 'AC2 function decl visible earlier in its block', src: '{ /*@*/g(); function /*d*/g() {} }', expected: { kind: 'function' } },
  { title: 'AC2 function decl in block does not leak', src: '{ function g() {} }\n/*@*/g();', expected: null },
  { title: 'AC2 arrow param', src: 'const f = (/*d*/p) => /*@*/p;', expected: { kind: 'param' } },
  { title: 'AC2 method param', src: 'class A { m(/*d*/p) { /*@*/p; } }', expected: { kind: 'param' } },
  { title: 'AC2 default param sees earlier param', src: 'function f(/*d*/a, b = /*@*/a) {}', expected: { kind: 'param' } },
  { title: 'AC2 rest param', src: 'function f(.../*d*/rest) { /*@*/rest; }', expected: { kind: 'param' } },
  { title: 'AC2 destructured param', src: 'function f({ /*d*/a }) { /*@*/a; }', expected: { kind: 'param' } },
  { title: 'AC2 param does not leak out of function', src: 'function f(p) {}\n/*@*/p;', expected: null },
  { title: 'AC2 named function expression name visible inside', src: 'const h = function /*d*/inner() { /*@*/inner; };', expected: { kind: 'function' } },
  { title: 'AC2 named function expression name invisible outside', src: 'const h = function inner() {};\n/*@*/inner;', expected: null },

  { title: 'AC3 class declaration value use', src: 'class /*d*/A {}\nnew /*@*/A();', expected: { kind: 'class' } },
  { title: 'AC3 class declaration type use', src: 'class /*d*/A {}\nlet x: /*@*/A;', expected: { kind: 'class' } },
  { title: 'AC3 enum', src: 'enum /*d*/E { A }\n/*@*/E.A;', expected: { kind: 'enum' } },
  { title: 'AC3 const enum', src: 'const enum /*d*/E { A }\n/*@*/E.A;', expected: { kind: 'enum' } },
  { title: 'AC3 namespace', src: 'namespace /*d*/N { export const x = 1; }\n/*@*/N.x;', expected: { kind: 'namespace' } },
  { title: 'AC3 dotted namespace binds head A', src: 'namespace /*d*/A.B {}\n/*@*/A;', expected: { kind: 'namespace' } },
  { title: 'AC3 module keyword', src: 'module /*d*/M {}\n/*@*/M;', expected: { kind: 'namespace' } },
  { title: 'AC3 import default', src: "import /*d*/d from 'm';\n/*@*/d;", expected: { kind: 'import' } },
  { title: 'AC3 import named', src: "import { /*d*/x } from 'm';\n/*@*/x;", expected: { kind: 'import' } },
  { title: 'AC3 import alias binds local name', src: "import { x as /*d*/y } from 'm';\n/*@*/y;", expected: { kind: 'import' } },
  { title: 'AC3 import alias does not bind original name', src: "import { x as y } from 'm';\n/*@*/x;", expected: null },
  { title: 'AC3 import namespace', src: "import * as /*d*/ns from 'm';\n/*@*/ns.a;", expected: { kind: 'import' } },
  { title: 'AC3 declare const', src: 'declare const /*d*/c: any;\n/*@*/c;', expected: { kind: 'const', declared: true } },
  { title: 'AC3 declare let', src: 'declare let /*d*/c: any;\n/*@*/c;', expected: { kind: 'let', declared: true } },
  { title: 'AC3 declare var', src: 'declare var /*d*/c: any;\n/*@*/c;', expected: { kind: 'var', declared: true } },
  { title: 'AC3 declare function', src: 'declare function /*d*/df(): void;\n/*@*/df();', expected: { kind: 'function', declared: true } },
  { title: 'AC3 declare class', src: 'declare class /*d*/DC {}\nnew /*@*/DC();', expected: { kind: 'class', declared: true } },
  { title: 'AC3 plain const is not declared', src: 'const /*d*/c = 1;\n/*@*/c;', expected: { kind: 'const', declared: false } },
  { title: 'AC3 catch param', src: 'try {} catch (/*d*/e) { /*@*/e; }', expected: { kind: 'catch' } },
  { title: 'AC3 catch destructured param', src: 'try {} catch ({ /*d*/message }) { /*@*/message; }', expected: { kind: 'catch' } },
  { title: 'AC3 catch param does not leak', src: 'try {} catch (e) {}\n/*@*/e;', expected: null },
  { title: 'AC3 for-of head visible in body', src: 'for (const /*d*/x of xs) { /*@*/x; }', expected: { kind: 'const' } },
  { title: 'AC3 for-of head does not leak', src: 'for (const x of xs) {}\n/*@*/x;', expected: null },
  { title: 'AC3 for-in head visible in body', src: 'for (const /*d*/k in o) { /*@*/k; }', expected: { kind: 'const' } },
  { title: 'AC3 for-in head does not leak', src: 'for (const k in o) {}\n/*@*/k;', expected: null },
  { title: 'AC3 for-let init visible in body', src: 'for (let /*d*/i = 0; i < 3; i++) { /*@*/i; }', expected: { kind: 'let' } },
  { title: 'AC3 for-let init does not leak', src: 'for (let i = 0; i < 3; i++) {}\n/*@*/i;', expected: null },
  { title: 'AC3 object destructuring', src: 'const { /*d*/a } = o;\n/*@*/a;', expected: { kind: 'const' } },
  { title: 'AC3 renamed destructuring binds new name', src: 'const { a: /*d*/b } = o;\n/*@*/b;', expected: { kind: 'const' } },
  { title: 'AC3 renamed destructuring does not bind key', src: 'const { a: b } = o;\n/*@*/a;', expected: null },
  { title: 'AC3 array destructuring', src: 'const [ /*d*/a ] = arr;\n/*@*/a;', expected: { kind: 'const' } },
  { title: 'AC3 object rest', src: 'const { x, .../*d*/r } = o;\n/*@*/r;', expected: { kind: 'const' } },
  { title: 'AC3 array rest', src: 'const [ x, .../*d*/r ] = a;\n/*@*/r;', expected: { kind: 'const' } },
  { title: 'AC3 destructuring default', src: 'const { /*d*/a = 1 } = o;\n/*@*/a;', expected: { kind: 'const' } },
  { title: 'AC3 nested destructuring', src: 'const { p: { q: [ /*d*/z ] } } = o;\n/*@*/z;', expected: { kind: 'const' } },

  { title: 'AC4 interface Reflect does not shadow value Reflect', src: 'interface Reflect {}\n/*@*/Reflect.get(a, "b");', expected: null },
  { title: 'AC4 type alias Reflect does not shadow value Reflect', src: 'type Reflect = { a: 1 };\n/*@*/Reflect.get(a, "b");', expected: null },
  { title: 'AC4 class shadows value', src: 'class /*d*/Reflect {}\n/*@*/Reflect.get(a);', expected: { kind: 'class', namespaces: ['type', 'value'] } },
  { title: 'AC4 class shadows type', src: 'class /*d*/Reflect {}\nlet x: /*@*/Reflect;', expected: { kind: 'class' } },
  { title: 'AC4 enum value lookup', src: 'enum /*d*/E { A }\n/*@*/E.A;', expected: { kind: 'enum', namespaces: ['type', 'value'] } },
  { title: 'AC4 enum type lookup', src: 'enum /*d*/E { A }\nlet x: /*@*/E;', expected: { kind: 'enum' } },
  { title: 'AC4 type_identifier finds interface', src: 'interface /*d*/I {}\nlet x: /*@*/I;', expected: { kind: 'interface', namespaces: ['type'] } },
  { title: 'AC4 explicit type ns finds interface', src: 'interface /*d*/I {}\n/*@*/I;', ns: 'type', expected: { kind: 'interface' } },
  { title: 'AC4 explicit value ns skips interface', src: 'interface I {}\n/*@*/I;', ns: 'value', expected: null },
  { title: 'AC4 type alias found in type ns', src: 'type /*d*/T = number;\nlet x: /*@*/T;', expected: { kind: 'type', namespaces: ['type'] } },
  { title: 'AC4 import type is not a value', src: "import type { X } from 'm';\n/*@*/X;", expected: null },
  { title: 'AC4 import type resolves in type position', src: "import type { /*d*/X } from 'm';\nlet a: /*@*/X;", expected: { kind: 'import' } },

  { title: 'parity declare const Reflect', src: 'declare const /*d*/Reflect: any;\n/*@*/Reflect.get(a, "b");', expected: { kind: 'const', declared: true } },
  { title: 'parity var-hoisted Reflect', src: 'function f() { if (c) { var /*d*/Reflect = 1; } /*@*/Reflect.get(a, "b"); }', expected: { kind: 'var' } },
  { title: 'parity class Reflect', src: 'class /*d*/Reflect {}\n/*@*/Reflect.get(a, "b");', expected: { kind: 'class' } },
  { title: 'parity enum Reflect', src: 'enum /*d*/Reflect { A }\n/*@*/Reflect.get(a, "b");', expected: { kind: 'enum' } },
  { title: 'parity namespace Reflect', src: 'namespace /*d*/Reflect {}\n/*@*/Reflect.get(a, "b");', expected: { kind: 'namespace' } },
  { title: 'parity vi shadowed by catch param', src: 'try {} catch (/*d*/vi) { /*@*/vi.mock("x"); }', expected: { kind: 'catch' } },
  { title: 'parity vi shadowed by for-of head', src: 'for (const /*d*/vi of xs) { /*@*/vi.mock("x"); }', expected: { kind: 'const' } },
];

describe('lexical-bindings resolve', () => {
  it.each(A.map((c) => [c.title, c] as const))('%s', (_title, c) => {
    const tree = parse(c.src);
    try {
      const ref = nodeAt(tree.rootNode, offsetAfter(c.src, '/*@*/'));
      if (!ref) throw new Error('reference identifier not found');
      const b = resolve(ref, c.ns);
      if (c.expected === null) {
        expect(b).toBeNull();
        return;
      }
      expect(b).not.toBeNull();
      if (!b) return;
      expect(b.kind).toBe(c.expected.kind);
      expect(b.id.startIndex).toBe(offsetAfter(c.src, '/*d*/'));
      if (c.expected.declared !== undefined) expect(b.declared).toBe(c.expected.declared);
      if (c.expected.namespaces) expect([...b.namespaces].sort()).toEqual(c.expected.namespaces);
      expect(analyzeBindings(tree).resolve(ref, c.ns)?.id.startIndex).toBe(b.id.startIndex);
    } finally {
      tree.delete();
    }
  });
});

describe('lexical-bindings memoisation', () => {
  it('builds once per tree however often it is queried', () => {
    const src = 'const a = 1; function f(p) { return a + p; }\n/*@*/a;';
    const t1 = parse(src);
    const t2 = parse(src);
    try {
      const before = bindingBuildCount();
      const first = analyzeBindings(t1);
      for (let i = 0; i < 10; i++) {
        const ref = nodeAt(t1.rootNode, offsetAfter(src, '/*@*/'));
        if (!ref) throw new Error('reference not found');
        resolve(ref);
        analyzeBindings(t1).resolve(ref);
      }
      expect(analyzeBindings(t1)).toBe(first);
      expect(bindingBuildCount() - before).toBe(1);
      analyzeBindings(t2);
      analyzeBindings(t2);
      expect(bindingBuildCount() - before).toBe(2);
    } finally {
      t1.delete();
      t2.delete();
    }
  });

  it('analyzeBindings returns the same object twice', () => {
    const t = parse('let q = 1;');
    try {
      expect(analyzeBindings(t)).toBe(analyzeBindings(t));
    } finally {
      t.delete();
    }
  });
});

type Flags = 'init' | 'w' | 'rw' | 'r';

interface RefCase {
  title: string;
  src: string;
  refs: Flags[];
}

const FLAGS: Record<Flags, { isWrite: boolean; isRead: boolean; init: boolean }> = {
  init: { isWrite: true, isRead: false, init: true },
  w: { isWrite: true, isRead: false, init: false },
  rw: { isWrite: true, isRead: true, init: false },
  r: { isWrite: false, isRead: true, init: false },
};

function allOffsets(src: string, marker: string): number[] {
  const out: number[] = [];
  for (let at = src.indexOf(marker); at >= 0; at = src.indexOf(marker, at + 1)) out.push(skipWs(src, at + marker.length));
  return out;
}

function skipWs(src: string, from: number): number {
  let i = from;
  while (/\s/.test(src[i] ?? '')) i++;
  return i;
}

function declBinding(tree: Tree, offset: number) {
  const id = nodeAt(tree.rootNode, offset);
  if (!id) throw new Error('declaring identifier not found');
  const b = resolve(id);
  if (!b) throw new Error('binding not resolved');
  return b;
}

function nameAt(src: string, offset: number): string {
  return /^[A-Za-z_$][\w$]*/.exec(src.slice(offset))?.[0] ?? '';
}

const compoundOps = ['+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '??=', '||=', '&&='];

const R: RefCase[] = [
  { title: 'const with initialiser is an init write', src: 'const /*d*/a = 1;', refs: ['init'] },
  { title: 'let with initialiser is an init write', src: 'let /*d*/a = 1;', refs: ['init'] },
  { title: 'let without initialiser has no reference', src: 'let /*d*/a;', refs: [] },
  { title: 'declaration without initialiser then plain assign', src: 'let /*d*/a;\n/*r*/a = 1;', refs: ['w'] },
  { title: 'plain assign after init is write only', src: 'let /*d*/a = 0;\n/*r*/a = 1;', refs: ['init', 'w'] },
  { title: 'for-of keyword head is init write', src: 'for (const /*d*/a of xs) { f(/*r*/a); }', refs: ['init', 'r'] },
  { title: 'for-in keyword head is init write', src: 'for (let /*d*/k in o) {}', refs: ['init'] },
  { title: 'param gets no declaring reference', src: 'function f(/*d*/p) {}', refs: [] },
  { title: 'param read is a plain read', src: 'function f(/*d*/p) { g(/*r*/p); }', refs: ['r'] },
  { title: 'param assignment is write only', src: 'function f(/*d*/p) { /*r*/p = 1; }', refs: ['w'] },
  { title: 'function name gets no declaring reference', src: 'function /*d*/f() {}\n/*r*/f();', refs: ['r'] },
  { title: 'class name gets no declaring reference', src: 'class /*d*/K {}\nnew /*r*/K();', refs: ['r'] },
  { title: 'import gets no declaring reference', src: "import { /*d*/x } from 'm';\n/*r*/x;", refs: ['r'] },
  { title: 'catch param gets no declaring reference', src: 'try {} catch (/*d*/e) { /*r*/e; }', refs: ['r'] },
  { title: 'enum gets no declaring reference', src: 'enum /*d*/E { A }\n/*r*/E.A;', refs: ['r'] },
  { title: 'namespace gets no declaring reference', src: 'namespace /*d*/N {}\n/*r*/N;', refs: ['r'] },
  ...compoundOps.map((op): RefCase => ({
    title: `compound ${op} is read and write`,
    src: `let /*d*/a = 1;\n/*r*/a ${op} 2;`,
    refs: ['init', 'rw'],
  })),
  { title: 'postfix increment is read and write', src: 'let /*d*/a = 1;\n/*r*/a++;', refs: ['init', 'rw'] },
  { title: 'prefix increment is read and write', src: 'let /*d*/a = 1;\n++/*r*/a;', refs: ['init', 'rw'] },
  { title: 'postfix decrement is read and write', src: 'let /*d*/a = 1;\n/*r*/a--;', refs: ['init', 'rw'] },
  { title: 'prefix decrement is read and write', src: 'let /*d*/a = 1;\n--/*r*/a;', refs: ['init', 'rw'] },
  { title: 'array destructuring assign is write only', src: 'let /*d*/a;\n[/*r*/a] = x;', refs: ['w'] },
  { title: 'object shorthand destructuring assign is write only', src: 'let /*d*/a;\n({ /*r*/a } = x);', refs: ['w'] },
  { title: 'object renamed destructuring assign is write only', src: 'let /*d*/a;\n({ k: /*r*/a } = x);', refs: ['w'] },
  { title: 'nested array destructuring assign is write only', src: 'let /*d*/a;\n[[/*r*/a]] = x;', refs: ['w'] },
  { title: 'nested object destructuring assign is write only', src: 'let /*d*/a;\n({ o: { /*r*/a } } = x);', refs: ['w'] },
  { title: 'array rest destructuring assign is write only', src: 'let /*d*/a;\n[.../*r*/a] = x;', refs: ['w'] },
  { title: 'object rest destructuring assign is write only', src: 'let /*d*/a;\n({ .../*r*/a } = x);', refs: ['w'] },
  { title: 'array destructuring default target is write only', src: 'let /*d*/a;\n[/*r*/a = 1] = x;', refs: ['w'] },
  { title: 'object destructuring default target is write only', src: 'let /*d*/a;\n({ /*r*/a = 1 } = x);', refs: ['w'] },
  { title: 'identifier in array default value is a plain read', src: 'let a;\nlet /*d*/b = 2;\n[a = /*r*/b] = x;', refs: ['init', 'r'] },
  { title: 'identifier in object default value is a plain read', src: 'let a;\nlet /*d*/b = 2;\n({ a = /*r*/b } = x);', refs: ['init', 'r'] },
  { title: 'for-of existing binding head is write only', src: 'let /*d*/a;\nfor (/*r*/a of xs) {}', refs: ['w'] },
  { title: 'for-in existing binding head is write only', src: 'let /*d*/a;\nfor (/*r*/a in o) {}', refs: ['w'] },
  { title: 'for-of destructured existing binding head is write only', src: 'let /*d*/a;\nfor ([/*r*/a] of xs) {}', refs: ['w'] },
  { title: 'call argument is a plain read', src: 'let /*d*/a = 1;\nf(/*r*/a);', refs: ['init', 'r'] },
  { title: 'member object is a plain read', src: 'let /*d*/a = o;\n/*r*/a.b;', refs: ['init', 'r'] },
  { title: 'member assignment through binding is a plain read', src: 'let /*d*/a = o;\n/*r*/a.b = 1;', refs: ['init', 'r'] },
  { title: 'object shorthand value is a plain read', src: 'let /*d*/a = 1;\nconst o = { /*r*/a };', refs: ['init', 'r'] },
  { title: 'property name after dot is not a reference', src: 'let /*d*/a = 1;\no.a;', refs: ['init'] },
  { title: 'object literal key is not a reference', src: 'let /*d*/a = 1;\nconst o = { a: 1 };', refs: ['init'] },
  { title: 'type alias use is not a reference', src: 'let /*d*/a = 1;\ntype T = a;', refs: ['init'] },
  { title: 'type annotation use is not a reference', src: 'let /*d*/a = 1;\nlet x: a;', refs: ['init'] },
  { title: 'typeof in a variable type annotation is not a reference', src: 'const /*d*/a = 1; let y: typeof a;', refs: ['init'] },
  { title: 'typeof in a type alias is not a reference', src: 'const /*d*/a = 1; type T = typeof a;', refs: ['init'] },
  { title: 'typeof member in a parameter type is not a reference', src: 'const /*d*/a = {k: 1}; function f(p: typeof a.k) {}', refs: ['init'] },
  { title: 'typeof in call type arguments is not a reference', src: 'const /*d*/a = 1; f<typeof a>();', refs: ['init'] },
  { title: 'value-level typeof is a plain read', src: 'const /*d*/a = 1; const b = typeof /*r*/a;', refs: ['init', 'r'] },
  { title: 'unresolved global write produces no reference on others', src: 'let /*d*/a = 1;\ng = 2;', refs: ['init'] },
  {
    title: 'references come in source order across mixed forms',
    src: 'let /*d*/a = 0;\n/*r*/a = 1;\nf(/*r*/a);\n/*r*/a++;\n[/*r*/a] = x;',
    refs: ['init', 'w', 'r', 'rw', 'w'],
  },
  {
    title: 'write inside closure resolves to outer binding',
    src: 'let /*d*/a = 0;\nfunction f() { /*r*/a = 1; }',
    refs: ['init', 'w'],
  },
  {
    title: 'inner shadowing binding takes the write (inner view)',
    src: 'let a = 0;\nfunction f() { let /*d*/a = 1; /*r*/a = 2; }',
    refs: ['init', 'w'],
  },
  {
    title: 'outer binding does not see the shadowed write',
    src: 'let /*d*/a = 0;\nfunction f() { let a = 1; a = 2; }\nf(/*r*/a);',
    refs: ['init', 'r'],
  },
];

function checkRefs(c: RefCase): void {
  const tree = parse(c.src);
  try {
    const dOff = offsetAfter(c.src, '/*d*/');
    const b = declBinding(tree, dOff);
    const rOffs = allOffsets(c.src, '/*r*/');
    let next = 0;
    const expected = c.refs.map((f, i) => {
      if (f === 'init') return { at: dOff, flags: f };
      const at = rOffs[next++];
      if (at === undefined) throw new Error(`case ${i} lacks a marker`);
      return { at, flags: f };
    });
    if (next !== rOffs.length) throw new Error('unused /*r*/ markers');
    expected.sort((x, y) => x.at - y.at);
    const got = referencesOf(b);
    expect(got.map((r) => r.node.startIndex)).toEqual(expected.map((e) => e.at));
    expect(got.map((r) => r.node.text)).toEqual(expected.map((e) => nameAt(c.src, e.at)));
    got.forEach((r, i) => {
      const f = FLAGS[expected[i]!.flags];
      expect({ at: r.node.startIndex, isWrite: r.isWrite, isRead: r.isRead, init: r.init }).toEqual({ at: expected[i]!.at, ...f });
    });
  } finally {
    tree.delete();
  }
}

describe('references', () => {
  it.each(R.map((c) => [c.title, c] as const))('%s', (_title, c) => {
    checkRefs(c);
  });

  describe('audit probes', () => {
    it('fm-destructuring-write: array destructuring writes the binding', () => {
      const src = 'let a: User[] = x;\n[a] = [y];\na.filter(g).map(h);';
      const tree = parse(src);
      try {
        const b = declBinding(tree, src.indexOf('a:'));
        const hit = b.references.filter((r) => r.isWrite && !r.init);
        expect(hit.map((r) => r.node.startIndex)).toEqual([src.indexOf('[a]') + 1]);
        expect(hit[0]!.isRead).toBe(false);
      } finally {
        tree.delete();
      }
    });

    it('fm-for-of-write: for-of head with existing binding writes it', () => {
      const src = 'let a: User[] = x;\nfor (a of lists) {}\na.filter(g).map(h);';
      const tree = parse(src);
      try {
        const b = declBinding(tree, src.indexOf('a:'));
        const hit = b.references.filter((r) => r.isWrite && !r.init);
        expect(hit.map((r) => r.node.startIndex)).toEqual([src.indexOf('(a of') + 1]);
        expect(hit[0]!.isRead).toBe(false);
      } finally {
        tree.delete();
      }
    });

    it('fm-update-write: a++ reads and writes the binding', () => {
      const src = 'let a: User[] = x;\na++;\na.filter(g).map(h);';
      const tree = parse(src);
      try {
        const b = declBinding(tree, src.indexOf('a:'));
        const hit = b.references.filter((r) => r.isWrite && !r.init);
        expect(hit.map((r) => r.node.startIndex)).toEqual([src.indexOf('a++')]);
        expect(hit[0]!.isRead).toBe(true);
      } finally {
        tree.delete();
      }
    });

    it('fm-nested-fn-assign-shadowed: inner a takes the write, outer a does not', () => {
      const src = 'let a: User[] = [];\nfunction f(){ let a: number = 0; a = 1; }\na.filter(g).map(h);';
      const tree = parse(src);
      try {
        const outer = declBinding(tree, src.indexOf('a:'));
        const inner = declBinding(tree, src.indexOf('a:', src.indexOf('let a: number')));
        expect(outer.references.filter((r) => r.isWrite && !r.init)).toEqual([]);
        const writes = inner.references.filter((r) => r.isWrite && !r.init);
        expect(writes.map((r) => r.node.startIndex)).toEqual([src.indexOf('a = 1')]);
        expect(writes[0]!.isRead).toBe(false);
        expect(outer.id.startIndex).not.toBe(inner.id.startIndex);
      } finally {
        tree.delete();
      }
    });
  });

  it('referencesOf(b) and b.references are the same list', () => {
    const src = 'let a = 0; a = 1; f(a);';
    const tree = parse(src);
    try {
      const b = declBinding(tree, src.indexOf('a'));
      expect(referencesOf(b)).toBe(b.references);
      expect(b.references).toHaveLength(3);
      expect(analyzeBindings(tree).resolve(b.id)?.references).toBe(b.references);
    } finally {
      tree.delete();
    }
  });

  it('memoisation: references add exactly one build per tree', () => {
    const src = 'let a = 0; a = 1; f(a);';
    const tree = parse(src);
    try {
      const before = bindingBuildCount();
      const id = nodeAt(tree.rootNode, src.indexOf('a'));
      if (!id) throw new Error('id not found');
      const b = analyzeBindings(tree).resolve(id);
      if (!b) throw new Error('binding not found');
      for (let i = 0; i < 5; i++) {
        referencesOf(b);
        resolve(id);
        analyzeBindings(tree);
      }
      expect(referencesOf(b)).toBe(b.references);
      expect(bindingBuildCount() - before).toBe(1);
    } finally {
      tree.delete();
    }
  });
});
