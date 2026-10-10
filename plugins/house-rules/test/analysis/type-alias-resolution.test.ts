import { describe, it, expect, afterAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import { parserForPath } from '../../src/hooks/languages/parse.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import * as mod from '../../src/analysis/type-alias-resolution.js';
import {
  environment,
  hasVisibleTypeBinding,
  resolvedTypeMatches,
  visibleTypeAlias,
  type ResolvedTypeMatcher,
  type TypeNodeIndex,
} from '../../src/analysis/type-alias-resolution.js';

const loaded = await parserForPath(getParser, 'x.ts')('typescript');
if (!loaded.ok) throw new Error(`typescript grammar unavailable: ${loaded.reason}`);
const trees: Tree[] = [];

function parse(src: string): Tree {
  const t = loaded.ok ? loaded.parser.parse(src) : null;
  if (!t) throw new Error('parse failed');
  trees.push(t);
  return t;
}

afterAll(() => {
  for (const t of trees) t.delete();
});

function need<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`picker miss: ${what}`);
  return v;
}

function aliasNamed(root: Node, name: string, nth = 0): Node {
  const hits = root
    .descendantsOfType('type_alias_declaration')
    .filter((a: Node | null) => a !== null && a.childForFieldName('name')?.text === name);
  return need(hits[nth], `alias ${name}#${nth}`);
}

function funcNamed(root: Node, name: string): Node {
  const hits = root
    .descendantsOfType(['function_declaration', 'method_definition'])
    .filter((f: Node | null) => f !== null && f.childForFieldName('name')?.text === name);
  return need(hits[0], `function ${name}`);
}

function annotated(owner: Node, field: string): Node {
  const ann = need(owner.childForFieldName(field), field);
  return need(ann.namedChildren[0], `${field} inner`);
}

function pick(root: Node, spec: string): Node {
  const [kind, rest = ''] = spec.split(':');
  const [name = '', sel] = rest.split('.');
  const [base = '', nth] = name.split('#');
  if (kind === 'alias') return need(aliasNamed(root, base, Number(nth ?? 0)).childForFieldName('value'), spec);
  if (kind === 'ret') return annotated(funcNamed(root, base), 'return_type');
  if (kind === 'param') {
    const p = need(funcNamed(root, base).descendantsOfType('required_parameter')[0], 'param');
    return annotated(p, 'type');
  }
  if (kind === 'cond') {
    const value = need(aliasNamed(root, base).childForFieldName('value'), spec);
    return need(value.childForFieldName(need(sel, 'selector')), spec);
  }
  if (kind === 'mappedValue') {
    const sig = need(aliasNamed(root, base).descendantsOfType('index_signature')[0], spec);
    return annotated(sig, 'type');
  }
  if (kind === 'mappedConstraint') {
    const clause = need(aliasNamed(root, base).descendantsOfType('mapped_type_clause')[0], spec);
    return need(clause.childForFieldName('type'), spec);
  }
  throw new Error(`unknown picker ${spec}`);
}

function valueText(alias: Node | null): string | null {
  return alias === null ? null : (alias.childForFieldName('value')?.text ?? null);
}

function typeMatcher(predefined: string): ResolvedTypeMatcher {
  const matcher: ResolvedTypeMatcher = (type, matches) => {
    if (type.type === 'predefined_type') return type.text === predefined;
    if (type.type === 'parenthesized_type' || type.type === 'union_type') {
      return type.namedChildren.some((c: Node | null) => c !== null && matches(c));
    }
    return false;
  };
  return matcher;
}

const unknownMatcher = typeMatcher('unknown');
const objectMatcher = typeMatcher('object');

interface AliasCase {
  name: string;
  code: string;
  ref: string;
  use: string;
  expect: string | null;
}

interface BindingCase {
  name: string;
  code: string;
  ref: string;
  use: string;
  expect: boolean;
}

interface MatchCase {
  name: string;
  code: string;
  use: string;
  matcher?: 'unknown' | 'object';
  expect: boolean;
}

const MODULE_IMPORT = (spec: string): string =>
  `type V = unknown;\ndeclare module 'm' { import ${spec} from 'x'; type W = V; }`;

