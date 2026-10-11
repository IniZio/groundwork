<!-- This file is generated. Do not edit manually. -->

# type-escape-hatches

Flags TypeScript type escape hatches in added lines.

**Severity**: warn | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [no-chained-type-assertions] single as

```
const value = input as User;

```

### [no-chained-type-assertions] single parenthesized as

```
const value = (input as User);

```

### [no-chained-type-assertions] const-only chain

```
const value = ({ id: 1 } as const) as const;

```

### [no-chained-type-assertions] angle-bracket const-only chain

```
const value = <const>(<const>{ a: 1 });

```

### [no-chained-type-assertions] single as const

```
const value = { id: 1 } as const;

```

### [no-chained-type-assertions] single angle-bracket assertion

```
const value = <User>input;

```

### [no-chained-type-assertions] as inside call argument is not a chain

```
const value = f(a as unknown, b as User);

```

### [no-chained-type-assertions] javascript files are skipped

```js
const value = input;

```

### [no-known-value-widening] upstream: valid #1

```
type Command = () => void; const startCommand = () => {}; const commands: Record<string, Command> = {};
```

### [no-known-value-widening] upstream: valid #2

```
type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; const commands: Index<Command> = {};
```

### [no-known-value-widening] upstream: valid #3

```
type Command = () => void; const startCommand = () => {}; class Registry { commands: Record<string, Command> = {}; }
```

### [no-known-value-widening] upstream: valid #4

```
type Command = () => void; const startCommand = () => {}; class Registry { accessor commands: Record<string, Command> = {}; }
```

### [no-known-value-widening] upstream: valid #5

```
type Command = () => void; const startCommand = () => {}; let commands: Record<string, Command>; commands = {};
```

### [no-known-value-widening] upstream: valid #6

```
type Command = () => void; const startCommand = () => {}; function create(): Record<string, Command> { return {}; }
```

### [no-known-value-widening] upstream: valid #7

```
type Command = () => void; const startCommand = () => {}; const create = (): Record<string, Command> => ({});
```

### [no-known-value-widening] upstream: valid #8

```
type Command = () => void; const startCommand = () => {}; const commands = {} as Record<string, Command>;
```

### [no-known-value-widening] upstream: valid #9

```
type Command = () => void; const startCommand = () => {}; const commands = <Record<string, Command>>{};
```

### [no-known-value-widening] upstream: valid #10

```
type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand };
```

### [no-known-value-widening] upstream: valid #11

```
type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } as const;
```

### [no-known-value-widening] upstream: valid #12

```
type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } satisfies Record<string, Command>;
```

### [no-known-value-widening] upstream: valid #13

```
type Command = () => void; const startCommand = () => {}; type Commands = Record<string, Command>; const commands = { start: startCommand } as const satisfies Commands;
```

### [no-known-value-widening] upstream: valid #14

```
type Command = () => void; const startCommand = () => {}; interface Commands { readonly start: Command } const commands: Commands = { start: startCommand };
```

### [no-known-value-widening] upstream: valid #15

```
type Command = () => void; const startCommand = () => {}; type Commands = { readonly start: Command }; const commands: Commands = { start: startCommand };
```

### [no-known-value-widening] upstream: valid #16

```
type Command = () => void; const startCommand = () => {}; type PermissionLevels = { readonly [Level in Permission]: number }; const levels: PermissionLevels = { admin: 1 };
```

### [no-known-value-widening] upstream: valid #17

```
type Command = () => void; const startCommand = () => {}; function create() { return { start: startCommand }; }
```

### [no-known-value-widening] upstream: valid #18

```
type Command = () => void; const startCommand = () => {}; interface Commands { readonly start: Command } function create(): Commands { return { start: startCommand }; }
```

### [no-known-value-widening] upstream: valid #19

```
type Command = () => void; const startCommand = () => {}; declare function make(): Record<string, Command>; const commands: Record<string, Command> = make();
```

### [no-known-value-widening] upstream: valid #20

```
type Command = () => void; const startCommand = () => {}; import { Commands } from './types'; const commands: Commands = { start: startCommand };
```

### [no-known-value-widening] upstream: valid #21

```
type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; const labels: Record<Diet, string> = { vegan: 'V', omnivore: 'O' };
```

### [no-known-value-widening] upstream: valid #22

```
type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; type Labels = Record<Diet, string>; const labels: Labels = { vegan: 'V', omnivore: 'O' };
```

### [no-known-value-widening] upstream: valid #23

```
type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; const labels: Readonly<Record<Diet, string>> = { vegan: 'V', omnivore: 'O' };
```

### [no-known-value-widening] upstream: valid #24

```
type Command = () => void; const startCommand = () => {}; const labels: Record<'a' | 'b', number> = { a: 1, b: 2 };
```

### [no-known-value-widening] upstream: valid #25

```
type Command = () => void; const startCommand = () => {}; type Index<Key extends PropertyKey, Value> = Record<Key, Value>; const commands: Index<'start', Command> = { start: startCommand };
```

### [no-known-value-widening] upstream: valid #26

```
function isString(value: unknown): value is string { return true; } declare const input: unknown; isString(input);
```

### [no-known-value-widening] upstream: valid #27

```
function isString(value: string | unknown): value is string { return true; } declare const input: string | unknown; isString(input);
```

### [no-known-value-widening] upstream: valid #28

```
function isString(value: unknown): value is string { return true; } declare function readInput(): unknown; isString(readInput());
```

### [no-known-value-widening] extra: cyclic const chain terminates without a finding

```
const a = b; const b = a; const value: unknown = a;
```

### [no-known-value-widening] extra: reassigned const-like let is not stable evidence

```
let source = { a: 1 }; source = { a: 2 }; const value: unknown = source;
```

### [no-known-value-widening] extra: as const target is not a widening target

```
const value = { a: 1 } as const;
```

### [no-known-value-widening] extra: predicate parameter Array<unknown> is not an absorbing unknown

```
function isList(value: Array<unknown>): value is string[] { return true; } isList([1]);
```

### [no-known-value-widening] extra: predicate parameter with nested unknown member is not an absorbing unknown

