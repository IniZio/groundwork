<!-- This file is generated. Do not edit manually. -->

# code-smells

Flags common AI-slop code smells in added TypeScript/JavaScript lines.

**Severity**: warn | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [no-accumulator-spread] items.reduce((acc, x) => ({ ...x, k: 1 }), {});

```
items.reduce((acc, x) => ({ ...x, k: 1 }), {});

```

### [no-accumulator-spread] const copy = { ...acc, k: 1 };

```
const copy = { ...acc, k: 1 };

```

### [no-accumulator-spread] function f(acc) { return [...acc, 1]; }

```
function f(acc) { return [...acc, 1]; }

```

### [no-accumulator-spread] items.reduce((acc, x) => { const snap = (acc) => [...acc, x]; acc.push(x); return acc; }, []);

```
items.reduce((acc, x) => { const snap = (acc) => [...acc, x]; acc.push(x); return acc; }, []);

```

### [no-accumulator-spread] items.reduce((acc, x) => { { const acc = []; use([...acc]); } return acc; }, []);

```
items.reduce((acc, x) => { { const acc = []; use([...acc]); } return acc; }, []);

```

### [no-accumulator-spread] items.reduce((acc, x) => { { const {acc} = o; use([...acc]); } return acc; }, []);

```
items.reduce((acc, x) => { { const {acc} = o; use([...acc]); } return acc; }, []);

```

### [no-accumulator-spread] items.reduce((acc, x) => { acc.push(x); return acc; }, []);

```
items.reduce((acc, x) => { acc.push(x); return acc; }, []);

```

### [no-accumulator-spread] items.reduce((acc, x) => Object.assign(acc, x), {});

```
items.reduce((acc, x) => Object.assign(acc, x), {});

```

### [no-accumulator-spread] items.map((acc, x) => ({ ...acc, k: x }));

```
items.map((acc, x) => ({ ...acc, k: x }));

```

### [no-accumulator-spread] items.reduce((acc, x) => { const later = () => ({ ...acc }); return acc; }, {});

```
items.reduce((acc, x) => { const later = () => ({ ...acc }); return acc; }, {});

```

### [no-accumulator-spread] items.reduce((acc, x) => { use(...acc); return acc; }, []);

```
items.reduce((acc, x) => { use(...acc); return acc; }, []);

```

### [no-accumulator-spread] unchanged base line is not flagged

```
items.reduce((acc, x) => [...acc, x], []);
const b = 1;

```

### [no-array-filter-map] lazy iterator helpers via .values()

```
const users = []; users.values().filter(active).map(email).toArray();

```

### [no-array-filter-map] lazy map then filter via .values()

```
const users = []; users.values().map(email).filter(Boolean).toArray();

```

### [no-array-filter-map] Iterator.from pipeline

```
Iterator.from(users).filter(active).map(email).toArray();

```

### [no-array-filter-map] IteratorObject-typed parameter

```
function collect(users: IteratorObject<User>) { return users.filter(active).map(email).toArray(); }

```

### [no-array-filter-map] single flatMap

```
const users = []; users.flatMap(user => user.active ? [user.email] : []);

```

### [no-array-filter-map] separate statements, not chained

```
const users = []; users.map(email); users.filter(active);

```

### [no-array-filter-map] map then map

```
const users = []; users.map(email).map(normalize);

```

### [no-array-filter-map] filter then filter

```
const users = []; users.filter(active).filter(verified);

```

### [no-array-filter-map] custom object with filter/map methods

```
const custom = { filter() { return this; }, map() {} }; custom.filter(active).map(email);

```

### [no-array-filter-map] unknown receiver parameter

```
function collect(unknownReceiver) { return unknownReceiver.filter(active).map(email); }

```

### [no-array-filter-map] const initialised from a call, not known array

```
const users = fetchUsers(); users.filter(active).map(email);

```

### [no-array-filter-map] inner parameter shadows outer array binding

```
const users = []; function collect(users) { return users.filter(active).map(email); }

```

### [no-array-filter-map] let binding reassigned

