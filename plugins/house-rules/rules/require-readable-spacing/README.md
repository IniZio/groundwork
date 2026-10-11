<!-- This file is generated. Do not edit manually. -->

# require-readable-spacing

Require readable spacing between declarations and logical statement groups.

**Severity**: off | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [require-readable-spacing] imports then blank line before export

```
import { a } from 'a';
import { b } from 'b';

export const c = a + b;
```

### [require-readable-spacing] const run then blank line before return

```
function f() {
const a = 1;
const b = 2;

return a + b;
}
```

### [require-readable-spacing] single-statement function body

```
function f() { return 1; }
```

### [require-readable-spacing] overload signatures adjacent

```
function f(a: string): string;
function f(a: number): number;
function f(a: string | number) { return a; }
```

### [require-readable-spacing] exported overload signatures adjacent

```
export function f(a: string): string;
export function f(a: number): number;
export function f(a: string | number) { return a; }
```

### [require-readable-spacing] Effect.gen const run then blank before return

```
const f = Effect.gen(function* () {
const a = yield* A;
const b = yield* B;

return a + b;
});
```

### [require-readable-spacing] doc comment after blank line

```
export type A = string;

/** B documentation. */
export type B = number;
```

### [require-readable-spacing] single-line if/else block

```
function f() { if (ok) { go(); } else { stop(); } }
```

### [require-readable-spacing] leading comment only before sole return

```
function f() {
// return docs
return 1;
}
```

### [require-readable-spacing] multiple blank lines accepted

```
const a = 1;


const b = 2;
```

### [require-readable-spacing] switch case fallthrough single line

```
switch (x) { case 1: case 2: go(); break; default: stop(); }
```

## Flagged

### [require-readable-spacing] adjacent consts

```
const a = 1;
const b = 2;
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] doc comment attached to next export without blank

```
export const a = 1;
/** B docs. */
export type B = number;
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] trailing comment then leading comment

```
const a = 1; // trailing
// leading
const b = 2;
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] two statements on one line

```
const a = 1; const b = 2;
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] import directly followed by const

```
import { a } from 'a';
const b = a;
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] const then return in function

```
function f() {
const a = 1;
return a;
}
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] const then if without braces

```
function f() {
const a = 1;
if (a) go();
}
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] block statement then expression

```
function f() {
if (ok) { go(); }
stop();
}
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] Effect.gen with two violations

```
const f = Effect.gen(function* () {
const a = yield* A;
const b = yield* B;
const dispatch = Effect.fn('dispatch')(function* () {
yield* a;
});
return dispatch;
});
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] interface then class

```
export interface A {}
export class B {}
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] leading semicolon ASI statement

```
const a = 1
;[1].forEach(f)
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.

### [require-readable-spacing] expression then while

```
function f() {
foo();
while (ok) go();
}
```

**Expected findings:**
- [require-readable-spacing] Expected blank line before this statement.
