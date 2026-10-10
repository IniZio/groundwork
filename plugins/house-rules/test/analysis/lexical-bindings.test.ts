import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  analyzeBindings,
  bindingBuildCount,
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