```
function isBox(value: { readonly v: unknown }): value is { readonly v: string } { return true; } isBox({ v: 'known' });
```

### [no-object-parameters] alias declaration alone

```
type Alias = object;

```

### [no-object-parameters] alias to named owner

```
function f(value: Alias) {}

```

### [no-object-parameters] interface owner

```
interface Owner { readonly id: string } function f(value: Owner) {}

```

### [no-object-parameters] bare type parameter

```
function f<Value>(value: Value) {}

```

### [no-object-parameters] type parameter constrained to object

```
function f<Value extends object>(value: Value) {}

```

### [no-object-parameters] chained constraints

```
function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}

```

### [no-object-parameters] constraint alias to shape

```
type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}

```

### [no-object-parameters] type parameter shadows alias

```
type Alias = object; function consume<Alias>(value: Alias) {}

```

### [no-object-parameters] type alias parameter shadows

```
type Alias = object; type Consumer<Alias> = (value: Alias) => void;

```

### [no-object-parameters] interface parameter shadows

```
type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }

```

### [no-object-parameters] mapped key shadows

```
type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };

```

### [no-object-parameters] infer binding shadows in true branch

```
type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;

```

### [no-object-parameters] inner alias shadows outer

```
type Payload = object; function outer() { type Payload = { readonly id: string }; function consume(value: Payload) {} }

```

### [no-object-parameters] identity type parameter shadows alias

```
type Identity<T> = T; function consume<Identity>(value: Identity) {}

```

### [no-object-parameters] alias in another function scope is invisible

```
function one() { type Payload = object; } function two() { function consume(value: Payload) {} }

```

### [no-object-parameters] javascript files are skipped

```js
function parse(value) {}

```

### [no-runtime-typeof] existence probe of document

```
const isServer = typeof document === "undefined";

```

### [no-runtime-typeof] existence probe of localStorage

```
const hasStorage = typeof localStorage !== "undefined";

```

### [no-runtime-typeof] existence probe of member

```
if (typeof globalThis.crypto === "undefined") throw new Error("no crypto");

```

### [no-runtime-typeof] existence probe with reversed operands

```
const missing = "undefined" === typeof process;

```

### [no-runtime-typeof] single-quoted existence probe

```
const missing = typeof process == 'undefined';

```

### [no-runtime-typeof] no typeof

```
const value = input;

```

### [no-runtime-typeof] existence probe in a javascript file

```js
const isServer = typeof document === "undefined";

```

### [no-runtime-typeof] option skips typeof in a function type guard

```
function isString(value: unknown): value is string { return typeof value === "string"; }

```

### [no-runtime-typeof] option skips typeof in an arrow type guard

```
const isString = (value: unknown): value is string => typeof value === "string";

```

### [no-runtime-typeof] option skips typeof in an assertion function

```
function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }

```

### [no-unknown-parameters] cause parameter is exempt

```
function enrich(cause: unknown): void {}

```

### [no-unknown-parameters] cause exempt inside a union

```
function enrich(cause: Error | unknown): void {}

```

### [no-unknown-parameters] type predicate subject

```
function isString(value: unknown): value is string { return true; }

```

### [no-unknown-parameters] arrow type predicate subject

```
const isString = (value: unknown): value is string => true;

```

### [no-unknown-parameters] assertion signature subject

```
function assertString(value: unknown): asserts value is string {}

```

### [no-unknown-parameters] function type predicate

```
type Guard = (value: unknown) => value is string;

```

### [no-unknown-parameters] declared function predicate

```
declare function isString(value: unknown): value is string;

```

### [no-unknown-parameters] method signature predicate

```
type Guards = { isString(value: unknown): value is string };

```

### [no-unknown-parameters] no unknown in the union

```
function parse(value: string | number): void {}

```

### [no-unknown-parameters] unknown array is not bare unknown

```
function f(x: unknown[]): void {}

```

### [no-unknown-parameters] generic constraint is not a parameter annotation

```
function f<T extends unknown>(x: T) {}

```

### [no-unknown-parameters] unknown as generic argument

```
function f(x: Map<string, unknown>) {}

```

### [no-unknown-parameters] rest of unknown array

```
function f(...args: unknown[]): void {}

```

### [no-unknown-parameters] javascript files are skipped

```js
function parse(value) {}
const v = /* unknown */ 1;

```

### [no-unknown-parameters] typescript-only syntax in a js-named file is skipped

```jsx
function parse(value: unknown) {}

```

### [no-unknown-returns] unresolved alias declaration to unknown is not a return

```
type ImportedValue = unknown;

```

### [no-unknown-returns] unresolved name is not unknown

```
function parse(): ImportedValue { return input; }

```

### [no-unknown-returns] domain type

```
function parse(): User { return user; }

```

### [no-unknown-returns] inferred return

```
function infer() { return input; }

```

### [no-unknown-returns] generic parameter return

```
function generic<Value>(): Value { return value; }

```

### [no-unknown-returns] generic parameter shadows alias

```
type Value = unknown; function generic<Value>(): Value { return value; }

```

### [no-unknown-returns] mapped type key shadows alias

```
type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };

```

### [no-unknown-returns] infer binding shadows alias in true branch

```
type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;

```

### [no-unknown-returns] unknown inside object type

```
function cause(): { cause: unknown } { return { cause: input }; }

```

### [no-unknown-returns] object alias containing unknown

```
type Result = { value: unknown }; function load(): Result { return result; }

```

### [no-unknown-returns] promise of domain type

```
function load(): Promise<User> { return promise; }

```

### [no-unknown-returns] generic alias identity of domain type

```
type Identity<T> = T; function load(): Identity<User> { return user; }

```

### [no-unknown-returns] inner alias shadows outer unknown

```
type Value = unknown; function outer() { type Value = User; function load(): Value { return user; } }

```

### [no-unknown-returns] interface shadows unknown alias

```
type Value = unknown; interface Value { a: string } function load(): Value { return v; }

```

### [no-unknown-returns] nested interface shadows outer unknown alias

```
type Value = unknown; function outer() { interface Value { a: string } function load(): Value { return v; } }

```

### [no-unknown-returns] nested class shadows outer unknown alias

