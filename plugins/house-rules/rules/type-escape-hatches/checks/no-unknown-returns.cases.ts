import type { RuleCases } from '../../../src/engine/types.js';

const message = '[no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.';
const one = [{ message }];

export const cases: RuleCases = {
  valid: [
    { why: 'unresolved name is not unknown', code: 'function parse(): ImportedValue { return input; }\n' },
    { why: 'domain type', code: 'function parse(): User { return user; }\n' },
    { why: 'inferred return', code: 'function infer() { return input; }\n' },
    { why: 'generic parameter return', code: 'function generic<Value>(): Value { return value; }\n' },
    { why: 'generic parameter shadows alias', code: 'type Value = Promise<unknown>; function generic<Value>(): Value { return value; }\n' },
    { why: 'mapped type key shadows alias', code: 'type Key = Promise<unknown>; type Mapped<Input> = { [Key in keyof Input]: () => Key };\n' },
    { why: 'infer binding shadows alias in true branch', code: 'type Item = Promise<unknown>; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;\n' },
    { why: 'unknown inside object type', code: 'function cause(): { cause: unknown } { return { cause: input }; }\n' },
    { why: 'object alias containing unknown', code: 'type Result = { value: unknown }; function load(): Result { return result; }\n' },
    { why: 'promise of domain type', code: 'function load(): Promise<User> { return promise; }\n' },
    { why: 'generic alias identity of domain type', code: 'type Identity<T> = T; function load(): Identity<User> { return user; }\n' },
    { why: 'inner alias shadows outer unknown', code: 'type Value = Promise<unknown>; function outer() { type Value = User; function load(): Value { return user; } }\n' },
    { why: 'javascript files are skipped', filename: 'x.js', code: 'function load() { return 1; }\n' },
  ],
  invalid: [
    { why: 'function declaration', code: 'function load(): unknown { return input; }\n', findings: one },
    { why: 'arrow function', code: 'const load = (): unknown => input;\n', findings: one },
    { why: 'function type', code: 'type Loader = () => unknown;\n', findings: one },
    { why: 'interface method signature', code: 'interface Loader { load(): unknown }\n', findings: one },
    { why: 'declare function', code: 'declare function load(): unknown;\n', findings: one },
    { why: 'unknown in union', code: 'function load(): string | unknown { return input; }\n', findings: one },
    { why: 'promise of unknown', code: 'function load(): Promise<unknown> { return promise; }\n', findings: one },
    { why: 'alias resolving to unknown', code: 'type UnknownValue = Promise<unknown>; function load(): UnknownValue { return input; }\n', findings: one },
    { why: 'infer name is not bound in the false branch', code: 'type Item = Promise<unknown>; type Fallback<Input> = Input extends infer Item ? string : () => Item;\n', findings: one },
    { why: 'alias scoped inside a function body', code: 'function outer() { type Result = Promise<unknown>; function load(): Result { return input; } }\n', findings: one },
    { why: 'generic alias instantiated with unknown', code: 'type Identity<T> = T; function load(): Identity<unknown> { return input; }\n', findings: one },
    {
      why: 'nested generic alias wrapping promise',
      code: 'type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; function load(): Wrapped<unknown> { return promise; }\n',
      findings: one,
    },
    { why: 'call signature', code: 'interface I { (): unknown }\n', findings: one },
    { why: 'construct signature', code: 'interface I { new (): unknown }\n', findings: one },
    { why: 'constructor type', code: 'type K = new () => unknown;\n', findings: one },
    { why: 'class method', code: 'class A { m(): unknown { return 1; } }\n', findings: one },
  ],
};