const aliasCases: AliasCase[] = [
  { name: 'ua-param-shadow', code: 'type Value = unknown;\ntype Box<Value> = Value;', ref: 'Value', use: 'alias:Box', expect: null },
  { name: 'ua-inner-scope-last-wins', code: 'function f(){ type A = string; type B = A; }\ntype A = unknown;\ntype C = A;', ref: 'A', use: 'alias:B', expect: 'string' },
  { name: 'ua-inner-scope-outer-use', code: 'function f(){ type A = string; type B = A; }\ntype A = unknown;\ntype C = A;', ref: 'A', use: 'alias:C', expect: 'unknown' },
  { name: 'ua-interface-shadow', code: 'type V = unknown;\nfunction o(){ interface V { a: string }\n type W = V; }', ref: 'V', use: 'alias:W', expect: null },
  { name: 'ua-namespace-scope', code: 'namespace N { type A = unknown; }\ntype B = A;', ref: 'A', use: 'alias:B', expect: null },
  { name: 'ur-duplicate-alias-same-scope', code: 'type V = unknown;\ntype V = string;\nfunction g(): V { return x }', ref: 'V', use: 'ret:g', expect: null },
  { name: 'enum-shadow', code: 'type V = unknown;\nfunction o(){ enum V { a }\n type W = V; }', ref: 'V', use: 'alias:W', expect: null },
  { name: 'namespace-declaration-shadow', code: 'type V = unknown;\nfunction o(){ namespace V { }\n type W = V; }', ref: 'V', use: 'alias:W', expect: null },
  { name: 'class-shadow', code: 'type V = unknown;\nfunction o(){ class V {}\n type W = V; }', ref: 'V', use: 'alias:W', expect: null },
  { name: 'import-specifier-shadow', code: MODULE_IMPORT('{ V }'), ref: 'V', use: 'alias:W', expect: null },
  { name: 'import-aliased-local-shadow', code: MODULE_IMPORT('{ a as V }'), ref: 'V', use: 'alias:W', expect: null },
  { name: 'import-aliased-imported-name-does-not-shadow', code: MODULE_IMPORT('{ V as a }'), ref: 'V', use: 'alias:W', expect: 'unknown' },
  { name: 'import-default-shadow', code: MODULE_IMPORT('V'), ref: 'V', use: 'alias:W', expect: null },
  { name: 'import-namespace-shadow', code: MODULE_IMPORT('* as V'), ref: 'V', use: 'alias:W', expect: null },
  { name: 'import-type-shadow', code: MODULE_IMPORT('type { V }'), ref: 'V', use: 'alias:W', expect: null },
  { name: 'function-type-param-shadow', code: 'type T = unknown;\nfunction f<T>(x: T): T { return x }', ref: 'T', use: 'ret:f', expect: null },
  { name: 'class-type-param-shadow', code: 'type T = unknown;\nclass C<T> { m(x: T) {} }', ref: 'T', use: 'param:m', expect: null },
  { name: 'method-type-param-shadow', code: 'type T = unknown;\nclass C { m<T>(x: T) {} }', ref: 'T', use: 'param:m', expect: null },
  { name: 'infer-true-branch-shadows', code: 'type U = unknown;\ntype C<X> = X extends Array<infer U> ? U : never;', ref: 'U', use: 'cond:C.consequence', expect: null },
  { name: 'infer-false-branch-does-not-shadow', code: 'type U = unknown;\ntype C<X> = X extends Array<infer U> ? never : U;', ref: 'U', use: 'cond:C.alternative', expect: 'unknown' },
  { name: 'mapped-key-shadows-value', code: 'type K = unknown;\ntype M = { [K in keyof X]: K };', ref: 'K', use: 'mappedValue:M', expect: null },
  { name: 'mapped-key-not-in-constraint', code: 'type K = unknown;\ntype M = { [K in K]: K };', ref: 'K', use: 'mappedConstraint:M', expect: 'unknown' },
  { name: 'outer-alias-visible-in-nested-function', code: 'type A = unknown;\nfunction f(){ function g(): A { return x } }', ref: 'A', use: 'ret:g', expect: 'unknown' },
  { name: 'block-alias-not-visible-outside', code: '{ type L = unknown; }\ntype W = L;', ref: 'L', use: 'alias:W', expect: null },
  { name: 'class-static-block-scope', code: 'type V = string;\nclass C { static { type V = unknown; type W = V; } }', ref: 'V', use: 'alias:W', expect: 'unknown' },
  { name: 'switch-body-scope', code: 'type A = unknown;\nswitch (x) { case 1: type A = string; type B = A; }', ref: 'A', use: 'alias:B', expect: 'string' },
  { name: 'qualified-name-ref-has-no-binding', code: 'type Q = ns.A;', ref: 'A', use: 'alias:Q', expect: null },
];