```
type Value = unknown; function outer() { class Value {} function load(): Value { return v; } }

```

### [no-unknown-returns] import shadows unknown alias

```
import type { Value } from 'x'; type Value = unknown; function load(): Value { return v; }

```

### [no-unknown-returns] duplicate same-scope aliases are ambiguous (oxlint cannot parse; artifact residual)

```
type Value = unknown; type Value = string; function load(): Value { return v; }

```

### [no-unknown-returns] javascript files are skipped

```js
function load() { return 1; }

```

### [no-unknown-type-aliases] object alias

```
type User = { readonly id: string };

```

### [no-unknown-type-aliases] alias of alias of string

```
type Alias = string; type UserId = Alias;

```

### [no-unknown-type-aliases] union without unknown

```
type Payload = string | number;

```

### [no-unknown-type-aliases] unknown only as generic argument

```
type Box<T> = { readonly value: T }; type Payload = Box<unknown>;

```

### [no-unknown-type-aliases] unbound type parameter is not unknown

```
type Identity<T> = T;

```

### [no-unknown-type-aliases] self-referential alias terminates

```
type A = B; type B = A;

```

### [no-unknown-type-aliases] javascript files are skipped

```js
const v = 1;

```

### [no-unsafe-dictionary-type] concrete record value

```
type Commands = Record<string, Command>;

```

### [no-unsafe-dictionary-type] PropertyKey key with JsonValue

```
type Metadata = Record<PropertyKey, JsonValue>;

```

### [no-unsafe-dictionary-type] record with number

```
type PermissionLevels = Record<Permission, number>;

```

### [no-unsafe-dictionary-type] record string number

```
type Counts = Record<string, number>;

```

### [no-unsafe-dictionary-type] concrete index signature

```
type Indexed = { [key: string]: Command };

```

### [no-unsafe-dictionary-type] compatible index signatures

```
type CompatibleIndexes = { [index: number]: Command; [key: string]: Command | OtherCommand };

```

### [no-unsafe-dictionary-type] exhaustive mapped type

```
type Exhaustive = { [K in Permission]: number };

```

### [no-unsafe-dictionary-type] unknown nested in object value

```
type Allowed = Record<string, { payload: unknown }>;

```

### [no-unsafe-dictionary-type] unknown nested in generic value

```
type AlsoAllowed = Record<string, Result<Data, unknown>>;

```

### [no-unsafe-dictionary-type] generic parameter value

```
type Index<T> = Record<string, T>; type EntityIndex<T extends Entity> = Record<string, T>;

```

### [no-unsafe-dictionary-type] alias declared later with safe argument

```
type Safe = Index<Command>; type Index<T> = Record<string, T>;

```

### [no-unsafe-dictionary-type] maps are not dictionaries here

```
type A = Map<string, unknown>; type B = ReadonlyMap<string, unknown>; type C = WeakMap<object, unknown>;

```

### [no-unsafe-dictionary-type] imported Record shadows built-in

```
import { Record } from './local'; type A = Record<string, unknown>;

```

### [no-unsafe-dictionary-type] local Record alias shadows built-in

```
type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>;

```

### [no-unsafe-dictionary-type] local Readonly shadows wrapper

```
type Readonly<T> = { value: T }; type A = Record<string, Readonly<unknown>>;

```

### [no-unsafe-dictionary-type] local NonNullable shadows wrapper

```
type NonNullable<T> = { value: T }; type A = Record<string, NonNullable<unknown>>;

```

### [no-unsafe-dictionary-type] alias default chain resolves to concrete

```
type Value<T> = T; type Index<T = Command, U = Value<T>> = Record<string, U>; type A = Index;

```

### [no-unsafe-dictionary-type] unknown intersected with owner

```
interface Owner { readonly id: string } type A = Record<string, unknown & Owner>;

```

### [no-unsafe-dictionary-type] interface extending owner

```
interface Owner { readonly id: string } interface Child extends Owner {} type A = Record<string, Child>;

```

### [no-unsafe-dictionary-type] interface extending owner with brand

```
interface Owner { readonly id: string } interface Child extends Owner { readonly __brand?: never } type A = Record<string, Child>;

```

### [no-unsafe-dictionary-type] merged interface, empty first

```
interface Escape {} interface Escape { readonly id: string } type A = Record<string, Escape>;

```

### [no-unsafe-dictionary-type] merged interface, empty last

```
interface Escape { readonly id: string } interface Escape {} type A = Record<string, Escape>;

```

### [no-unsafe-dictionary-type] object intersected with owner

```
interface Owner { readonly id: string } type A = Record<string, object & Owner>;

```

### [no-unsafe-dictionary-type] generic wrappers resolve to concrete members

```
type Wrap<T> = { readonly wrapped: T }; type Inner<T, U> = { readonly value: T } & Wrap<U>; type Outer<T, U> = Record<string, Inner<T, U>>; declare function f<T, U>(): Outer<T, U>;

```

### [no-unsafe-dictionary-type] type parameter constraint in alias

```
type WithSchema<T extends Record<string, unknown>> = (schema: T) => void;

```

### [no-unsafe-dictionary-type] type parameter constraint in function

```
function run<T extends Record<string, unknown>>(input: T): T { return input; }

```

### [no-unsafe-dictionary-type] type parameter constraint in declared class

```
declare class Store<T extends Record<string, unknown>> { read(): T }

```

### [no-unsafe-dictionary-type] nested type parameter constraint

```
type Deep<T extends Readonly<Record<string, unknown>>> = T;

```

### [no-unsafe-dictionary-type] javascript files are skipped

```js
const v = /* Record<string, unknown> */ 1;

```

### [no-unsafe-dictionary-type] typescript-only syntax in a jsx-named file is skipped

```jsx
type A = Record<string, unknown>;

```

### [no-widen-then-assert] upstream: widenedBinding: widening alone, no assertion

```
const source = { id: 'first' }; const widened: unknown = source;

```

### [no-widen-then-assert] upstream: widenedBinding: init === null / declare const is ignored

```
declare const input: unknown; const parsed = input as { readonly id: string };

```

### [no-widen-then-assert] assertionIsNarrower: asserted type unknown is broad

