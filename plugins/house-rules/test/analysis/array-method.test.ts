import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import { arrayMethodTarget, isKnownArrayExpression, unwrap } from '../../src/analysis/array-method.js';

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

/** The probe expression is the receiver of the last `.probe` member access in the source. */
function probeNode(src: string): Node {
  const tree = parse(src);
  const hits = tree.rootNode.descendantsOfType(['member_expression']).filter((m: Node | null) => m?.childForFieldName('property')?.text === 'probe');
  const hit = hits[hits.length - 1];
  const object = hit?.childForFieldName('object');
  if (!object) throw new Error(`no .probe in ${src}`);
  return object;
}

interface Case {
  title: string;
  src: string;
  known: boolean;
}

const KNOWN: Case[] = [
  { title: 'array literal', src: '[1, 2].probe', known: true },
  { title: 'empty array literal', src: '[].probe', known: true },
  { title: 'map chain on literal', src: '[1].map(f).probe', known: true },
  { title: 'filter chain on literal', src: '[1].filter(f).probe', known: true },
  { title: 'flatMap', src: '[1].flatMap(f).probe', known: true },
  { title: 'slice', src: '[1].slice(1).probe', known: true },
  { title: 'concat', src: '[1].concat([2]).probe', known: true },
  { title: 'toSorted', src: '[1].toSorted().probe', known: true },
  { title: 'toReversed', src: '[1].toReversed().probe', known: true },
  { title: 'toSpliced', src: '[1].toSpliced(0, 1).probe', known: true },
  { title: 'computed string method', src: "[1]['map'](f).probe", known: true },
  { title: 'non-preserving method (join)', src: '[1].join(",").probe', known: false },
  { title: 'non-preserving method (reduce)', src: '[1].reduce(f, 0).probe', known: false },
  { title: 'unknown receiver chain', src: 'xs.map(f).probe', known: false },
  { title: 'unresolved identifier', src: 'xs.probe', known: false },
  { title: 'parens around literal', src: '([1]).probe', known: true },
  { title: 'non-null on literal', src: '[1]!.probe', known: true },
  { title: 'as-cast of literal', src: '([1] as number[]).probe', known: true },
  { title: 'satisfies of literal', src: '([1] satisfies number[]).probe', known: true },
  { title: 'as-cast of unknown is not evidence', src: '(xs as number[]).probe', known: false },
  { title: 'const alias of literal', src: 'const a = [1]; a.probe', known: true },
  { title: 'const alias of chain', src: 'const a = [1].map(f); a.probe', known: true },
  { title: 'const alias of const alias', src: 'const a = [1]; const b = a; b.probe', known: true },
  { title: 'const alias of unknown', src: 'const a = xs; a.probe', known: false },
  { title: 'const alias of call result', src: 'const a = make(); a.probe', known: false },
  { title: 'let without annotation', src: 'let a = [1]; a.probe', known: false },
  { title: 'self-referencing const terminates', src: 'const a = a; a.probe', known: false },
  { title: 'cyclic const aliases terminate', src: 'const a = b; const b = a; a.probe', known: false },
  { title: 'param T[]', src: 'function f(a: User[]) { a.probe }', known: true },
  { title: 'param readonly T[]', src: 'function f(a: readonly User[]) { a.probe }', known: true },
  { title: 'param Array<T>', src: 'function f(a: Array<User>) { a.probe }', known: true },
  { title: 'param ReadonlyArray<T>', src: 'function f(a: ReadonlyArray<User>) { a.probe }', known: true },
  { title: 'param tuple', src: 'function f(a: [User, User]) { a.probe }', known: true },
  { title: 'param parenthesised array', src: 'function f(a: (User[])) { a.probe }', known: true },
  { title: 'param parenthesised readonly array', src: 'function f(a: (readonly User[])) { a.probe }', known: true },
  { title: 'optional param T[]', src: 'function f(a?: User[]) { a.probe }', known: true },
  { title: 'arrow param T[]', src: 'const f = (a: User[]) => a.probe', known: true },
  { title: 'param Set<T> is not an array', src: 'function f(a: Set<User>) { a.probe }', known: false },
  { title: 'param Iterable<T> is not an array', src: 'function f(a: Iterable<User>) { a.probe }', known: false },
  { title: 'param unannotated', src: 'function f(a) { a.probe }', known: false },
  { title: 'param number', src: 'function f(a: number) { a.probe }', known: false },
  { title: 'param union with array is not accepted', src: 'function f(a: User[] | null) { a.probe }', known: false },
  { title: 'let annotated T[]', src: 'let a: User[] = x; a.probe', known: true },
  { title: 'let annotated without init', src: 'let a: User[]; a.probe', known: true },
  { title: 'let annotated Array<T>', src: 'let a: Array<User> = x; a.probe', known: true },
  { title: 'let annotated non-array', src: 'let a: User = x; a.probe', known: false },
  { title: 'const annotated non-array beats array init', src: 'const a: Iterable<number> = [1]; a.probe', known: false },
  { title: 'annotated param chain', src: 'function f(a: User[]) { a.filter(g).probe }', known: true },
  { title: 'rd-param-annotated-initial', src: 'function f(initial: Item[]) { initial.probe }', known: true },
  { title: 'rd-let-annotated-initial', src: 'let initial: Item[] = []; initial.probe', known: true },
];

