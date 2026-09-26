import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";

function rowsForCap(commentRows: number[], cap: number): Set<number> {
  const needed = cap * 20;
  const s = new Set(commentRows);
  let pad = 10000;
  while (s.size < needed) s.add(pad++);
  return s;
}

describe("Go comment groups", () => {
  describe("defect 1: note continuation protected", () => {
    it("cont line stays when TODO marker stays", async () => {
      // Blank line before func keeps comments from being doc comments.
      const text = [
        "package foo",
        "",
        "// a1",
        "// a2",
        "// a3",
        "// a4",
        "// a5",
        "// TODO(bob): fix later",
        "// cont1",
        "// cont2",
        "// b",
        "",
        "func F() {}",
      ].join("\n");
      // rows: 2=a1 3=a2 4=a3 5=a4 6=a5 7=TODO(exempt) 8=cont1 9=cont2 10=b
      const commentRows = [2, 3, 4, 5, 6, 8, 9, 10];
      const rows = rowsForCap(commentRows, 5);
      const result = await autoFix(text, "go", rows);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // TODO marker is exempt — always stays
      expect(result.fixed).toContain("// TODO(bob): fix later");
      // cont1 and cont2 are note continuations — must not be removed while marker stays
      expect(result.fixed).toContain("// cont1");
      expect(result.fixed).toContain("// cont2");
      // prose before TODO must be removable (budget exercised)
      expect(result.fixed).not.toContain("// a1");
    });
  });

  describe("defect 2: block comment mid-paragraph", () => {
    it("block comment does not split a Go CommentGroup for removal", async () => {
      const text = [
        "package foo",
        "",
        "// a1",
        "/* mid */",
        "// a2",
        "// a3",
        "// a4",
        "// a5",
        "// a6",
        "",
        "func F() {}",
      ].join("\n");
      // rows: 2=a1 3=mid 4=a2 5=a3 6=a4 7=a5 8=a6
      const commentRows = [2, 3, 4, 5, 6, 7, 8];
      const rows = rowsForCap(commentRows, 5);
      const result = await autoFix(text, "go", rows);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // CommentGroup is 7 rows (cap=5) — whole group removed, not partially
      const hasA1 = result.fixed.includes("// a1");
      const hasMid = result.fixed.includes("/* mid */");
      const hasA2 = result.fixed.includes("// a2");
      expect(hasA1).toBe(hasMid);
      expect(hasMid).toBe(hasA2);
      expect(hasA1).toBe(false);
    });
  });

  describe("defect 3: directive does not split paragraph", () => {
    it("prose on both sides of directive removed together or not at all", async () => {
      const text = [
        "package foo",
        "",
        "// a1",
        "// a2",
        "//nolint",
        "// a3",
        "// a4",
        "// a5",
        "// a6",
        "",
        "func F() {}",
      ].join("\n");
      // rows: 2=a1 3=a2 4=nolint(exempt) 5=a3 6=a4 7=a5 8=a6
      const commentRows = [2, 3, 5, 6, 7, 8];
      const rows = rowsForCap(commentRows, 5);
      const result = await autoFix(text, "go", rows);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.fixed).toContain("//nolint");
      const hasA1 = result.fixed.includes("// a1");
      const hasA3 = result.fixed.includes("// a3");
      expect(hasA1).toBe(hasA3);
      expect(hasA1).toBe(false);
    });
  });

  describe("defect 4: budget skip-and-continue", () => {
    it("small unit after large unit is kept when it fits", async () => {
      const text = [
        "package foo",
        "",
        "// a",
        "// b",
        "// c",
        "",
        "// d",
        "",
        "func F() {}",
      ].join("\n");
      const commentRows = [2, 3, 4, 6];
      const rows = rowsForCap(commentRows, 2);
      const result = await autoFix(text, "go", rows);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.fixed).not.toContain("// a\n");
      expect(result.fixed).not.toContain("// b\n");
      expect(result.fixed).not.toContain("// c\n");
      expect(result.fixed).toContain("// d");
    });
  });

  describe("defect 5: idempotence", () => {
    const goInputs: string[] = [
      [
        "package foo",
        "",
        "// a1",
        "// a2",
        "// a3",
        "// a4",
        "// a5",
        "// a6",
        "",
        "func F() {}",
      ].join("\n"),
      [
        "package foo",
        "",
        "// a1",
        "/* mid */",
        "// a2",
        "// a3",
        "",
        "func F() {}",
      ].join("\n"),
      [
        "package foo",
        "",
        "// TODO(alice): something",
        "// continuation",
        "",
        "func F() {}",
      ].join("\n"),
    ];

    for (let idx = 0; idx < goInputs.length; idx++) {
      const input = goInputs[idx];
      it(`idempotent on input ${idx}`, async () => {
        const allRows = new Set(Array.from({ length: 100 }, (_, i) => i));
        const r1 = await autoFix(input, "go", allRows);
        if (!r1.ok) return;
        const r2 = await autoFix(r1.fixed, "go", allRows);
        expect(r2.ok).toBe(true);
        if (!r2.ok) return;
        expect(r2.removed).toBe(0);
      });
    }
  });
});