```
const s = { id: 1 }; const w: unknown = s; const p = w as unknown;

```

### [no-widen-then-assert] assertionIsNarrower: asserted type any is broad

```
const s = { id: 1 }; const w: unknown = s; const p = w as any;

```

### [no-widen-then-assert] assertionIsNarrower: asserted type object is broad

```
const s = { id: 1 }; const w: unknown = s; const p = w as object;

```

### [no-widen-then-assert] assertionIsNarrower: asserted type parenthesized unknown is broad

```
const s = { id: 1 }; const w: unknown = s; const p = w as (unknown);

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted type reference

```
const s = { id: 1 }; const w: object = s; const p = w as Foo;

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted empty type literal

```
const s = { id: 1 }; const w: object = s; const p = w as {};

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted intersection with non-object member

```
const s = { id: 1 }; const w: object = s; const p = w as { a: 1 } & Foo;

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted union

```
const s = { id: 1 }; const w: object = s; const p = w as { a: 1 } | null;

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted string

```
const s = { id: 1 }; const w: object = s; const p = w as string;

```

### [no-widen-then-assert] isDefinitelyObjectType: object kind with non-object asserted readonly of non-object

```
const s = { id: 1 }; const w: object = s; const p = w as readonly Foo;

```

### [no-widen-then-assert] assertionIsNarrower: object kind asserted object is broad

```
const s = { id: 1 }; const w: object = s; const p = w as object;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Record<string, unknown> (broad) is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Record<string, unknown>;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted index-only literal (broad) is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as { [key: string]: unknown };

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted index-only literal with narrow value is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as { [key: string]: string };

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Record with literal keys and unknown value is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Record<'a', unknown>;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Foo type reference is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Foo;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Readonly of Foo is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Readonly<Foo>;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Readonly<Record<string, unknown>> (broad) is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Readonly<Record<string, unknown>>;

```

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted array type is not narrower

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as string[];

```

### [no-widen-then-assert] broadKind: Record<string, number> annotation is not a broad type

```
const s = { id: 1 }; const w: Record<string, number> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: Record<'a', unknown> narrow keys is not a broad type

```
const s = { id: 1 }; const w: Record<'a', unknown> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: Record with three args is not a broad type

```
const s = { id: 1 }; const w: Record<string, unknown, 1> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: Record with one arg is not a broad type

```
const s = { id: 1 }; const w: Record<string> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: index-signature literal with property is not a broad type

```
const s = { id: 1 }; const w: { id: number; [k: string]: unknown } = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: two index signatures is not a broad type

```
const s = { id: 1 }; const w: { [k: string]: unknown; [n: number]: unknown } = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: Readonly<Foo> is not a broad type

```
const s = { id: 1 }; const w: Readonly<Foo> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] broadKind: Map reference is not a broad type

```
const s = { id: 1 }; const w: Map<string, unknown> = s; const p = w as Record<string, string>;

```

### [no-widen-then-assert] typesHaveSameSyntax: differing evidence and asserted type, non-object

```
const s = make() as Foo; const w: object = s; const p = w as Bar;

```

### [no-widen-then-assert] typesHaveSameSyntax: evidence type null (literal init) never matches

```
const w: object = 'a'; const p = w as Foo;

```

### [no-widen-then-assert] widenedBinding: let binding is ignored

```
const s = { id: 1 }; let w: unknown = s; const p = w as { id: number };

```

### [no-widen-then-assert] widenedBinding: var binding is ignored

```
const s = { id: 1 }; var w: unknown = s; const p = w as { id: number };

```

### [no-widen-then-assert] widenedBinding: reassigned binding is ignored

```
const s = { id: 1 }; const w: unknown = s; w = 1; const p = w as { id: number };

```

### [no-widen-then-assert] widenedBinding: object destructured id is ignored

```
const s = { id: 1 }; const { a }: any = s; const p = a as { id: number };

```

### [no-widen-then-assert] widenedBinding: array destructured id is ignored

```
const s = { id: 1 }; const [a]: any = s; const p = a as { id: number };

```

### [no-widen-then-assert] widenedBinding: no initializer (declare)

```
declare const w: unknown; const p = w as string;

```

### [no-widen-then-assert] widenedBinding: not broad (no annotation, no broad assertion)

```
const s = { id: 1 }; const w = s; const p = w as { id: number };

```

### [no-widen-then-assert] widenedBinding: initializer assertion to a narrow type is not broad

```
const s = { id: 1 }; const w = s as Foo; const p = w as Bar;

```

### [no-widen-then-assert] checkAssertion: assertion inside own initializer precedes declaredAt

```
const w: unknown = [w as string];

```

### [no-widen-then-assert] checkAssertion: assertion on a non-identifier expression

```
const s = { id: 1 }; const w: unknown = s; const p = w.id as string;

```

### [no-widen-then-assert] checkAssertion: assertion on a call expression

```
const p = make() as string;

```

### [no-widen-then-assert] checkAssertion: unresolved assertion subject

```
const p = missing as string;

```

### [no-widen-then-assert] checkAssertion: nested function vs outer declaration

```
const s = { id: 1 }; const w: unknown = s; const f = () => w as { id: number };

```

### [no-widen-then-assert] checkAssertion: function declaration boundary vs outer declaration

```
const s = { id: 1 }; const w: unknown = s; function f() { return w as { id: number }; }

```

### [no-widen-then-assert] checkAssertion: declaration in function, assertion in nested arrow

```
function f() { const s = { id: 1 }; const w: unknown = s; return () => w as { id: number }; }

```

### [no-widen-then-assert] checkAssertion: satisfies is not an assertion

```
const s = { id: 1 }; const w: unknown = s; const p = w satisfies { id: number };

```

### [no-widen-then-assert] checkAssertion: const assertion is not a variable-based assertion

```
const w: unknown = 1; const p = 1 as const;

```

### [no-widen-then-assert] knownValueEvidence: evidence from unknown-annotated variable

```
declare const s: unknown; const w: unknown = s; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: evidence from any-annotated variable

