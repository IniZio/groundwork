import type { RuleCases } from '../../../src/engine/types.js';

const message = '[no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.';
const one = [{ message }];

export const cases: RuleCases = {
  valid: [
    { why: 'single as', code: 'const value = input as User;\n' },
    { why: 'single parenthesized as', code: 'const value = (input as User);\n' },
    { why: 'const-only chain', code: 'const value = ({ id: 1 } as const) as const;\n' },
    { why: 'single as const', code: 'const value = { id: 1 } as const;\n' },
    { why: 'single angle-bracket assertion', code: 'const value = <User>input;\n' },
    { why: 'as inside call argument is not a chain', code: 'const value = f(a as unknown, b as User);\n' },
    { why: 'javascript files are skipped', filename: 'x.js', code: 'const value = input;\n' },
  ],
  invalid: [
    { why: 'as chain', code: 'const value = input as unknown as User;\n', findings: one },
    { why: 'parenthesized chain', code: 'const value = (input as unknown) as User;\n', findings: one },
    { why: 'angle-bracket chain', code: 'const value = <User>(<unknown>input);\n', findings: one },
    { why: 'mixed const chain', code: 'const value = ({ id: 1 } as const) as User;\n', findings: one },
    { why: 'three links report once', code: 'const value = input as unknown as object as User;\n', findings: one },
    { why: 'doubly parenthesized chain reports once', code: 'const value = ((input as unknown)) as User;\n', findings: one },
    { why: 'parenthesized inner chain reports once', code: 'const value = ((input as unknown) as object) as User;\n', findings: one },
    { why: 'doubly parenthesized inner chain reports once', code: 'const value = (((input as unknown) as object)) as User;\n', findings: one },
    { why: 'mixed as and angle-bracket', code: 'const value = <User>(input as unknown);\n', findings: one },
  ],
};
