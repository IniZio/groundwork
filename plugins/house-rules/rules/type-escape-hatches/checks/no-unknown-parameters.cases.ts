import type { RuleCases } from '../../../src/engine/types.js';

const message = (name: string) =>
  `[no-unknown-parameters] Parameter \`${name}\` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.`;
const one = (name: string) => [{ message: message(name) }];

export const cases: RuleCases = {
  valid: [
    { why: 'cause parameter is exempt', code: 'function enrich(cause: unknown): void {}\n' },
    { why: 'cause exempt inside a union', code: 'function enrich(cause: Error | unknown): void {}\n' },
    { why: 'type predicate subject', code: 'function isString(value: unknown): value is string { return true; }\n' },
    { why: 'arrow type predicate subject', code: 'const isString = (value: unknown): value is string => true;\n' },
    { why: 'assertion signature subject', code: 'function assertString(value: unknown): asserts value is string {}\n' },
    { why: 'function type predicate', code: 'type Guard = (value: unknown) => value is string;\n' },
    { why: 'declared function predicate', code: 'declare function isString(value: unknown): value is string;\n' },
    { why: 'method signature predicate', code: 'type Guards = { isString(value: unknown): value is string };\n' },
    { why: 'no unknown in the union', code: 'function parse(value: string | number): void {}\n' },
    { why: 'unknown array is not bare unknown', code: 'function f(x: unknown[]): void {}\n' },
    { why: 'generic constraint is not a parameter annotation', code: 'function f<T extends unknown>(x: T) {}\n' },
    { why: 'unknown as generic argument', code: 'function f(x: Map<string, unknown>) {}\n' },
    { why: 'rest of unknown array', code: 'function f(...args: unknown[]): void {}\n' },
    { why: 'javascript files are skipped', filename: 'x.js', code: 'function parse(value) {}\nconst v = /* unknown */ 1;\n' },
    { why: 'typescript-only syntax in a js-named file is skipped', filename: 'x.jsx', code: 'function parse(value: unknown) {}\n' },
  ],
  invalid: [
    { why: 'bare unknown parameter', code: 'function parse(value: unknown): void {}\n', findings: one('value') },
    { why: 'unknown in union', code: 'function parse(value: string | unknown): void {}\n', findings: one('value') },
    { why: 'unknown in nested parenthesized union', code: 'function parse(value: string | (number | unknown)): void {}\n', findings: one('value') },
    {
      why: 'only the non-subject parameter is flagged',
      code: 'function isString(value: unknown, context: unknown): value is string { return true; }\n',
      findings: one('context'),
    },
    {
      why: 'destructured parameter reports pattern text',
      code: 'export function parse({ value }: unknown = {}): void {}\n',
      findings: one('{ value }'),
    },
    { why: 'class method', code: 'class A { m(x: unknown) {} }\n', findings: one('x') },
    { why: 'interface method signature', code: 'interface I { m(x: unknown): void }\n', findings: one('x') },
    { why: 'arrow function', code: 'const f = (x: unknown) => x;\n', findings: one('x') },
    { why: 'optional parameter', code: 'function f(x?: unknown) {}\n', findings: one('x') },
    { why: 'rest parameter typed unknown', code: 'function f(...args: unknown) {}\n', findings: one('args') },
    { why: 'constructor parameter property', code: 'class A { constructor(private x: unknown) {} }\n', findings: one('x') },
    { why: 'function type', code: 'type F = (v: unknown) => void;\n', findings: one('v') },
    { why: 'declare function without predicate', code: 'declare function d(v: unknown): void;\n', findings: one('v') },
  ],
};

// Other checks' case keys this check also fires on.
export const foreignHits: readonly string[] = [
  '[no-runtime-typeof] typeof in a non-guard function',
];