```
declare const s: any; const w: unknown = s; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: evidence from Record<string, unknown>-annotated variable

```
declare const s: Record<string, unknown>; const w: unknown = s; const p = w as Foo;

```

### [no-widen-then-assert] knownValueEvidence: evidence from object-annotated variable

```
declare const s: object; const w: unknown = s; const p = w as Foo;

```

### [no-widen-then-assert] knownValueEvidence: annotated evidence from a different function boundary

```
declare const s: Foo; function f() { const w: unknown = s; return w as Bar; }

```

### [no-widen-then-assert] knownValueEvidence: const evidence from a different function boundary

```
const s = { a: 1 }; function f() { const w: unknown = s; return w as { a: number }; }

```

### [no-widen-then-assert] knownValueEvidence: evidence variable is let

```
let s = { a: 1 }; const w: unknown = s; const p = w as { a: number };

```

### [no-widen-then-assert] knownValueEvidence: evidence const was reassigned

```
const s = { a: 1 }; s = {}; const w: unknown = s; const p = w as { a: number };

```

### [no-widen-then-assert] knownValueEvidence: evidence const has no initializer

```
declare const s; const w: unknown = s; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: self-referencing initializer is cyclic

```
const w: unknown = w; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: mutually cyclic const identifiers

```
const a = b; const b = a; const w: unknown = a; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: unresolved identifier

```
const w: unknown = missing; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: call expression is not known evidence

```
const w: unknown = make(); const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: member expression is not known evidence

```
const w: unknown = a.b; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: await expression is not known evidence

```
async function f() { const w: unknown = await g(); return w as string; }

```

### [no-widen-then-assert] knownValueEvidence: initializer assertion to broad type over a call

```
const w = make() as unknown; const p = w as string;

```

### [no-widen-then-assert] knownValueEvidence: initializer as unknown over inner as unknown has no evidence

```
declare const s: unknown; const w = s as unknown; const p = w as string;

```

## Flagged

### [no-chained-type-assertions] as chain

```
const value = input as unknown as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] parenthesized chain

```
const value = (input as unknown) as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] angle-bracket chain

```
const value = <User>(<unknown>input);

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] mixed const chain

```
const value = ({ id: 1 } as const) as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] three links report once

```
const value = input as unknown as object as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] doubly parenthesized chain reports once

```
const value = ((input as unknown)) as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] parenthesized inner chain reports once

```
const value = ((input as unknown) as object) as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] doubly parenthesized inner chain reports once

```
const value = (((input as unknown) as object)) as User;

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] mixed as and angle-bracket

```
const value = <User>(input as unknown);

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-chained-type-assertions] angle-bracket const over non-const as

```
const value = <const>(input as User);

```

**Expected findings:**
- [no-chained-type-assertions] This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.

### [no-known-value-widening] upstream: invalid #1

```
const value: unknown = {};
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on binding `value` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #2

```
const value: object = {};
```

**Expected findings:**
- [no-known-value-widening] The explicit object type on binding `value` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #3

```
let value: unknown; value = {};
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on binding `value` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #4

```
function create(): unknown { return {}; }
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on return value of `create` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #5

```
type Command = () => void; const startCommand = () => {}; const commands: Record<string, Command> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #6

```
type Command = () => void; const startCommand = () => {}; const commands: { [key: string]: Command } = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #7

```
type Command = () => void; const startCommand = () => {}; const commands: { [K in string]: Command } = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #8

```
type Command = () => void; const startCommand = () => {}; const commands: { start: Command } = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit anonymous object type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #9

```
type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } as Record<string, Command>;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on assertion discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #10

```
type Command = () => void; const startCommand = () => {}; const commands = ({ start: startCommand } as Record<string, Command>) as object;
```

**Expected findings:**
- [no-known-value-widening] The explicit object type on assertion discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #11

```
type Command = () => void; const startCommand = () => {}; class Registry { commands: Record<string, Command> = { start: startCommand }; }
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on property `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #12

```
type Command = () => void; const startCommand = () => {}; let commands: Record<string, Command>; commands = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #13

```
type Command = () => void; const startCommand = () => {}; function create(): Record<string, Command> { return { start: startCommand }; }
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on return value of `create` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #14

```
type Command = () => void; const startCommand = () => {}; function create(): { start: Command } { return { start: startCommand }; }
```

**Expected findings:**
- [no-known-value-widening] The explicit anonymous object type on return value of `create` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #15

```
type Command = () => void; const startCommand = () => {}; const source = { start: startCommand }; const commands: Record<string, Command> = source;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #16

```
type Command = () => void; const startCommand = () => {}; type Open = Record<string, Command>; const source = { start: startCommand }; const commands: Open = source;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #17

```
type Command = () => void; const startCommand = () => {}; type Open = { [key: string]: Command }; const source = { start: startCommand }; const commands: Open = source;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #18

```
type Command = () => void; const startCommand = () => {}; type Open = { [key in string]: Command }; const source = { start: startCommand }; const commands: Open = source;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #19

```
type Command = () => void; const startCommand = () => {}; type Open = Readonly<Record<string, Command>>; const source = { start: startCommand }; const commands: Open = source;
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #20

```
type Command = () => void; const startCommand = () => {}; function outer() { type Open = Record<string, Command>; const commands: Open = { start: startCommand }; }
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #21

```
type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; const commands: Index<Command> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit generic container type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #22

```
type Command = () => void; const startCommand = () => {}; type Identity<T> = T; const commands: Identity<Record<string, Command>> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit generic container type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #23

```
type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; type CommandsByName = Index<Command>; const commands: CommandsByName = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #24

```
type Command = () => void; const startCommand = () => {}; type Index<T = Command> = Record<string, T>; const commands: Index = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit generic container type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #25

```
type Command = () => void; const startCommand = () => {}; type Key = string; const commands: Record<Key, Command> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #26

```
type Command = () => void; const startCommand = () => {}; const commands: Record<PropertyKey, Command> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #27

```
type Command = () => void; const startCommand = () => {}; const commands: Record<string | 'start', Command> = { start: startCommand };
```

**Expected findings:**
- [no-known-value-widening] The explicit open dictionary type on binding `commands` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #28

