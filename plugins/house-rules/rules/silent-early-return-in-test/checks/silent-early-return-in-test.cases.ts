import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE = '[silent-early-return-in-test] Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.';
const finding = (line: number) => ({ line, message: MESSAGE });

export const cases: RuleCases = {
  valid: [
    { why: 'guard follows an expect on the same identifier', filename: 'a.test.ts', code: "it('x', () => {\n  const r = run();\n  expect(r.ok).toBe(true);\n  if (!r.ok) return;\n  expect(r.value).toBe(1);\n});\n" },
    { why: 'it.skipIf is the sanctioned form', filename: 'a.test.ts', code: "it.skipIf(!ready)('x', () => {\n  expect(run()).toBe(1);\n});\n" },
    { why: 'return inside a nested helper closure', filename: 'a.test.ts', code: "it('x', () => {\n  const pick = (r: R) => {\n    if (!r.ok) return;\n    return r.value;\n  };\n  expect(pick(run())).toBe(1);\n});\n" },
    { why: 'non-test file', filename: 'helper.ts', code: "it('x', () => {\n  const r = run();\n  if (!r.ok) return;\n  expect(r.value).toBe(1);\n});\n" },
    { why: 'return with a value', filename: 'a.test.ts', code: "it('x', () => {\n  const r = run();\n  if (!r.ok) return r;\n  expect(r.value).toBe(1);\n});\n" },
    { why: 'guard outside any test callback', filename: 'a.test.ts', code: "describe('x', () => {\n  const r = run();\n  if (!r.ok) return;\n});\n" },
  ],
  invalid: [
    { why: 'known-present: guard before the only expect', filename: 'a.test.ts', code: "it('x', async () => {\n  const r = await runFix(src);\n  if (!r.ok) return;\n  expect(r.fixed).toContain(P);\n});\n", findings: [finding(3)] },
    { why: 'block form return', filename: 'a.test.ts', code: "test('x', () => {\n  const r = run();\n  if (!r.ok) {\n    return;\n  }\n  expect(r.value).toBe(1);\n});\n", findings: [finding(3)] },
    { why: 'expect on an unrelated identifier does not excuse the guard', filename: 'a.test.ts', code: "it('x', () => {\n  expect(a).toBe(1);\n  if (!r.ok) return;\n  expect(r.value).toBe(1);\n});\n", findings: [finding(3)] },
    { why: 'it.only callback', filename: 'a.test.ts', code: "it.only('x', () => {\n  if (!ready) return;\n  expect(1).toBe(1);\n});\n", findings: [finding(2)] },
    { why: 'it.each callback', filename: 'a.test.ts', code: "it.each([1, 2])('x', (n) => {\n  if (n > 1) return;\n  expect(n).toBe(1);\n});\n", findings: [finding(2)] },
    { why: 'file under a test directory', filename: 'test/a.ts', code: "it('x', () => {\n  if (!ready) return;\n  expect(1).toBe(1);\n});\n", findings: [finding(2)] },
  ],
};
