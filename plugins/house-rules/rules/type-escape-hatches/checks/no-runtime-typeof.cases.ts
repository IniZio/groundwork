import type { RuleCases } from '../../../src/engine/types.js';

const message = '[no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.';
const one = [{ message }];

export const cases: RuleCases = {
  valid: [
    { why: 'existence probe of document', code: 'const isServer = typeof document === "undefined";\n' },
    { why: 'existence probe of localStorage', code: 'const hasStorage = typeof localStorage !== "undefined";\n' },
    { why: 'existence probe of member', code: 'if (typeof globalThis.crypto === "undefined") throw new Error("no crypto");\n' },
    { why: 'existence probe with reversed operands', code: 'const missing = "undefined" === typeof process;\n' },
    { why: 'single-quoted existence probe', code: "const missing = typeof process == 'undefined';\n" },
    { why: 'no typeof', code: 'const value = input;\n' },
    { why: 'existence probe in a javascript file', filename: 'x.js', code: 'const isServer = typeof document === "undefined";\n' },
  ],
  invalid: [
    { why: 'typeof string comparison', code: 'if (typeof input === "string") use(input);\n', findings: one },
    { why: 'typeof compared with undefined identifier', code: 'if (typeof input === undefined) use(input);\n', findings: one },
    { why: 'typeof in a javascript file', filename: 'x.js', code: 'if (typeof input === "string") use(input);\n', findings: one },
    { why: 'typeof in a type guard is still flagged', code: 'function isString(value: unknown): value is string { return typeof value === "string"; }\n', findings: one },
    { why: 'typeof in a non-guard function', code: 'function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }\n', findings: one },
    { why: 'typeof in a nested closure of a type guard', code: 'function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }\n', findings: one },
    { why: 'typeof in an arrow type guard', code: 'const isString = (value: unknown): value is string => typeof value === "string";\n', findings: one },
    { why: 'typeof in an assertion function', code: 'function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }\n', findings: one },
  ],
};