```
const value: unknown = 1;
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on binding `value` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #29

```
const value: object = [];
```

**Expected findings:**
- [no-known-value-widening] The explicit object type on binding `value` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #30

```
function isString(value: unknown): value is string { return true; } isString('known');
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #31

```
function isString(value: unknown): value is string { return true; } const known = 'known'; isString(known);
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #32

```
function isString(value: string | unknown): value is string { return true; } isString('known');
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #33

```
function isString(value: unknown): value is string { return true; } function check(known: string): boolean { return isString(known); }
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #34

```
const isString = (value: unknown): value is string => true; const known: string = getValue(); isString(known);
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream: invalid #35

```
type User = { readonly id: string }; function isUser(value: unknown): value is User { return true; } function parse(): User { return { id: 'known' }; } const user = parse(); isUser(user);
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isUser` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] extra: method return value names the method

```
class A { make(): unknown { return 1; } }
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on return value of `make` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] extra: expression-bodied arrow names its binding

```
const make = (): object => [];
```

**Expected findings:**
- [no-known-value-widening] The explicit object type on return value of `make` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] extra: angle-bracket assertion reports

```
const value = <unknown>1;
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on assertion discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] extra: declare function predicate with call evidence

```
declare function isString(value: unknown): value is string; isString(1);
```

**Expected findings:**
- [no-known-value-widening] The explicit unknown type on argument for parameter `value` of `isString` discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream oracle: destructured const binding follows declarator init as evidence (object pattern)

```
const s = { id: 1 }; const { a }: any = s; const p = a as { id: number };

```

**Expected findings:**
- [no-known-value-widening] The explicit anonymous object type on assertion discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-known-value-widening] upstream oracle: destructured const binding follows declarator init as evidence (array pattern)

```
const s = { id: 1 }; const [a]: any = s; const p = a as { id: number };

```

**Expected findings:**
- [no-known-value-widening] The explicit anonymous object type on assertion discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.

### [no-object-parameters] bare object parameter

```
function f(value: object) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] same-file alias

```
type Alias = object; function f(value: Alias) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] parenthesized alias

```
type Alias = (object); function f(value: Alias) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] infer binding does not shadow in false branch

```
type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] default value

```
function consume(value: object = {}): void {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] destructured parameter reports pattern text

```
function consume({ value }: object = {}): void {}

```

**Expected findings:**
- [no-object-parameters] Parameter `{ value }` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] destructured alias

```
type Bag = object; function consume({ value }: Bag): void {}

```

**Expected findings:**
- [no-object-parameters] Parameter `{ value }` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] alias inside function

```
function outer() { type Payload = object; function consume(value: Payload) {} }

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] alias hoisted after use

```
function outer() { function consume(value: Payload) {} type Payload = object; }

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] generic identity alias

```
type Identity<T> = T; function consume(value: Identity<object>) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] nested generic alias

```
type Identity<T> = T; type Wrapped<T> = Identity<T>; function consume(value: Wrapped<object>) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] default type parameter resolving to object

```
type O<T = object> = T; function f(x: O) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `x` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-object-parameters] union containing object

```
function f(value: string | object) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

### [no-runtime-typeof] typeof string comparison

```
if (typeof input === "string") use(input);

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof compared with undefined identifier

```
if (typeof input === undefined) use(input);

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in a javascript file

```js
if (typeof input === "string") use(input);

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in a type guard is still flagged

```
function isString(value: unknown): value is string { return typeof value === "string"; }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in a non-guard function

```
function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in a nested closure of a type guard

```
function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in an arrow type guard

```
const isString = (value: unknown): value is string => typeof value === "string";

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] typeof in an assertion function

```
function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] option still flags typeof in a non-guard function

```
function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-runtime-typeof] option still flags typeof in a closure nested in a type guard

```
function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }

```

**Expected findings:**
- [no-runtime-typeof] A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.

### [no-unknown-parameters] bare unknown parameter

```
function parse(value: unknown): void {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `value` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] unknown in union

```
function parse(value: string | unknown): void {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `value` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] unknown in nested parenthesized union

```
function parse(value: string | (number | unknown)): void {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `value` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] only the non-subject parameter is flagged

```
function isString(value: unknown, context: unknown): value is string { return true; }

```

**Expected findings:**
- [no-unknown-parameters] Parameter `context` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] destructured parameter reports pattern text

```
export function parse({ value }: unknown = {}): void {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `{ value }` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] class method

```
class A { m(x: unknown) {} }

```

**Expected findings:**
- [no-unknown-parameters] Parameter `x` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] interface method signature

```
interface I { m(x: unknown): void }

```

**Expected findings:**
- [no-unknown-parameters] Parameter `x` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] arrow function

```
const f = (x: unknown) => x;

```

**Expected findings:**
- [no-unknown-parameters] Parameter `x` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] optional parameter

```
function f(x?: unknown) {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `x` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] rest parameter typed unknown

```
function f(...args: unknown) {}

```

**Expected findings:**
- [no-unknown-parameters] Parameter `args` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] constructor parameter property

```
class A { constructor(private x: unknown) {} }

```

**Expected findings:**
- [no-unknown-parameters] Parameter `x` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] function type

```
type F = (v: unknown) => void;

```

**Expected findings:**
- [no-unknown-parameters] Parameter `v` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-parameters] declare function without predicate

```
declare function d(v: unknown): void;

```

**Expected findings:**
- [no-unknown-parameters] Parameter `v` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.

### [no-unknown-returns] default type param is unknown

```
type Box<T = unknown> = T; function load(): Box { return v; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] function declaration

```
function load(): unknown { return input; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] arrow function

```
const load = (): unknown => input;

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] function type

```
type Loader = () => unknown;

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] interface method signature

```
interface Loader { load(): unknown }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] declare function

```
declare function load(): unknown;

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] unknown in union

```
function load(): string | unknown { return input; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] promise of unknown

```
function load(): Promise<unknown> { return promise; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] alias resolving to unknown

```
type UnknownValue = unknown; function load(): UnknownValue { return input; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] infer name is not bound in the false branch

```
type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] alias scoped inside a function body

```
function outer() { type Result = unknown; function load(): Result { return input; } }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] generic alias instantiated with unknown

