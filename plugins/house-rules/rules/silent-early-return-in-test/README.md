<!-- This file is generated. Do not edit manually. -->

# silent-early-return-in-test

Flags `if (cond) return;` in a test body with no preceding expect on the condition, which passes vacuously.

**Severity**: warn | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [silent-early-return-in-test] guard follows an expect on the same identifier

```ts
it('x', () => {
  const r = run();
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value).toBe(1);
});

```

### [silent-early-return-in-test] it.skipIf is the sanctioned form

```ts
it.skipIf(!ready)('x', () => {
  expect(run()).toBe(1);
});

```

### [silent-early-return-in-test] return inside a nested helper closure

```ts
it('x', () => {
  const pick = (r: R) => {
    if (!r.ok) return;
    return r.value;
  };
  expect(pick(run())).toBe(1);
});

```

### [silent-early-return-in-test] non-test file

```ts
it('x', () => {
  const r = run();
  if (!r.ok) return;
  expect(r.value).toBe(1);
});

```

### [silent-early-return-in-test] return with a value

```ts
it('x', () => {
  const r = run();
  if (!r.ok) return r;
  expect(r.value).toBe(1);
});

```

### [silent-early-return-in-test] guard outside any test callback

```ts
describe('x', () => {
  const r = run();
  if (!r.ok) return;
});

```

## Flagged

### [silent-early-return-in-test] known-present: guard before the only expect

```ts
it('x', async () => {
  const r = await runFix(src);
  if (!r.ok) return;
  expect(r.fixed).toContain(P);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.

### [silent-early-return-in-test] block form return

```ts
test('x', () => {
  const r = run();
  if (!r.ok) {
    return;
  }
  expect(r.value).toBe(1);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.

### [silent-early-return-in-test] expect on an unrelated identifier does not excuse the guard

```ts
it('x', () => {
  expect(a).toBe(1);
  if (!r.ok) return;
  expect(r.value).toBe(1);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.

### [silent-early-return-in-test] it.only callback

```ts
it.only('x', () => {
  if (!ready) return;
  expect(1).toBe(1);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.

### [silent-early-return-in-test] it.each callback

```ts
it.each([1, 2])('x', (n) => {
  if (n > 1) return;
  expect(n).toBe(1);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.

### [silent-early-return-in-test] file under a test directory

```ts
it('x', () => {
  if (!ready) return;
  expect(1).toBe(1);
});

```

**Expected findings:**
- [silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.
