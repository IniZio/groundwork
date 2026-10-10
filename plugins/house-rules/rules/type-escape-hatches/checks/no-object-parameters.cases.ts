import type { RuleCases } from '../../../src/engine/types.js';

const message = (name: string) =>
  `[no-object-parameters] Parameter \`${name}\` uses the broad \`object\` type. Accept a named owner type; parse external input at its boundary before calling this function.`;
const one = (name: string) => [{ message: message(name) }];

export const cases: RuleCases = {
  valid: [
    { why: 'alias declaration alone', code: 'type Alias = object;\n' },
    { why: 'alias to named owner', code: 'function f(value: Alias) {}\n' },
    { why: 'interface owner', code: 'interface Owner { readonly id: string } function f(value: Owner) {}\n' },
    { why: 'bare type parameter', code: 'function f<Value>(value: Value) {}\n' },
    { why: 'type parameter constrained to object', code: 'function f<Value extends object>(value: Value) {}\n' },
    { why: 'chained constraints', code: 'function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}\n' },
    { why: 'constraint alias to shape', code: 'type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}\n' },
    { why: 'type parameter shadows alias', code: 'type Alias = object; function consume<Alias>(value: Alias) {}\n' },
    { why: 'type alias parameter shadows', code: 'type Alias = object; type Consumer<Alias> = (value: Alias) => void;\n' },
    { why: 'interface parameter shadows', code: 'type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }\n' },
    { why: 'mapped key shadows', code: 'type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };\n' },
    { why: 'infer binding shadows in true branch', code: 'type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;\n' },
    { why: 'inner alias shadows outer', code: 'type Payload = object; function outer() { type Payload = { readonly id: string }; function consume(value: Payload) {} }\n' },
    { why: 'identity type parameter shadows alias', code: 'type Identity<T> = T; function consume<Identity>(value: Identity) {}\n' },
    { why: 'alias in another function scope is invisible', code: 'function one() { type Payload = object; } function two() { function consume(value: Payload) {} }\n' },
    { why: 'javascript files are skipped', filename: 'x.js', code: 'function parse(value) {}\n' },
  ],
  invalid: [
    { why: 'bare object parameter', code: 'function f(value: object) {}\n', findings: one('value') },
    { why: 'same-file alias', code: 'type Alias = object; function f(value: Alias) {}\n', findings: one('value') },
    { why: 'parenthesized alias', code: 'type Alias = (object); function f(value: Alias) {}\n', findings: one('value') },
    {
      why: 'infer binding does not shadow in false branch',
      code: 'type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;\n',
      findings: one('value'),
    },
    { why: 'default value', code: 'function consume(value: object = {}): void {}\n', findings: one('value') },
    { why: 'destructured parameter reports pattern text', code: 'function consume({ value }: object = {}): void {}\n', findings: one('{ value }') },
    { why: 'destructured alias', code: 'type Bag = object; function consume({ value }: Bag): void {}\n', findings: one('{ value }') },
    { why: 'alias inside function', code: 'function outer() { type Payload = object; function consume(value: Payload) {} }\n', findings: one('value') },
    { why: 'alias hoisted after use', code: 'function outer() { function consume(value: Payload) {} type Payload = object; }\n', findings: one('value') },
    { why: 'generic identity alias', code: 'type Identity<T> = T; function consume(value: Identity<object>) {}\n', findings: one('value') },
    {
      why: 'nested generic alias',
      code: 'type Identity<T> = T; type Wrapped<T> = Identity<T>; function consume(value: Wrapped<object>) {}\n',
      findings: one('value'),
    },
    { why: 'default type parameter resolving to object', code: 'type O<T = object> = T; function f(x: O) {}\n', findings: one('x') },
    { why: 'union containing object', code: 'function f(value: string | object) {}\n', findings: one('value') },
  ],
};
