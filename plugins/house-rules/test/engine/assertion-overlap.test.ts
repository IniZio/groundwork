import { describe, it, expect } from "bun:test";
import { dropOverlappingSafetyFindings } from "../../src/engine/assertion-overlap.js";
import type { Finding } from "../../src/engine/types.js";

const SAFETY = "require-safety-comment-for-type-assertion";
const TE = "type-escape-hatches";

function f(ruleId: string, path: string, line: number | undefined, message = ruleId): Finding {
  return { ruleId, path, line, message, fingerprintBasis: `${ruleId}:${path}:${line}` };
}

const ids = (xs: Finding[]) => xs.map((x) => `${x.ruleId}@${x.path}:${x.line}`);

describe("dropOverlappingSafetyFindings", () => {
  it("drops safety finding sharing path and line with a type-escape-hatches finding", () => {
    const out = dropOverlappingSafetyFindings([f(TE, "a.ts", 3), f(SAFETY, "a.ts", 3)]);
    expect(ids(out)).toEqual([`${TE}@a.ts:3`]);
  });

  it("keeps safety finding on a line with no type-escape-hatches finding", () => {
    const out = dropOverlappingSafetyFindings([f(TE, "a.ts", 3), f(SAFETY, "a.ts", 4)]);
    expect(ids(out)).toEqual([`${TE}@a.ts:3`, `${SAFETY}@a.ts:4`]);
  });

  it("keeps safety finding when same line is in a different path", () => {
    const out = dropOverlappingSafetyFindings([f(TE, "a.ts", 3), f(SAFETY, "b.ts", 3)]);
    expect(ids(out)).toEqual([`${TE}@a.ts:3`, `${SAFETY}@b.ts:3`]);
  });

  it("keeps safety finding without a line", () => {
    const out = dropOverlappingSafetyFindings([f(TE, "a.ts", undefined), f(SAFETY, "a.ts", undefined)]);
    expect(ids(out)).toEqual([`${TE}@a.ts:undefined`, `${SAFETY}@a.ts:undefined`]);
  });

  it("leaves other rules untouched and preserves order", () => {
    const input = [
      f(SAFETY, "a.ts", 9),
      f("code-smells", "a.ts", 3),
      f(TE, "a.ts", 3),
      f(SAFETY, "a.ts", 3),
      f("code-smells", "a.ts", 3, "dup"),
      f(SAFETY, "a.ts", 1),
    ];
    expect(ids(dropOverlappingSafetyFindings(input))).toEqual([
      `${SAFETY}@a.ts:9`,
      "code-smells@a.ts:3",
      `${TE}@a.ts:3`,
      "code-smells@a.ts:3",
      `${SAFETY}@a.ts:1`,
    ]);
  });

  it("returns identical rows when there are no type-escape-hatches findings", () => {
    const input = [f(SAFETY, "a.ts", 1), f("code-smells", "a.ts", 1)];
    const out = dropOverlappingSafetyFindings(input);
    expect(out).toEqual(input);
    expect(out[0]).toBe(input[0]!);
  });

  it("does not mutate its input", () => {
    const input = [f(TE, "a.ts", 3), f(SAFETY, "a.ts", 3)];
    dropOverlappingSafetyFindings(input);
    expect(input.length).toBe(2);
  });
});