```
type Identity<T> = T; function load(): Identity<unknown> { return input; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] nested generic alias wrapping promise

```
type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; function load(): Wrapped<unknown> { return promise; }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] call signature

```
interface I { (): unknown }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] construct signature

```
interface I { new (): unknown }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] constructor type

```
type K = new () => unknown;

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-returns] class method

```
class A { m(): unknown { return 1; } }

```

**Expected findings:**
- [no-unknown-returns] This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.

### [no-unknown-type-aliases] bare unknown alias

```
type Alias = unknown;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Alias` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] alias of unknown alias flags both

```
type UnknownValue = unknown; type Alias = UnknownValue;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `UnknownValue` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.
- [no-unknown-type-aliases] Type alias `Alias` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] union with unknown

```
type Payload = string | unknown;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Payload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] union through an unknown-resolving alias

```
type Payload = string | unknown; type NestedPayload = number | Payload;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Payload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.
- [no-unknown-type-aliases] Type alias `NestedPayload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] generic identity applied to unknown

```
type Identity<T> = T; type Payload = Identity<unknown>;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Payload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] chained generic wrappers

```
type Identity<T> = T; type Wrapped<T> = Identity<T>; type Payload = Wrapped<unknown>;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Payload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] upstream: bare unknown alias

```
type Current = unknown;
```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Current` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] type parameter shadows an unknown alias

```
type Value = unknown; type Box<Value> = Value;

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Value` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] inner alias shadows outer unknown alias

```
type A = unknown; type B = A; function f() { type A = string; type C = A; }

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `A` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.
- [no-unknown-type-aliases] Type alias `B` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unknown-type-aliases] alias declared inside a function

```
function outer() { type Payload = unknown; }

```

**Expected findings:**
- [no-unknown-type-aliases] Type alias `Payload` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.

### [no-unsafe-dictionary-type] record of unknown

```
type A = Record<string, unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of any

```
type A = Record<string, any>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's any value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] index signature of any

```
type A = { [key: string]: any };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's any value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] index signature union with unknown

```
type A = { [index: number]: Command; [key: string]: unknown | Command };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's union value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] mapped type of object

```
type A = { [K in PropertyKey]: object };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] mapped type of NonNullable unknown

```
type A = { [K in PropertyKey]: NonNullable<unknown> };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] index signature of NonNullable unknown

```
type A = { [key: string]: NonNullable<unknown> };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of empty object

```
type A = Record<string, {}>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of empty interface

```
interface Escape {} type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of interface with only never brand

```
interface Escape { readonly __brand?: never } type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of alias with only never brand

```
type Escape = { readonly __brand?: never }; type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of inline never brand

```
type A = Record<string, { readonly __brand?: never }>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of string or unknown

```
type A = Record<string, string | unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's union value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of string or empty interface

```
interface Escape {} type A = Record<string, string | Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's union value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of unknown and empty object

```
type A = Record<string, unknown & {}>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] any intersected with owner

```
interface Owner { readonly id: string } type A = Record<string, any & Owner>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's any value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of alias for unknown

```
type Escape = unknown; type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] named dictionary alias

```
type Dict = Record<string, unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] wrappers around unsafe record report once

```
type A = Readonly<Partial<Required<(Record<string, unknown>)>>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] readonly index signature

```
type A = { readonly [key: string]: unknown };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] readonly mapped type

```
type A = { readonly [K in string]: unknown };

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] Pick over unsafe source

```
type Source = Record<string, unknown>; type A = Pick<Source, string>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] Omit over unsafe source

```
type Source = Record<string, unknown>; type A = Omit<Source, never>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] generic alias applied to unknown

```
type Index<T> = Record<string, T>; type A = Index<unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] interface index signature

```
interface A { [key: string]: unknown }

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] Readonly record of unknown

```
type A = Readonly<Record<string, unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of Readonly unknown

```
type A = Record<string, Readonly<unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of Partial unknown

```
type A = Record<string, Partial<unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of Required unknown

```
type A = Record<string, Required<unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of alias to Readonly unknown

```
type Escape = Readonly<unknown>; type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of generic wrapper alias applied to unknown

```
type Wrapped<T> = Readonly<T>; type A = Record<string, Wrapped<unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of NonNullable unknown

```
type A = Record<string, NonNullable<unknown>>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] record of alias to NonNullable unknown

```
type Escape = NonNullable<unknown>; type A = Record<string, Escape>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] plain alias consumers are not reported

```
type Unsafe = Record<string, unknown>; const x: Unsafe = {}; const y: Unsafe = {};

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] alias of unsafe alias inside a declaration is reported

```
type Unsafe = Record<string, unknown>; type AlsoUnsafe = Unsafe; const x: Unsafe = {};

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] generic default unknown

```
type Index<T = unknown> = Record<string, T>; type A = Index;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] second parameter defaults to first, explicit unknown

```
type Index<T, U = T> = Record<string, U>; type A = Index<string, unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] second parameter defaults to unknown first

```
type Index<T, U = T> = Record<string, U>; type A = Index<unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] default through identity alias

```
type Value<T> = T; type Index<T, U = Value<T>> = Record<string, U>; type A = Index<unknown>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] default resolves to marker with never brand

```
type Marker<T> = { readonly __brand?: never }; type Index<T, U = Marker<T>> = Record<string, U>; type A = Index<Item>;

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's empty-object value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] local identity alias in function scope

```
function outer() { type Identity<T> = T; type A = Record<string, Identity<unknown>>; }

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-unsafe-dictionary-type] local Record shadow does not leak to other scopes

```
function local() { type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>; } function global() { type A = Record<string, unknown>; }

```

**Expected findings:**
- [no-unsafe-dictionary-type] This dictionary's unknown value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.

### [no-widen-then-assert] upstream: checkAssertion: unknown annotation then narrower assertion

```
const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };

```

**Expected findings:**
- [no-widen-then-assert] Binding "widened" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] widenedBinding: broadKind top via any annotation

```
const s = { id: 1 }; const w: any = s; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] widenedBinding: broadKind top via initializer assertion `as unknown`

```
const s = { id: 1 }; const w = s as unknown; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] widenedBinding: broadKind top via initializer assertion `as any`

