import { describe, it, expect, afterEach } from "bun:test";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { findComments } from "../../src/hooks/lib/comment-density.js";

let sf = createSourceFiles();
afterEach(() => {
  sf.dispose();
  sf = createSourceFiles();
});

// ── Snippet definitions ───────────────────────────────────────────────────────

// B: single block comment adjacent to import "C" (contains embedded blank line and C doc comment)
const B =
  `package main\n\n/*\n#include <stdio.h>\n\n// Doc for hello.\nstatic void hello(void) { printf("hi\\n"); }\n*/\nimport "C"\n\nfunc main() {}\n`;

// C: four-comment preamble inside import () block (mixed //, //, /**, // before "C")
const C =
  `package main\n\nimport (\n\t"fmt"\n\n\t// #include <math.h>\n\t//\n\t/** sq doc */\n\t// static double sq(double x) { return x * x; }\n\t"C"\n)\n\nfunc main() { fmt.Println(C.sq(2)) }\n`;

// A: two separate groups — rows 2–4 (blank line separates from import), rows 6–7 adjacent to import "C"
const A =
  `package main\n\n// #cgo LDFLAGS: -lm\n//\n// #include <math.h>\n\n/** Embedded doc for sq. */\n// static double sq(double x) { return x * x; }\nimport "C"\n\nfunc main() {}\n`;

// E: ExampleHello (rows 7-10), NotExample (rows 15-18), ExampleUnordered (rows 22-24)
const E =
  `package p\n\nimport "fmt"\n\nfunc ExampleHello() {\n\tfmt.Println("hello")\n\tfmt.Println("world")\n\t// Output:\n\t// hello\n\t//\n\t// world\n}\n\nfunc NotExample() {\n\tfmt.Println("hello")\n\t// Output:\n\t// hello\n\t//\n\t// world\n}\n\nfunc ExampleUnordered() {\n\t// Unordered output:\n\t// b\n\t// a\n}\n`;

// ── Group 1: cgo preamble classified as directive in full ─────────────────────

describe("cgo preamble classified as directive in full", () => {
  it("B: block comment at row 2 adjacent to import C is directive with cgo-preamble label", async () => {
    const r = await sf.get("go", B);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.startRow === 2);
    expect(c, "comment at row 2 not found").toBeDefined();
    expect(c!.directive).toBe(true);
    expect(c!.label ?? c!.fallbackLabel).toBe("cgo-preamble");
  });

  it("C: all four preamble comments at rows 5,6,7,8 are directive with cgo-preamble label", async () => {
    const r = await sf.get("go", C);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const directiveRows = r.source.comments
      .filter((x) => x.directive)
      .map((x) => x.startRow)
      .sort((a, b) => a - b);
    expect(directiveRows).toEqual([5, 6, 7, 8]);
    for (const row of [5, 6, 7, 8]) {
      const c = r.source.comments.find((x) => x.startRow === row);
      expect(c, `comment at row ${row} not found`).toBeDefined();
      expect(c!.directive).toBe(true);
      expect(c!.label ?? c!.fallbackLabel).toBe("cgo-preamble");
    }
  });

  it("A: comment group at rows 6,7 adjacent to import C is directive", async () => {
    const r = await sf.get("go", A);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    for (const row of [6, 7]) {
      const c = r.source.comments.find((x) => x.startRow === row);
      expect(c, `comment at row ${row} not found`).toBeDefined();
      expect(c!.directive).toBe(true);
      expect(c!.label ?? c!.fallbackLabel).toBe("cgo-preamble");
    }
  });

  it("A: separate group at rows 2,3,4 (blank-line gap before import C) is not directive", async () => {
    const r = await sf.get("go", A);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    for (const row of [2, 3, 4]) {
      const c = r.source.comments.find((x) => x.startRow === row);
      expect(c, `comment at row ${row} not found`).toBeDefined();
      expect(c!.directive).toBe(false);
    }
  });
});

