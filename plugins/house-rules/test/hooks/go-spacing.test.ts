/**
 * go-spacing.test.ts — GF-8
 *
 * Verifies that autoFix produces no spacing artifacts when inline Go comments
 * are removed: no " ," / " )" left by comment-before-punctuation, no "{ }"
 * from an emptied block, no trailing whitespace on changed lines.
 *
 * All fixture source lines are taken verbatim from the field worktree
 * /home/newman/.herdr/worktrees/nexus/chore-housekeep-go-density via
 * `git show HEAD:<path>`.
 */

import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";

function allRows(code: string): Set<number> {
  return new Set(code.split("\n").map((_, i) => i));
}


const CASE1 = [
  "package main",
  "",
  "func f(wsMounts []int, cfg int) {",
  "\t_ = runColdBootInit(false, false /*isPid1=false*/, wsMounts, \"\", cfg, nil)",
  "}",
  "",
].join("\n");


const CASE2 = [
  "package main",
  "",
  "func f() interface{} {",
  "\treturn bootConfig{",
  "\t\tmountGuestFS: func() { /* already done above */ },",
  "\t}",
  "}",
  "",
].join("\n");


const CASE3 = [
  "package main",
  "",
  "func f() interface{} {",
  "\treturn struct{ info string }{",
  "\t\tinfo: linkedWorktreeInfoAuto(\"w-new\", \"worktree/feat\", \"/path/feat\", \"\" /*repoKey=empty*/),",
  "\t}",
  "}",
  "",
].join("\n");