```
let users = []; users = iterator; users.filter(active).map(email);

```

### [no-array-filter-map] unreassigned let is not trusted as array

```
let users = []; users.filter(active).map(email);

```

### [no-array-filter-map] annotated array reassigned elsewhere

```
let users: User[] = []; users = other; users.filter(active).map(email);

```

### [no-array-filter-map] destructured binding is not known array

```
const { items } = obj; items.filter(f).map(g);

```

### [no-array-filter-map] imported name is not known array

```
import { items } from './x'; items.filter(f).map(g);

```

### [no-array-filter-map] catch parameter is not known array

```
try { run(); } catch (items) { items.filter(f).map(g); }

```

### [no-array-filter-map] for-of variable is not known array

```
for (const items of groups) { items.filter(f).map(g); }

```

### [no-array-filter-map] dynamic method name

```
const users = []; users[method](active).map(email);

```

### [no-array-filter-map] destructuring write disqualifies annotated let

```
let a: User[] = x;
[a] = [y];
a.filter(g).map(h);

```

### [no-array-filter-map] for-of write disqualifies annotated let

```
let a: User[] = x;
for (a of lists) {}
a.filter(g).map(h);

```

### [no-array-filter-map] update write disqualifies annotated let

```
let a: User[] = x;
a++;
a.filter(g).map(h);

```

### [no-array-filter-map] cyclic const bindings

```
const first = second; const second = first; first.filter(active).map(email);

```

### [no-array-filter-map] filter.map on an unchanged base line is not flagged

```
[].filter(active).map(email);
const b = 1;

```

### [no-conditional-empty-object-spread] plain shorthand property

```
const result = { value };

```

### [no-conditional-empty-object-spread] plain spread

```
const result = { ...values };

```

### [no-conditional-empty-object-spread] conditional outside a spread

```
const result = condition ? { value } : {};

```

### [no-conditional-empty-object-spread] conditional spread without empty object branch

```
const result = { ...(c ? { a } : { b }) };

```

### [no-conditional-empty-object-spread] array spread of conditional empty object is not an object spread

```
const result = [...(c ? {} : x)];

```

### [no-conditional-empty-object-spread] unchanged base line is not flagged

```
const a = { ...(c ? { v } : {}) };
const b = 1;

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { acc.push(item); return acc; }, []);

```
items.reduce((acc, item) => { acc.push(item); return acc; }, []);

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => Object.assign(acc, item), {});

```
items.reduce((acc, item) => Object.assign(acc, item), {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => Object.assign(acc, acc, item), {});

```
items.reduce((acc, item) => Object.assign(acc, acc, item), {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});

```
items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);

```
items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);

```
items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.concat(item), '');

```
items.reduce((acc, item) => acc.concat(item), '');

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.concat(item), customCollection);

```
items.reduce((acc, item) => acc.concat(item), customCollection);

```

### [no-reduce-accumulator-copy] function copy(acc) { return Object.assign({}, acc); }

```
function copy(acc) { return Object.assign({}, acc); }

```

### [no-reduce-accumulator-copy] items.map((acc, item) => Object.assign({}, acc));

```
items.map((acc, item) => Object.assign({}, acc));

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});

```
items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});

```
items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});

```
items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});

```

### [no-reduce-accumulator-copy] const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});

```
const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});

```

### [no-reduce-accumulator-copy] function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }

```
function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }

```

### [no-reduce-accumulator-copy] const Array = custom; items.reduce((acc, item) => Array.from(acc), []);

```
const Array = custom; items.reduce((acc, item) => Array.from(acc), []);

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});

```
items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => [...acc, item], []);

```
items.reduce((acc, item) => [...acc, item], []);

```

### [no-reduce-accumulator-copy] items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

```
items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

```

### [no-reduce-accumulator-copy] unchanged base line is not flagged

```
items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});
const b = 1;

```

### [no-reduce-accumulator-copy] let initial = []; initial = x; items.reduce((acc, i) => acc.concat(i), initial);

```
let initial = []; initial = x;
items.reduce((acc, i) => acc.concat(i), initial);