// ── Group 2: Example output is directive only inside Example functions ────────

describe("Example output is directive only inside Example functions", () => {
  it("E: ExampleHello output comments at rows 7,8,9,10 are directive with go-example-output label", async () => {
    const r = await sf.get("go", E);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const rowTexts: [number, string][] = [
      [7, "// Output:"],
      [8, "// hello"],
      [9, "//"],
      [10, "// world"],
    ];
    for (const [row, expectedText] of rowTexts) {
      const c = r.source.comments.find((x) => x.startRow === row);
      expect(c, `comment at row ${row} not found`).toBeDefined();
      expect(
        c!.text.trim().split("\n")[0].trim(),
        `text mismatch at row ${row}`,
      ).toBe(expectedText);
      expect(c!.directive).toBe(true);
      expect(c!.label ?? c!.fallbackLabel).toBe("go-example-output");
    }
  });

  it("E: NotExample output comments at rows 15,16,17,18 are not directive (positive-control: 4 found)", async () => {
    const r = await sf.get("go", E);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const notExampleRows = [15, 16, 17, 18];
    const notExampleTexts = ["// Output:", "// hello", "//", "// world"];
    // Positive control: all four exist
    const found = notExampleRows.map((row) =>
      r.source.comments.find((x) => x.startRow === row),
    );
    expect(
      found.filter(Boolean).length,
      "expected 4 NotExample comments",
    ).toBe(4);
    for (let i = 0; i < notExampleRows.length; i++) {
      const c = found[i];
      expect(c, `comment at row ${notExampleRows[i]} not found`).toBeDefined();
      expect(
        c!.text.trim().split("\n")[0].trim(),
        `text mismatch at row ${notExampleRows[i]}`,
      ).toBe(notExampleTexts[i]);
      expect(c!.directive).toBe(false);
    }
  });

  it("E: ExampleUnordered output comments at rows 22,23,24 are directive with go-example-output label", async () => {
    const r = await sf.get("go", E);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const rowTexts: [number, string][] = [
      [22, "// Unordered output:"],
      [23, "// b"],
      [24, "// a"],
    ];
    for (const [row, expectedText] of rowTexts) {
      const c = r.source.comments.find((x) => x.startRow === row);
      expect(c, `comment at row ${row} not found`).toBeDefined();
      expect(
        c!.text.trim().split("\n")[0].trim(),
        `text mismatch at row ${row}`,
      ).toBe(expectedText);
      expect(c!.directive).toBe(true);
      expect(c!.label ?? c!.fallbackLabel).toBe("go-example-output");
    }
  });
});

// ── Comment density cross-check ───────────────────────────────────────────────

describe("comment density cross-check for cgo and example-output", () => {
  it("E: rows 7,8,10 exemptReason go-example-output; row 9 spacer; rows 15,16,18 not exempt", async () => {
    const r = await findComments(E, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("findComments failed");
    const byRow = new Map(r.comments.map((c) => [c.startRow, c]));

    expect(byRow.get(7)?.exemptReason).toBe("go-example-output");
    expect(byRow.get(8)?.exemptReason).toBe("go-example-output");
    expect(byRow.get(9)?.exemptReason).toBe("spacer");
    expect(byRow.get(10)?.exemptReason).toBe("go-example-output");

    expect(byRow.get(15)?.exempt).toBe(false);
    expect(byRow.get(16)?.exempt).toBe(false);
    expect(byRow.get(18)?.exempt).toBe(false);
  });

  it("C: density rows 5,6,7,8 all have exemptReason cgo-preamble", async () => {
    const r = await findComments(C, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("findComments failed");
    const byRow = new Map(r.comments.map((c) => [c.startRow, c]));
    for (const row of [5, 6, 7, 8]) {
      expect(
        byRow.get(row)?.exemptReason,
        `row ${row} exemptReason`,
      ).toBe("cgo-preamble");
    }
  });
});