const bindingCases: BindingCase[] = [
  { name: 'ua-param-shadow', code: 'type Value = unknown;\ntype Box<Value> = Value;', ref: 'Value', use: 'alias:Box', expect: true },
  { name: 'ur-duplicate-alias-same-scope', code: 'type V = unknown;\ntype V = string;\nfunction g(): V { return x }', ref: 'V', use: 'ret:g', expect: true },
  { name: 'ua-interface-shadow', code: 'type V = unknown;\nfunction o(){ interface V { a: string }\n type W = V; }', ref: 'V', use: 'alias:W', expect: true },
  { name: 'ur-class-shadows-alias', code: 'type V = unknown;\nfunction o(){ class V {}\n function g(): V { return x } }', ref: 'V', use: 'ret:g', expect: true },
  { name: 'enum-shadow', code: 'enum V { a }\ntype W = V;', ref: 'V', use: 'alias:W', expect: true },
  { name: 'namespace-declaration-shadow', code: 'namespace V { }\ntype W = V;', ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-specifier-shadow', code: "import { V } from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-default-shadow', code: "import V from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-type-shadow', code: "import type { V } from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-namespace-shadow', code: "import * as V from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-aliased-local-binds', code: "import { a as V } from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: true },
  { name: 'import-aliased-imported-name-unbound', code: "import { V as a } from 'x';\ntype W = V;", ref: 'V', use: 'alias:W', expect: false },
  { name: 'function-type-param', code: 'function f<T>(x: T): T { return x }', ref: 'T', use: 'ret:f', expect: true },
  { name: 'class-type-param', code: 'class C<T> { m(x: T) {} }', ref: 'T', use: 'param:m', expect: true },
  { name: 'method-type-param', code: 'class C { m<T>(x: T) {} }', ref: 'T', use: 'param:m', expect: true },
  { name: 'infer-true-branch', code: 'type C<X> = X extends Array<infer U> ? U : never;', ref: 'U', use: 'cond:C.consequence', expect: true },
  { name: 'infer-false-branch', code: 'type C<X> = X extends Array<infer U> ? never : U;', ref: 'U', use: 'cond:C.alternative', expect: false },
  { name: 'mapped-key-value', code: 'type M = { [K in keyof X]: K };', ref: 'K', use: 'mappedValue:M', expect: true },
  { name: 'mapped-key-constraint', code: 'type M = { [K in K]: string };', ref: 'K', use: 'mappedConstraint:M', expect: false },
  { name: 'unshadowed-builtin', code: 'type W = Array;', ref: 'Array', use: 'alias:W', expect: false },
  { name: 'inner-alias-not-visible-outside', code: 'function f(){ type L = 1 }\ntype W = L;', ref: 'L', use: 'alias:W', expect: false },
  { name: 'class-static-block-alias', code: 'class C { static { type V = string; type W = V; } }', ref: 'V', use: 'alias:W', expect: true },
];

const chain200 = Array.from({ length: 201 }, (_, i) => (i === 0 ? 'type T0 = unknown;' : `type T${i} = T${i - 1};`)).join('\n');
const chain5 = Array.from({ length: 6 }, (_, i) => (i === 0 ? 'type T0 = unknown;' : `type T${i} = T${i - 1};`)).join('\n');

const matchCases: MatchCase[] = [
  { name: 'ua-param-shadow', code: 'type Value = unknown;\ntype Box<Value> = Value;', use: 'alias:Box', expect: false },
  { name: 'ua-inner-scope-last-wins (B)', code: 'function f(){ type A = string; type B = A; }\ntype A = unknown;\ntype C = A;', use: 'alias:B', expect: false },
  { name: 'ua-inner-scope-last-wins (C)', code: 'function f(){ type A = string; type B = A; }\ntype A = unknown;\ntype C = A;', use: 'alias:C', expect: true },
  { name: 'ua-interface-shadow', code: 'type V = unknown;\nfunction o(){ interface V { a: string }\n type W = V; }', use: 'alias:W', expect: false },
  { name: 'ua-namespace-scope', code: 'namespace N { type A = unknown; }\ntype B = A;', use: 'alias:B', expect: false },
  { name: 'ua-default-param', code: 'type Maybe<T = unknown> = T;\ntype X = Maybe;', use: 'alias:X', expect: true },
  { name: 'ur-default-param-alias', code: 'type Maybe<T = unknown> = T;\nfunction f(): Maybe { return 1 }', use: 'ret:f', expect: true },
  { name: 'ur-interface-shadows-alias', code: 'type V = unknown;\nfunction o(){ interface V { a: string }\n function g(): V { return x } }', use: 'ret:g', expect: false },
  { name: 'ur-class-shadows-alias', code: 'type V = unknown;\nfunction o(){ class V {}\n function g(): V { return x } }', use: 'ret:g', expect: false },
  { name: 'ur-duplicate-alias-same-scope', code: 'type V = unknown;\ntype V = string;\nfunction g(): V { return x }', use: 'ret:g', expect: false },
  { name: 'op-default-alias', code: 'type O<T = object> = T;\nfunction f(x: O) {}', use: 'param:f', matcher: 'object', expect: true },
  { name: 'enum-shadow', code: 'type V = unknown;\nfunction o(){ enum V { a }\n type W = V; }', use: 'alias:W', expect: false },
  { name: 'function-type-param-shadow', code: 'type T = unknown;\nfunction f<T>(): T { return x }', use: 'ret:f', expect: false },
  { name: 'infer-true-branch-shadow', code: 'type U = unknown;\ntype C<X> = X extends Array<infer U> ? U : never;', use: 'cond:C.consequence', expect: false },
  { name: 'infer-false-branch-resolves', code: 'type U = unknown;\ntype C<X> = X extends Array<infer U> ? never : U;', use: 'cond:C.alternative', expect: true },
  { name: 'mapped-key-value-shadow', code: 'type K = unknown;\ntype M = { [K in keyof X]: K };', use: 'mappedValue:M', expect: false },
  { name: 'explicit-arg-overrides-default', code: 'type Maybe<T = unknown> = T;\ntype X = Maybe<string>;', use: 'alias:X', expect: false },
  { name: 'explicit-arg-overrides-default-to-unknown', code: 'type Maybe<T = string> = T;\ntype X = Maybe<unknown>;', use: 'alias:X', expect: true },
  { name: 'default-references-earlier-param', code: 'type P<A, B = A> = B;\ntype Q = P<unknown>;', use: 'alias:Q', expect: true },
  { name: 'default-references-earlier-param-other-arg', code: 'type P<A, B = A> = B;\ntype Q = P<string>;', use: 'alias:Q', expect: false },
  { name: 'positional-args-second', code: 'type Second<A, B> = B;\ntype X = Second<string, unknown>;', use: 'alias:X', expect: true },
  { name: 'positional-args-first-ignored', code: 'type Second<A, B> = B;\ntype X = Second<unknown, string>;', use: 'alias:X', expect: false },
  { name: 'param-not-leaking-global-alias', code: 'type T = unknown;\ntype Box<T> = T;\ntype X = Box<string>;', use: 'alias:X', expect: false },
  { name: 'missing-arg-no-default-not-expanded', code: 'type Id<T> = unknown | T;\ntype X = Id;', use: 'alias:X', expect: false },
  { name: 'arg-inside-union-body', code: 'type Or<T> = T | string;\ntype X = Or<unknown>;', use: 'alias:X', expect: true },
  { name: 'union-through-alias-chain', code: 'type A = unknown;\ntype B = A | string;\ntype C = B;', use: 'alias:C', expect: true },
  { name: 'parenthesized-alias-chain', code: 'type A = unknown;\ntype B = (A);\ntype C = B;', use: 'alias:C', expect: true },
  { name: 'self-cycle-terminates', code: 'type A = A;', use: 'alias:A', expect: false },
  { name: 'mutual-cycle-terminates', code: 'type A = B;\ntype B = A;', use: 'alias:A', expect: false },
  { name: 'cycle-with-escape-member', code: 'type A = B | unknown;\ntype B = A;', use: 'alias:B', expect: true },
  { name: 'chain-5-resolves', code: chain5, use: 'alias:T5', expect: true },
  { name: 'qualified-name-not-resolved', code: 'namespace ns { type A = unknown; }\ntype Q = ns.A;', use: 'alias:Q', expect: false },
  { name: 'block-alias-not-visible-outside', code: '{ type L = unknown; }\ntype W = L;', use: 'alias:W', expect: false },
  { name: 'outer-alias-visible-in-nested-function', code: 'type A = unknown;\nfunction f(){ function g(): A { return x } }', use: 'ret:g', expect: true },
  { name: 'class-static-block-scope', code: 'type V = string;\nclass C { static { type V = unknown; type W = V; } }', use: 'alias:W', expect: true },
];

function matcherFor(c: MatchCase): ResolvedTypeMatcher {
  return c.matcher === 'object' ? objectMatcher : unknownMatcher;
}

describe('exports', () => {
  it('exposes the contract functions', () => {
    expect(typeof mod.environment).toBe('function');
    expect(typeof mod.visibleTypeAlias).toBe('function');
    expect(typeof mod.hasVisibleTypeBinding).toBe('function');
    expect(typeof mod.resolvedTypeMatches).toBe('function');
  });
});

describe('visibleTypeAlias', () => {
  for (const c of aliasCases) {
    it(c.name, () => {
      const root = parse(c.code).rootNode;
      const env = environment(root);
      expect(valueText(visibleTypeAlias(c.ref, pick(root, c.use), env))).toBe(c.expect);
    });
  }
});

describe('hasVisibleTypeBinding', () => {
  for (const c of bindingCases) {
    it(c.name, () => {
      const root = parse(c.code).rootNode;
      const env = environment(root);
      expect(hasVisibleTypeBinding(c.ref, pick(root, c.use), env)).toBe(c.expect);
    });
  }
});

describe('resolvedTypeMatches', () => {
  for (const c of matchCases) {
    it(c.name, () => {
      const root = parse(c.code).rootNode;
      const env = environment(root);
      expect(resolvedTypeMatches(pick(root, c.use), env, matcherFor(c))).toBe(c.expect);
    });
  }

  it('long chain beyond any depth cap terminates', () => {
    const root = parse(chain200).rootNode;
    const env = environment(root);
    const result = resolvedTypeMatches(pick(root, 'alias:T200'), env, unknownMatcher);
    expect(typeof result).toBe('boolean');
  });

  it('self-referential alias reaches the matcher once per path, not once per depth level', () => {
    const root = parse('type A = A | string;').rootNode;
    const env = environment(root);
    const seen: string[] = [];
    const recorder: ResolvedTypeMatcher = (type, matches) => {
      seen.push(type.text);
      if (type.type === 'union_type') return type.namedChildren.some((c: Node | null) => c !== null && matches(c));
      return false;
    };
    resolvedTypeMatches(pick(root, 'alias:A'), env, recorder);
    expect(seen).toEqual(['A | string', 'A | string', 'A', 'string', 'string']);
  });

  it('mutually recursive aliases reach the matcher once per path, not once per depth level', () => {
    const root = parse('type A = B | string;\ntype B = A | string;').rootNode;
    const env = environment(root);
    const seen: string[] = [];
    const recorder: ResolvedTypeMatcher = (type, matches) => {
      seen.push(type.text);
      if (type.type === 'union_type') return type.namedChildren.some((c: Node | null) => c !== null && matches(c));
      return false;
    };
    resolvedTypeMatches(pick(root, 'alias:A'), env, recorder);
    expect(seen).toEqual(['B | string', 'A | string', 'B | string', 'B', 'string', 'string', 'string']);
  });

  const chainOf = (n: number): string =>
    Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 'type T0 = unknown;' : `type T${i} = T${i - 1};`)).join('\n');

  for (const [n, expected] of [[50, true], [64, true], [65, false], [100, false]] as const) {
    it(`alias expansion stops at MAX_DEPTH 64: chain of ${n} links resolves to ${expected}`, () => {
      const root = parse(chainOf(n)).rootNode;
      const env = environment(root);
      expect(resolvedTypeMatches(pick(root, `alias:T${n}`), env, unknownMatcher)).toBe(expected);
    });
  }

  it('unresolved alias is handed to the matcher as written', () => {
    const root = parse('type Id<T> = T;\ntype X = Id;').rootNode;
    const env = environment(root);
    const seen: string[] = [];
    const recorder: ResolvedTypeMatcher = (type) => {
      seen.push(type.text);
      return false;
    };
    resolvedTypeMatches(pick(root, 'alias:X'), env, recorder);
    expect(seen).toEqual(['Id']);
  });

  it('shadowed alias reference is handed to the matcher as written', () => {
    const root = parse('type Value = unknown;\ntype Box<Value> = Value;').rootNode;
    const env = environment(root);
    const seen: string[] = [];
    const recorder: ResolvedTypeMatcher = (type) => {
      seen.push(type.text);
      return false;
    };
    resolvedTypeMatches(pick(root, 'alias:Box'), env, recorder);
    expect(seen).toEqual(['Value']);
  });
});

