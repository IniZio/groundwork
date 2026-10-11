import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  isInsideBroadEffectHandler,
  isMatchPatternObject,
  isReasonTagMember,
  isStringLiteral,
  isTagMember,
  propertyName,
  tagMemberFromComparison,
} from '../../src/analysis/effect-tagged-values.js';

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

/** First expression statement's expression. */
function expr(src: string): Node {
  const stmt = parse(src).rootNode.descendantsOfType('expression_statement')[0];
  const e = stmt?.namedChildren[0];
  if (!e) throw new Error(`no expression in ${src}`);
  return e;
}

function first(src: string, type: string): Node {
  const n = parse(src).rootNode.descendantsOfType(type)[0];
  if (!n) throw new Error(`no ${type} in ${src}`);
  return n;
}

describe('isStringLiteral', () => {
  it.each([`'a'`, `"a"`, `('a')`, `''`])('accepts %s', (s) => expect(isStringLiteral(expr(s))).toBe(true));
  it.each(['`a`', '1', 'a', 'null'])('rejects %s', (s) => expect(isStringLiteral(expr(s))).toBe(false));
  it('rejects null and undefined', () => {
    expect(isStringLiteral(null)).toBe(false);
    expect(isStringLiteral(undefined)).toBe(false);
  });
});

describe('isTagMember', () => {
  it.each(['x._tag', `x['_tag']`, `x["_tag"]`, 'a.b._tag', '(x._tag)', `x['\\u005ftag']`, '(x?.y)._tag'])('accepts %s', (s) =>
    expect(isTagMember(expr(s))).toBe(true),
  );
  it.each(['x.tag', 'x._tags', 'x[_tag]', 'x[`_tag`]', 'x[0]', '_tag', 'x._tag()', 'x?._tag', 'x?.["_tag"]', 'x?.y._tag'])(
    'rejects %s',
    (s) => expect(isTagMember(expr(s))).toBe(false),
  );
  it('rejects null and undefined', () => {
    expect(isTagMember(null)).toBe(false);
    expect(isTagMember(undefined)).toBe(false);
  });
});

describe('tagMemberFromComparison', () => {
  const cmp = (s: string) => tagMemberFromComparison(first(s, 'binary_expression'));
  it.each(['===', '==', '!==', '!='])('returns the member for %s with member on left', (op) => {
    const r = cmp(`x._tag ${op} 'A'`);
    expect(r?.text).toBe('x._tag');
  });
  it('returns the member when the literal is on the left', () => {
    expect(cmp(`'A' === x._tag`)?.text).toBe('x._tag');
  });
  it('unwraps parenthesised operands', () => {
    expect(cmp(`(x._tag) === ('A')`)?.text).toBe('x._tag');
  });
  it('handles computed tag access', () => {
    expect(cmp(`x['_tag'] === 'A'`)?.text).toBe(`x['_tag']`);
  });
  it('rejects non-equality operators', () => {
    expect(cmp(`x._tag < 'A'`)).toBeUndefined();
    expect(cmp(`x._tag + 'A'`)).toBeUndefined();
  });
  it('rejects non-literal other side', () => {
    expect(cmp(`x._tag === y`)).toBeUndefined();
    expect(cmp('x._tag === `A`')).toBeUndefined();
    expect(cmp(`x._tag === 1`)).toBeUndefined();
  });
  it('rejects non-tag member', () => {
    expect(cmp(`x.kind === 'A'`)).toBeUndefined();
    expect(cmp(`x?._tag === 'A'`)).toBeUndefined();
  });
  it('rejects both sides literal or both members', () => {
    expect(cmp(`'A' === 'A'`)).toBeUndefined();
    expect(cmp(`x._tag === y._tag`)).toBeUndefined();
  });
  it('rejects a non-binary node', () => {
    expect(tagMemberFromComparison(expr('x._tag'))).toBeUndefined();
  });
});