```
const s = { id: 1 }; const w = s as any; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] assertionIsNarrower: top kind accepts non-array non-object asserted type

```
const s = { id: 1 }; const w: unknown = s; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with type literal

```
const s = { id: 1 }; const w: object = s; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with array

```
const s = { id: 1 }; const w: object = s; const p = w as number[];

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with tuple

```
const s = { id: 1 }; const w: object = s; const p = w as [number, string];

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with function type

```
const s = { id: 1 }; const w: object = s; const p = w as () => void;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with constructor type

```
const s = { id: 1 }; const w: object = s; const p = w as new () => Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with mapped type

```
const s = { id: 1 }; const w: object = s; const p = w as { [K in 'a']: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with intersection of objects

```
const s = { id: 1 }; const w: object = s; const p = w as { a: 1 } & { b: 2 };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with readonly array

```
const s = { id: 1 }; const w: object = s; const p = w as readonly number[];

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with object keyword nested in intersection

```
const s = { id: 1 }; const w: object = s; const p = w as object & { a: 1 };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyObjectType: object kind with parenthesized array

```
const s = { id: 1 }; const w: object = s; const p = w as (number[]);

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via Record<string, unknown>: narrower Record<string, string>

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via Readonly<Record<string, unknown>>: narrower Record<string, string>

```
const s = { id: 1 }; const w: Readonly<Record<string, unknown>> = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via index-signature literal: narrower Record<string, string>

```
const s = { id: 1 }; const w: { [key: string]: unknown } = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via Record<PropertyKey, any>: narrower Record<string, string>

```
const s = { id: 1 }; const w: Record<PropertyKey, any> = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via Record<string | number, unknown>: narrower Record<string, string>

```
const s = { id: 1 }; const w: Record<string | number, unknown> = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via Record<symbol, unknown>: narrower Record<string, string>

```
const s = { id: 1 }; const w: Record<symbol, unknown> = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] broadKind record via parenthesized Record: narrower Record<string, string>

```
const s = { id: 1 }; const w: (Record<string, unknown>) = s; const p = w as Record<string, string>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted literal with properties

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Readonly<Record<string, string>>

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Readonly<Record<string, string>>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Record with literal keys and narrow value

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Record<'a', number>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted literal with property and index signature

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as { id: number; [k: string]: unknown };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] isDefinitelyNarrowerRecordType: record kind asserted Readonly of literal with properties

```
const s = { id: 1 }; const w: Record<string, unknown> = s; const p = w as Readonly<{ id: number }>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] typesHaveSameSyntax: object kind, evidence type equals asserted type

```
const s = make() as Foo; const w: object = s; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] typesHaveSameSyntax: whitespace-insensitive match

```
const s = make() as Map<string, number>; const w: object = s; const p = w as Map<string,number>;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] typesHaveSameSyntax: parenthesized types unwrapped on both sides

```
const s = make() as (Foo); const w: object = s; const p = w as ((Foo));

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] typesHaveSameSyntax: record kind with matching evidence

```
const s = make() as Foo; const w: Record<string, unknown> = s; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: same nested function boundary on both sides

```
function f() { const s = { id: 1 }; const w: unknown = s; return w as { id: number }; }

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: const chain recursion

```
const a = { x: 1 }; const b = a; const w: unknown = b; const p = w as { x: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: chain through parenthesized identifier

```
const a = { x: 1 }; const w: unknown = (a); const p = w as { x: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: chain through non-broad assertion

```
const a = make() as Foo; const b = a; const w: unknown = b; const p = w as Bar;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: evidence from non-broad annotated variable

```
declare const s: Foo; const w: unknown = s; const p = w as Bar;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: non-broad annotated const with unresolved init

```
const s: Foo = make(); const w: unknown = s; const p = w as Bar;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: string literal initializer is known evidence

```
const w: unknown = 'a'; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: number literal initializer is known evidence

```
const w: unknown = 1; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: template literal initializer is known evidence

```
const w: unknown = `a${b}`; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: array expression initializer is known evidence

```
const w: unknown = [1]; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: arrow function initializer is known evidence

```
const w: unknown = () => 1; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: class expression initializer is known evidence

```
const w: unknown = class {}; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: function expression initializer is known evidence

```
const w: unknown = function () {}; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: new expression initializer is known evidence

```
const w: unknown = new Foo(); const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: object expression initializer is known evidence

```
const w: unknown = { a: 1 }; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: parenthesized object expression initializer is known evidence

```
const w: unknown = ({ a: 1 }); const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: null literal initializer is known evidence

```
const w: unknown = null; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: non-broad type assertion initializer is known evidence

```
const w: unknown = make() as Foo; const p = w as Foo;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] knownValueEvidence: broad assertion unwrapped to literal original

```
const w = 'a' as unknown; const p = w as string;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] assertedExpression: parenthesized asserted identifier

```
const s = { id: 1 }; const w: unknown = s; const p = (w) as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] assertionFromExpression: parenthesized initializer assertion

```
const s = { id: 1 }; const w = (s as unknown); const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] unwrapTypeParentheses: parenthesized annotation

```
const s = { id: 1 }; const w: (unknown) = s; const p = w as { id: number };

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] unwrapTypeParentheses: parenthesized asserted type

```
const s = { id: 1 }; const w: unknown = s; const p = w as (string);

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: angle-bracket TSTypeAssertion

```
const s = { id: 1 }; const w: unknown = s; const p = <{ id: number }>w;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: angle-bracket assertion on parenthesized identifier

```
const s = { id: 1 }; const w: unknown = s; const p = <string>(w);

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: initializer angle-bracket assertion to unknown

```
const s = { id: 1 }; const w = <unknown>s; const p = w as string;

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: assertion nested in a call argument

```
const s = { id: 1 }; const w: unknown = s; use(w as string);

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.

### [no-widen-then-assert] checkAssertion: every assertion reported separately (first)

```
const s = { id: 1 }; const w: unknown = s; const p = [w as string];

```

**Expected findings:**
- [no-widen-then-assert] Binding "w" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.
