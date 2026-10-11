import { describe, it, expect, beforeAll } from 'bun:test';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import type { Node, Tree } from '../../src/hooks/lib/tree-sitter.js';
import {
  commentJustifiesAssertion,
  findAssertionsNeedingJustification,
  isConstAssertion,
} from '../../src/analysis/type-assertion-safety.js';

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

const flagged = (src: string) => findAssertionsNeedingJustification(parse(src).rootNode).length;

const valid = [
  'const values = [1, 2] as const;',
  "const value = <const>{ id: 'one' };",
  'const v = input satisfies User;',
  '// SAFETY: The parser established the UserId invariant.\nconst id = value as UserId;',
  'function parse(): UserId {\n// SAFETY: Validation above established the UserId invariant.\nreturn value as UserId;\n}',
  'const id = /* SAFETY: Validation established the invariant. */ value as UserId;',
  '// SAFETY: The parser established the exported UserId invariant.\nexport const id = value as UserId;',
  '/* SAFETY:\n * The parser established the exported UserId invariant.\n */\nexport const id = value as UserId;',
];
const invalid = [
  'const id = value as UserId;',
  'const id = <UserId>value;',
  'const id = value as UserId; // SAFETY: Too late.',
  '// This cast seems fine.\nconst id = value as UserId;',
  '// SAFETY:\nconst id = value as UserId;',
  '// SAFETY:   \nconst id = value as UserId;',
  'const id = /* SAFETY: */ value as UserId;',
  'export const id = value as UserId;',
  '// This is not a safety justification.\nexport const id = value as UserId;',
  '// INVARIANT: not the hard-coded marker.\nconst id = value as UserId;',
  '// XSAFETY: glued prefix.\nconst id = value as UserId;',
];

describe('findAssertionsNeedingJustification', () => {
  for (const src of valid) it(`accepts ${JSON.stringify(src)}`, () => expect(flagged(src)).toBe(0));
  for (const src of invalid) it(`flags ${JSON.stringify(src)}`, () => expect(flagged(src)).toBe(1));
  it('finds both as and angle-bracket forms', () => {
    expect(flagged('const a = x as A;\nconst b = <B>y;')).toBe(2);
  });
});

describe('isConstAssertion', () => {
  it('distinguishes const from non-const', () => {
    const t = parse('const a = x as const; const b = <const>y; const c = x as T; const d = <T>y;');
    const all = t.rootNode.descendantsOfType(['as_expression', 'type_assertion']).filter((n: Node | null): n is Node => n !== null);
    expect(all.map(isConstAssertion)).toEqual([true, true, false, false]);
  });
});

describe('commentJustifiesAssertion', () => {
  const comments = (src: string) => parse(src).rootNode.descendantsOfType('comment').filter((n: Node | null): n is Node => n !== null);
  it('true for SAFETY comment before a non-const assertion', () => {
    expect(commentJustifiesAssertion(comments('// SAFETY: ok\nconst a = x as T;')[0]!)).toBe(true);
    expect(commentJustifiesAssertion(comments('// SAFETY: ok\nexport const a = x as T;')[0]!)).toBe(true);
  });
  it('false before a const assertion', () => {
    expect(commentJustifiesAssertion(comments('// SAFETY: ok\nconst a = [1] as const;')[0]!)).toBe(false);
  });
  it('false without marker, with empty reason, or when trailing', () => {
    expect(commentJustifiesAssertion(comments('// note\nconst a = x as T;')[0]!)).toBe(false);
    expect(commentJustifiesAssertion(comments('// SAFETY:\nconst a = x as T;')[0]!)).toBe(false);
    expect(commentJustifiesAssertion(comments('const a = x as T; // SAFETY: late')[0]!)).toBe(false);
  });
});
