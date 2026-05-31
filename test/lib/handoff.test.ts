import { describe, test, expect } from "vitest";
import { parseFileReferences } from "../../src/lib/handoff.js";

describe("parseFileReferences", () => {
  test("extracts @file references", () => {
    const text = "Check @src/index.ts and @lib/utils.ts";
    const refs = parseFileReferences(text);
    expect(refs).toEqual(["src/index.ts", "lib/utils.ts"]);
  });

  test("handles file refs in parentheses", () => {
    const text = "See (@docs/readme.md) for details";
    const refs = parseFileReferences(text);
    expect(refs).toContain("docs/readme.md");
  });

  test("deduplicates repeated refs", () => {
    const text = "@src/a.ts @src/a.ts @src/b.ts";
    const refs = parseFileReferences(text);
    expect(refs).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("returns empty array when no refs", () => {
    const text = "No file references here";
    const refs = parseFileReferences(text);
    expect(refs).toEqual([]);
  });
});
