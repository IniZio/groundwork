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

### [no-object-parameters] union containing object

```
function f(value: string | object) {}

```

**Expected findings:**
- [no-object-parameters] Parameter `value` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.

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