describe('environment', () => {
  it('is memoised per tree and distinct across trees', () => {
    const code = 'type A = unknown;';
    const t1 = parse(code);
    const t2 = parse(code);
    expect(environment(t1.rootNode)).toBe(environment(t1.rootNode));
    expect(environment(t1.rootNode)).not.toBe(environment(t2.rootNode));
  });

  it('records both bindings of a same-scope duplicate', () => {
    const root = parse('type V = unknown;\ntype V = string;').rootNode;
    const env = environment(root);
    const bindings = env.bindingsByName.get('V');
    expect(bindings?.length).toBe(2);
    expect(bindings?.map((b) => valueText(b.alias))).toEqual(['unknown', 'string']);
    expect(bindings?.every((b) => b.scope.type === 'program')).toBe(true);
  });

  it('lists aliases in source order', () => {
    const root = parse('type A = 1;\nfunction f(){ type B = 2; }\ninterface I {}').rootNode;
    const env = environment(root);
    expect(env.aliases.map((a) => a.childForFieldName('name')?.text)).toEqual(['A', 'B']);
    expect(env.bindingsByName.get('I')?.[0]?.alias).toBeNull();
  });

  it('keeps non-alias bindings with a null alias and their scope', () => {
    const root = parse('function o(){ enum E { a } }').rootNode;
    const env = environment(root);
    const binding = env.bindingsByName.get('E')?.[0];
    expect(binding?.alias).toBeNull();
    expect(binding?.scope.type).toBe('statement_block');
  });

  it('an env built with an index behaves like one without', () => {
    const code = 'type Maybe<T = unknown> = T;\nfunction o(){ interface V {} type W = V; }\ntype V = unknown;\ntype X = Maybe;\ntype Y = V;';
    const plainRoot = parse(code).rootNode;
    const indexedRoot = parse(code).rootNode;
    const requested: string[] = [];
    const index: TypeNodeIndex = {
      byType: (type) => {
        requested.push(type);
        return indexedRoot.descendantsOfType(type).filter((n: Node | null): n is Node => n !== null);
      },
    };
    const plain = environment(plainRoot);
    const indexed = environment(indexedRoot, index);
    expect([...indexed.bindingsByName.keys()].sort()).toEqual([...plain.bindingsByName.keys()].sort());
    expect(indexed.aliases.length).toBe(plain.aliases.length);
    for (const spec of ['alias:X', 'alias:Y', 'alias:W']) {
      expect(resolvedTypeMatches(pick(indexedRoot, spec), indexed, unknownMatcher)).toBe(
        resolvedTypeMatches(pick(plainRoot, spec), plain, unknownMatcher),
      );
    }
    expect(valueText(visibleTypeAlias('V', pick(indexedRoot, 'alias:W'), indexed))).toBeNull();
    expect(valueText(visibleTypeAlias('V', pick(indexedRoot, 'alias:Y'), indexed))).toBe('unknown');
  });
});