const WRITES: Case[] = [
  { title: 'assignment', src: 'let a: User[] = x; a = y; a.probe', known: false },
  { title: 'fm-destructuring-write', src: 'let a: User[] = x;\n[a] = [y];\na.probe', known: false },
  { title: 'object destructuring write', src: 'let a: User[] = x;\n({ a } = o);\na.probe', known: false },
  { title: 'fm-for-of-write', src: 'let a: User[] = x;\nfor (a of lists) {}\na.probe', known: false },
  { title: 'for-in write', src: 'let a: User[] = x;\nfor (a in o) {}\na.probe', known: false },
  { title: 'fm-update-write', src: 'let a: User[] = x;\na++;\na.probe', known: false },
  { title: 'compound assignment', src: 'let a: User[] = x;\na += y;\na.probe', known: false },
  { title: 'write to annotated param', src: 'function f(a: User[]) { a = []; a.probe }', known: false },
  { title: 'write after use still disqualifies', src: 'let a: User[] = x;\na.probe;\na = y;', known: false },
  { title: 'write via parenthesised target', src: 'let a: User[] = x;\n(a) = y;\na.probe', known: false },
  { title: 'write to alias source disqualifies const alias', src: 'let a: User[] = x; a = y; const b = a; b.probe', known: false },
  { title: 'property write is not a binding write', src: 'let a: User[] = x;\na.length = 0;\na.probe', known: true },
  { title: 'element write is not a binding write', src: 'let a: User[] = x;\na[0] = y;\na.probe', known: true },
];

const SHADOW: Case[] = [
  {
    title: 'fm-nested-fn-assign-shadowed',
    src: 'let a: User[] = [];\nfunction f(){ let a: number = 0; a = 1; }\na.probe',
    known: true,
  },
  { title: 'inner write to outer binding disqualifies', src: 'let a: User[] = [];\nfunction f(){ a = 1; }\na.probe', known: false },
  { title: 'inner shadow is a non-array', src: 'const a = [1]; function f() { const a = x; return a.probe; }', known: false },
  { title: 'inner shadow is an array over unknown outer', src: 'function f() { const a = [1]; return a.probe; }', known: true },
  { title: 'param shadows outer array', src: 'const a = [1]; function f(a) { a.probe }', known: false },
  { title: 'block shadow of annotated binding', src: 'let a: User[] = x; { let a = y; a.probe }', known: false },
  { title: 'outer array visible when not shadowed', src: 'const a = [1]; function f() { return a.probe; }', known: true },
  { title: 'catch param shadows', src: 'const a = [1]; try {} catch (a) { a.probe }', known: false },
];

describe('isKnownArrayExpression', () => {
  for (const group of [KNOWN, WRITES, SHADOW]) {
    for (const c of group) {
      it(`${c.title}: ${c.known}`, () => {
        expect(isKnownArrayExpression(probeNode(c.src))).toBe(c.known);
      });
    }
  }
});

describe('unwrap', () => {
  const cases: Array<[string, string, string]> = [
    ['parens', '(x)', 'x'],
    ['non-null', 'x!', 'x'],
    ['as', 'x as T', 'x'],
    ['satisfies', 'x satisfies T', 'x'],
    ['type assertion', '<T>x', 'x'],
    ['nested wrappers', '((x as T)!)', 'x'],
    ['non-wrapper unchanged', 'x.y', 'x.y'],
  ];
  for (const [title, expr, text] of cases) {
    it(`unwraps ${title}`, () => {
      const stmt = parse(`${expr};`).rootNode.namedChildren[0];
      const node = stmt?.namedChildren[0];
      if (!node) throw new Error('no expression');
      expect(unwrap(node).text).toBe(text);
    });
  }
});

describe('arrayMethodTarget', () => {
  const callee = (src: string): Node => {
    const call = parse(src).rootNode.descendantsOfType('call_expression')[0];
    const fn = call?.childForFieldName('function');
    if (!fn) throw new Error('no call');
    return fn;
  };
  it('reads a dotted method', () => {
    const t = arrayMethodTarget(callee('xs.map(f)'));
    expect(t?.name).toBe('map');
    expect(t?.object.text).toBe('xs');
  });
  it('reads a computed string method', () => {
    expect(arrayMethodTarget(callee("xs['filter'](f)"))?.name).toBe('filter');
  });
  it('reads through parens and non-null', () => {
    expect(arrayMethodTarget(callee('(xs.map)!(f)'))?.name).toBe('map');
  });
  it('rejects a computed non-string index', () => {
    expect(arrayMethodTarget(callee('xs[name](f)'))).toBeNull();
  });
  it('rejects a bare identifier callee', () => {
    expect(arrayMethodTarget(callee('map(f)'))).toBeNull();
  });
});
