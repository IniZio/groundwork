import type { RuleCases } from '../../../src/engine/types.js';

const message = (name: string) =>
  `[no-unknown-type-aliases] Type alias \`${name}\` hides \`unknown\`. Keep \`unknown\` explicit at the parsing boundary or on an allowed \`cause\` field; otherwise use the parsed owner type.`;
const one = (name: string) => [{ message: message(name) }];

export const cases: RuleCases = {
  valid: [
    { why: 'object alias', code: 'type User = { readonly id: string };\n' },
    { why: 'alias of alias of string', code: 'type Alias = string; type UserId = Alias;\n' },
    { why: 'union without unknown', code: 'type Payload = string | number;\n' },
    { why: 'unknown only as generic argument', code: 'type Box<T> = { readonly value: T }; type Payload = Box<unknown>;\n' },
    { why: 'unbound type parameter is not unknown', code: 'type Identity<T> = T;\n' },
    { why: 'self-referential alias terminates', code: 'type A = B; type B = A;\n' },
    { why: 'javascript files are skipped', filename: 'x.js', code: 'const v = 1;\n' },
  ],
  invalid: [
    { why: 'bare unknown alias', code: 'type Alias = unknown;\n', findings: one('Alias') },
    {
      why: 'alias of unknown alias flags both',
      code: 'type UnknownValue = unknown; type Alias = UnknownValue;\n',
      findings: [{ message: message('UnknownValue') }, { message: message('Alias') }],
    },
    { why: 'union with unknown', code: 'type Payload = string | unknown;\n', findings: one('Payload') },
    {
      why: 'union through an unknown-resolving alias',
      code: 'type Payload = string | unknown; type NestedPayload = number | Payload;\n',
      findings: [{ message: message('Payload') }, { message: message('NestedPayload') }],
    },
    {
      why: 'generic identity applied to unknown',
      code: 'type Identity<T> = T; type Payload = Identity<unknown>;\n',
      findings: one('Payload'),
    },
    {
      why: 'chained generic wrappers',
      code: 'type Identity<T> = T; type Wrapped<T> = Identity<T>; type Payload = Wrapped<unknown>;\n',
      findings: one('Payload'),
    },
    { why: 'upstream: bare unknown alias', code: 'type Current = unknown;', findings: one('Current') },
    {
      why: 'type parameter shadows an unknown alias',
      code: 'type Value = unknown; type Box<Value> = Value;\n',
      findings: one('Value'),
    },
    {
      why: 'inner alias shadows outer unknown alias',
      code: 'type A = unknown; type B = A; function f() { type A = string; type C = A; }\n',
      findings: [{ message: message('A') }, { message: message('B') }],
    },
    { why: 'alias declared inside a function', code: 'function outer() { type Payload = unknown; }\n', findings: one('Payload') },
  ],
};

// Other checks' case keys this check also fires on.
export const foreignHits: readonly string[] = [
  '[no-unknown-returns] unresolved alias declaration to unknown is not a return',
  '[no-unknown-returns] generic parameter shadows alias',
  '[no-unknown-returns] mapped type key shadows alias',
  '[no-unknown-returns] infer binding shadows alias in true branch',
  '[no-unknown-returns] inner alias shadows outer unknown',
  '[no-unknown-returns] alias resolving to unknown',
  '[no-unknown-returns] infer name is not bound in the false branch',
  '[no-unknown-returns] alias scoped inside a function body',
  '[no-unknown-returns] interface shadows unknown alias',
  '[no-unknown-returns] nested interface shadows outer unknown alias',
  '[no-unknown-returns] nested class shadows outer unknown alias',
  '[no-unknown-returns] import shadows unknown alias',
  '[no-unknown-returns] duplicate same-scope aliases are ambiguous (oxlint cannot parse; artifact residual)',
  '[no-unsafe-dictionary-type] record of alias for unknown',
];