```

### [no-reflect-apply] native Function.prototype-style .apply on another receiver

```
const value = operation.apply(owner, args);

```

### [no-reflect-apply] other Reflect method

```
Reflect.get(owner, key);

```

### [no-reflect-apply] locally declared Reflect shadows the global

```
const Reflect = { apply() { return 1; } }; Reflect.apply();

```

### [no-reflect-apply] parameter named Reflect shadows the global

```
function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }

```

### [no-reflect-apply] declare const Reflect shadows the global

```
declare const Reflect: any;
Reflect.apply(f, t, a);

```

### [no-reflect-apply] var Reflect hoisted from a block shadows the global

```
function f() { if (c) { var Reflect = x; } return Reflect.apply(f, t, a); }

```

### [no-reflect-apply] class Reflect shadows the global

```
class Reflect {}
Reflect.apply(f, t, a);

```

### [no-reflect-apply] enum Reflect shadows the global

```
enum Reflect { A }
Reflect.apply(f, t, a);

```

### [no-reflect-apply] namespace Reflect shadows the global

```
namespace Reflect { export const apply = 1; }
Reflect.apply(f, t, a);

```

### [no-reflect-apply] Reflect.apply on an unchanged base line is not flagged

```
const a = Reflect.apply(op, owner, args);
const b = 1;

```

### [no-reflect-get] plain property access

```
const value = owner.property;

```

### [no-reflect-get] computed property access

```
const value = owner[key];

```

### [no-reflect-get] other Reflect method

```
Reflect.set(owner, key, value);

```

### [no-reflect-get] get on another receiver

```
const value = map.get(key);

```

### [no-reflect-get] locally declared Reflect shadows the global

```
const Reflect = { get() { return 1; } }; Reflect.get();

```

### [no-reflect-get] parameter named Reflect shadows the global

```
function read(Reflect: { get(): number }) { return Reflect.get(); }

```

### [no-reflect-get] declare const Reflect shadows the global

```
declare const Reflect: any;
Reflect.get(o, k);

```

### [no-reflect-get] var Reflect hoisted from a block shadows the global

```
function f() { if (c) { var Reflect = x; } return Reflect.get(o, k); }

```

### [no-reflect-get] class Reflect shadows the global

```
class Reflect {}
Reflect.get(o, k);

```

### [no-reflect-get] enum Reflect shadows the global

```
enum Reflect { A }
Reflect.get(o, k);

```

### [no-reflect-get] namespace Reflect shadows the global

```
namespace Reflect { export const get = 1; }
Reflect.get(o, k);

```

### [no-reflect-get] Reflect.get on an unchanged base line is not flagged

```
const a = Reflect.get(owner, key);
const b = 1;

```

### [no-shape-in-symbol-names] borrowed member .shape read

```
declare const schema: ExternalSchema; const field = schema.shape.id;

```

### [no-shape-in-symbol-names] borrowed nested member .shape

```
declare const outer: External; const value = outer.inner.shape;

```

### [no-shape-in-symbol-names] borrowed member .shape in call chain

```
declare const schema: ExternalSchema; schema.shape.id.parse('x');

```

### [no-shape-in-symbol-names] unrelated names

```
const owner = { id: 1 }; const value = owner.id;

```

### [no-shape-in-symbol-names] optional-chained borrowed member

```
declare const o: External; const v = o?.shape;

```

### [no-shape-in-symbol-names] shape on an unchanged base line is not flagged

```
const shape = 1;
const b = 2;

```

## Flagged

### [no-accumulator-spread] items.reduce((acc, x) => ({...acc, [x.id]: x}), {});

```
items.reduce((acc, x) => ({...acc, [x.id]: x}), {});

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduce((acc, x) => [...acc, x], []);

```
items.reduce((acc, x) => [...acc, x], []);

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduce((acc, x) => { return {...acc, k: x}; }, {});

```
items.reduce((acc, x) => { return {...acc, k: x}; }, {});

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduce(function (acc, x) { return [...acc, x]; }, []);