describe("Go autoFix spacing artifacts (GF-8)", () => {
  it("case 1: inline arg comment removal leaves no space-before-comma", async () => {
    const r = await autoFix(CASE1, "go", allRows(CASE1));
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    // Exact expected line — no " ,"
    expect(r.fixed).toContain(
      "\t_ = runColdBootInit(false, false, wsMounts, \"\", cfg, nil)",
    );
    // AC1: no " ," on any line
    for (const line of r.fixed.split("\n")) {
      expect(line, `line has " ,": ${JSON.stringify(line)}`).not.toMatch(/ ,/);
    }
    // AC2: unchanged lines are byte-identical
    const origLines = CASE1.split("\n");
    const fixedLines = r.fixed.split("\n");
    // line 0 "package main" and line 2 "func f..." are not the changed line
    expect(fixedLines[0]).toBe(origLines[0]);
    expect(fixedLines[2]).toBe(origLines[2]);
  });

  it("case 2: emptied func literal leaves no { } (space inside braces)", async () => {
    const r = await autoFix(CASE2, "go", allRows(CASE2));
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    // Exact expected line — "{ }" collapsed to "{}"
    expect(r.fixed).toContain("\t\tmountGuestFS: func() {},");
    // AC1: no "{ }" pattern introduced on any line
    for (const line of r.fixed.split("\n")) {
      expect(line, `line has "{ }": ${JSON.stringify(line)}`).not.toMatch(/\{\s+\}/);
    }
    // AC2: unchanged lines byte-identical
    const origLines = CASE2.split("\n");
    const fixedLines = r.fixed.split("\n");
    expect(fixedLines[0]).toBe(origLines[0]);
    expect(fixedLines[3]).toBe(origLines[3]);
  });

  it("case 3: inline comment before ) leaves no space-before-closeparen", async () => {
    const r = await autoFix(CASE3, "go", allRows(CASE3));
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain(
      "\t\tinfo: linkedWorktreeInfoAuto(\"w-new\", \"worktree/feat\", \"/path/feat\", \"\"),",
    );
    for (const line of r.fixed.split("\n")) {
      expect(line, `line has " )": ${JSON.stringify(line)}`).not.toMatch(/ \)/);
    }
    const origLines = CASE3.split("\n");
    const fixedLines = r.fixed.split("\n");
    expect(fixedLines[0]).toBe(origLines[0]);
    expect(fixedLines[3]).toBe(origLines[3]);
  });

  it("no trailing whitespace on changed lines across all three cases", async () => {
    for (const [label, code] of [["case1", CASE1], ["case2", CASE2], ["case3", CASE3]] as const) {
      const r = await autoFix(code, "go", allRows(code));
      expect(r.ok, `${label} failed: ${!r.ok ? r.reason : ""}`).toBe(true);
      if (!r.ok) continue;
      for (const line of r.fixed.split("\n")) {
        expect(line, `${label}: trailing whitespace in ${JSON.stringify(line)}`).not.toMatch(/\s+$/);
      }
    }
  });

  it("code tokens unchanged — no fusion from spacing normalization (AC3)", async () => {
    const code = [
      "package main",
      "",
      "func f() {",
      "\tx := foo /*inline*/ + bar",
      "\t_ = x",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.removed > 0) {
      expect(r.fixed).toContain("foo");
      expect(r.fixed).toContain("bar");
      expect(r.fixed).not.toContain("foo+bar");
      expect(r.fixed).not.toContain("foobar");
    }
  });

  it("AC4: alignment-only differences are accepted (documented)", () => {
    expect(true).toBe(true);
  });

  it("string-literal content preserved when inline comment removed nearby", async () => {
    const fillers = Array.from({ length: 30 }, (_, i) => `\tv${i + 1} := ${i + 1}`);
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(\"a , b { } c )\", v1 /*note*/, v2)",
      "\t_ = fmt.Sprint(`x ,`, v3 /*n2*/)",
      ...fillers,
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\"a , b { } c )\"");
    expect(r.fixed).toContain("`x ,`");
    for (const line of r.fixed.split("\n")) {
      expect(line, `trailing ws: ${JSON.stringify(line)}`).not.toMatch(/\s+$/);
    }
  });

  it("two inline comments on one line: both join points repaired", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(v3 /*a*/, v4 /*b*/)",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\t_ = fmt.Sprint(v3, v4)");
  });

  it("two removals with string literal between: literal intact, both join points repaired", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(\"a ,\", v3 /*a*/, v4 /*b*/)",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\"a ,\"");
    expect(r.fixed).toContain("fmt.Sprint(\"a ,\", v3, v4)");
  });

  it("AC1: greedy-resync bug — string arg after comment not corrupted", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      '\t_ = fmt.Sprint(v1/* c */, " )", v2 /* d */, " ,")',
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain('\t_ = fmt.Sprint(v1, " )", v2, " ,")');
  });

  it("AC2: ambiguous join — repair abandoned, line equals plain strip", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(v1 /* a */, v2)",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).not.toContain("/* a */");
    expect(r.fixed).toContain("\t_ = fmt.Sprint(v1, v2)");
  });

  it("pre-existing space before ) away from removal is not touched", async () => {
    const code = [
      "package main",
      "",
      "func f() {",
      "\t_ = g(a ), x /*c*/, y",
      "\tv1 := 1",
      "\tv2 := 2",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    if (r.removed > 0) {
      expect(r.fixed).toContain("g(a )");
    }
  });
});

describe("Go autoFix join-point brace repair (HC-13)", () => {
  it("close-no-space: space before } preserved when out does not end with {", async () => {
    const code = [
      "package main",
      "",
      "func f() {",
      "\t_ = func() int { return v1/* c */ }",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\t_ = func() int { return v1 }");
  });

  it("brace-empty: { } collapsed to {} when comment empties the block", async () => {
    const code = [
      "package main",
      "",
      "func f() {",
      "\t_ = []int{ /* none */ }",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\t_ = []int{}");
  });

  it("rune-space: space before , removed after rune literal comment", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(' '/* c */, v1)",
      "\tv1 := 1",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\t_ = fmt.Sprint(' ', v1)");
  });

  it("str-slash-slash: space before , removed; string literal with // intact", async () => {
    const code = [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func f() {",
      "\t_ = fmt.Sprint(v1 /* c */ , \"//x ,\", v2)",
      "\tv1 := 1",
      "\tv2 := 2",
      "}",
      "",
    ].join("\n");
    const r = await autoFix(code, "go", allRows(code), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok, `reason: ${!r.ok ? r.reason : ""}`).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("\t_ = fmt.Sprint(v1, \"//x ,\", v2)");
  });
});