describe('isInsideBroadEffectHandler', () => {
  const inside = (src: string) => isInsideBroadEffectHandler(first(src, 'binary_expression'));
  it.each(['catch', 'catchAll', 'catchIf'])('accepts arrow callback of Effect.%s', (m) => {
    expect(inside(`Effect.${m}((e) => e._tag === 'A')`)).toBe(true);
  });
  it('accepts function expression callback and later arguments', () => {
    expect(inside(`Effect.catchIf(p, function (e) { return e._tag === 'A'; })`)).toBe(true);
  });
  it('accepts a parenthesised callback', () => {
    expect(inside(`Effect.catch(((e) => e._tag === 'A'))`)).toBe(true);
  });
  it('accepts through nested blocks and declarations inside the callback', () => {
    expect(inside(`Effect.catch((e) => { function g() { return e._tag === 'A'; } return g(); })`)).toBe(true);
  });
  it('rejects other Effect methods and receivers', () => {
    expect(inside(`Effect.map((e) => e._tag === 'A')`)).toBe(false);
    expect(inside(`Other.catch((e) => e._tag === 'A')`)).toBe(false);
    expect(inside(`Effect['catch']((e) => e._tag === 'A')`)).toBe(false);
    expect(inside(`x.Effect.catch((e) => e._tag === 'A')`)).toBe(false);
  });
  it('rejects only the nearest function counting', () => {
    expect(inside(`Effect.catch((e) => () => e._tag === 'A')`)).toBe(false);
  });
  it('rejects code outside any function', () => {
    expect(inside(`x._tag === 'A'`)).toBe(false);
  });
  it('rejects a callback not passed directly as an argument', () => {
    expect(inside(`const f = (e) => e._tag === 'A'; Effect.catch(f)`)).toBe(false);
    expect(inside(`Effect.catch(g, { h: (e) => e._tag === 'A' })`)).toBe(false);
  });
  it('rejects object methods', () => {
    expect(inside(`Effect.catch({ h(e) { return e._tag === 'A'; } })`)).toBe(false);
  });
});

describe('isReasonTagMember', () => {
  const reason = (s: string) => isReasonTagMember(expr(s));
  it.each(['x.reason._tag', `x['reason']._tag`, 'x.reason["_tag"]', '(e?.reason)._tag'])(
    'accepts %s',
    (s) => expect(reason(s)).toBe(true),
  );
  it('checks only the object, as upstream does', () => {
    expect(reason('x.reason.other')).toBe(true);
  });
  it.each(['x._tag', 'x.cause._tag', 'x.reasons._tag', 'x[reason]._tag', 'reason._tag'])('rejects %s', (s) =>
    expect(reason(s)).toBe(false),
  );
});

describe('propertyName', () => {
  const props = (s: string) => first(`(${s})`, 'object').namedChildren.map((c: Node | null) => (c ? propertyName(c) : undefined));
  it('reads identifier, string, and computed string keys', () => {
    expect(props(`{ _tag: 1, 'a': 2, ["b"]: 3, "\\u0063": 4 }`)).toEqual(['_tag', 'a', 'b', 'c']);
  });
  it('reads shorthand and method names', () => {
    expect(props(`{ s, m() {} }`)).toEqual(['s', 'm']);
  });
  it('rejects computed identifiers, numbers, templates, and spreads', () => {
    expect(props('{ [k]: 1, 2: 3, [`t`]: 4, ...r }')).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('isMatchPatternObject', () => {
  const isPattern = (s: string) => isMatchPatternObject(first(s, 'object'));
  it.each(['when', 'not'])('accepts Match.%s argument', (m) => expect(isPattern(`Match.${m}({ _tag: 'A' }, f)`)).toBe(true));
  it('accepts a later argument and a parenthesised object', () => {
    expect(isPattern(`Match.when(p, ({ _tag: 'A' }))`)).toBe(true);
  });
  it.each([
    `Match.tag({ _tag: 'A' })`,
    `Other.when({ _tag: 'A' })`,
    `Match['when']({ _tag: 'A' })`,
    `when({ _tag: 'A' })`,
    `f({ _tag: 'A' })`,
    `Match.when(f({ _tag: 'A' }))`,
    `Match.when([{ _tag: 'A' }])`,
    `Match.when({ k: { _tag: 'A' } })`,
    `const o = { _tag: 'A' }`,
  ])('rejects %s', (s) => {
    const tree = parse(s);
    const objs = tree.rootNode.descendantsOfType('object');
    const target = objs[objs.length - 1];
    expect(target && isMatchPatternObject(target)).toBe(false);
  });
  it('rejects non-object nodes', () => {
    expect(isMatchPatternObject(first(`Match.when(f)`, 'identifier'))).toBe(false);
  });
});