```
items.reduce(function (acc, x) { return [...acc, x]; }, []);

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduceRight((acc, x) => [...acc, x], []);

```
items.reduceRight((acc, x) => [...acc, x], []);

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items?.reduce((acc, x) => ({ ...acc, k: x }), {});

```
items?.reduce((acc, x) => ({ ...acc, k: x }), {});

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduce((acc, x) => ({ ...(acc as State), k: x }), {});

```
items.reduce((acc, x) => ({ ...(acc as State), k: x }), {});

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] items.reduce((acc, x) => { { var acc = []; return [...acc]; } }, []);

```
items.reduce((acc, x) => { { var acc = []; return [...acc]; } }, []);

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-accumulator-spread] fires on a .js file

```js
items.reduce((acc, x) => [...acc, x], []);

```

**Expected findings:**
- [no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.

### [no-array-filter-map] array literal filter.map

```
[].filter(active).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] array literal map.filter

```
[].map(user => user.active ? user.email : undefined).filter(email => email !== undefined);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `map` and `filter` passes. Prefer `.values().map(...).filter(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] const array map.filter

```
const users = []; users.map(email).filter(Boolean);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `map` and `filter` passes. Prefer `.values().map(...).filter(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] alias of const array

```
const users = []; const alias = users; alias.filter(active).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] User[] annotation

```
function collect(users: User[]) { return users.filter(active).map(email); }

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] readonly User[] annotation

```
function collect(users: readonly User[]) { return users.map(email).filter(present); }

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `map` and `filter` passes. Prefer `.values().map(...).filter(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] ReadonlyArray annotation

```
function collect(users: ReadonlyArray<User>) { return users.filter(active).map(email); }

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] Array<User> annotation

```
function collect(users: Array<User>) { return users.filter(active).map(email); }

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] computed string methods on `as const` array

```
const users = [] as const; users['filter'](active)['map'](email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] non-null and parenthesised inner call

```
const users = []; (users.filter(active)!).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] optional chaining

```
const users = []; users?.filter(active)?.map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] array-preserving slice before filter.map

```
const users = []; users.slice().filter(active).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] filter.map.filter flags both adjacent pairs

```
const users = []; users.filter(active).map(email).filter(Boolean);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `map` and `filter` passes. Prefer `.values().map(...).filter(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] multi-line chain is reported on the chain start row

```
const users = [];
const out = users
  .filter(active)
  .map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] only the added chain is flagged when base has other lines

```
const a = 1;
[].filter(active).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] write to shadowing binding in nested function does not suppress

```
let a: User[] = [];
function f(){ let a: number = 0; a = 1; }
a.filter(g).map(h);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-array-filter-map] fires on a .js file

```js
[].filter(active).map(email);

```

**Expected findings:**
- [no-array-filter-map] Avoid consecutive array `filter` and `map` passes. Prefer `.values().filter(...).map(...).toArray()` where iterator helpers are supported, or a single `flatMap`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.

### [no-conditional-empty-object-spread] empty alternate

```
const result = { ...(value !== undefined ? { value } : {}) };

```

**Expected findings:**
- [no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.

### [no-conditional-empty-object-spread] empty consequent

```
const result = { ...(condition ? {} : { value }) };

```

**Expected findings:**
- [no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.

### [no-conditional-empty-object-spread] unparenthesized ternary

```
const result = { ...condition ? { value } : {} };

```

**Expected findings:**
- [no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.

### [no-conditional-empty-object-spread] double parentheses

```
const result = { ...((c ? { v } : {})) };

```

**Expected findings:**
- [no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.

### [no-conditional-empty-object-spread] fires on a .js file

```js
const result = { ...(c ? { v } : {}) };

```

**Expected findings:**
- [no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});

```
items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduceRight((acc, item) => Object.assign({}, acc, item), {});

```
items.reduceRight((acc, item) => Object.assign({}, acc, item), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});

```
items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce(acc => Object.assign({}, acc), {});

```
items.reduce(acc => Object.assign({}, acc), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});

```
items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});

```
items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});

```
items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});

```
items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => Object.assign({}, acc as State, item), {});

```
items.reduce((acc, item) => Object.assign({}, acc as State, item), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});

```
items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.concat([item]), []);

```
items.reduce((acc, item) => acc.concat([item]), []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);

```
items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);

```
items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);

```
items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] const initial = []; items.reduce((acc, item) => acc.concat(item), initial);

```
const initial = []; items.reduce((acc, item) => acc.concat(item), initial);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);

```
items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);

```
items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.toSorted(), []);

```
items.reduce((acc, item) => acc.toSorted(), []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.toReversed(), []);

```
items.reduce((acc, item) => acc.toReversed(), []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] items.reduce((acc, item) => acc.with(0, item), []);

```
items.reduce((acc, item) => acc.with(0, item), []);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] fires on a .js file

```js
items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] function f(initial: Item[]) { return items.reduce((acc, i) => acc.concat(i), initial); }

```
function f(initial: Item[]) { return items.reduce((acc, i) => acc.concat(i), initial); }

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reduce-accumulator-copy] let initial: Item[] = []; items.reduce((acc, i) => acc.concat(i), initial);

```
let initial: Item[] = [];
items.reduce((acc, i) => acc.concat(i), initial);

```

**Expected findings:**
- [no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.

### [no-reflect-apply] Reflect.apply call

```
const value = Reflect.apply(operation, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-apply] computed string member Reflect['apply']

```
const value = Reflect['apply'](operation, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-apply] optional-chained Reflect?.apply

```
const value = Reflect?.apply(operation, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-apply] optional call Reflect.apply?.()

```
const value = Reflect.apply?.(operation, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-apply] only the added Reflect.apply line is flagged when base has other lines

```
const a = 1;
const b = Reflect.apply(op, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-apply] fires on a .js file

```js
const value = Reflect.apply(operation, owner, args);

```

**Expected findings:**
- [no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.

### [no-reflect-get] Reflect.get call

```
const value = Reflect.get(owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-reflect-get] computed string member Reflect['get']

```
const value = Reflect['get'](owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-reflect-get] optional-chained Reflect?.get

```
const value = Reflect?.get(owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-reflect-get] optional call Reflect.get?.()

```
const value = Reflect.get?.(owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-reflect-get] only the added Reflect.get line is flagged when base has other lines

```
const a = 1;
const b = Reflect.get(owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-reflect-get] fires on a .js file

```js
const value = Reflect.get(owner, key);

```

**Expected findings:**
- [no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.

### [no-shape-in-symbol-names] variable

```
const shape = 1;

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] function name

```
function shapeOf() {}

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shapeOf" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] type alias, case-insensitive

```
type PayloadShape = { id: string };

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "PayloadShape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] type property key

```
type Payload = { shape: string };

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] declaration and computed use both flagged

```
declare const owner: External; const shape = 'field'; const value = owner[shape];

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] parameter

```
function f(shapeP: number) {}

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shapeP" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] private field

```
class C { #shape = 1; }

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "#shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] JSX member tag

```tsx
const a = <b.Shape />;

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "Shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] fires on a .js file

```js
const shape = 1;

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] shorthand property reports key and value

```
const shape = 1;
const o = { shape };

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] shorthand destructure reports key and value

```
const { shape } = x;

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] unaliased import reports imported and local

```
import { shape } from 'x';

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] unaliased export reports local and exported plus declaration

```
const shape = 1; export { shape };

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] non-shorthand property reports once

```
const o = { shape: 1 };

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] aliased import away from shape reports once

```
import { shape as s } from 'x';

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] aliased import to shape reports once

```
import { a as shape } from 'x';

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.

### [no-shape-in-symbol-names] renamed destructure reports once

```
const { shape: s } = o;

```

**Expected findings:**
- [no-shape-in-symbol-names] Rename symbol "shape" for its domain role; "shape" describes structure rather than ownership.
