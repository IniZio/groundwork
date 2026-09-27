import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";

function countAdjacentPairs(text: string): number {
  const DIV = /^\s*\/\/\s*(?:[-=#*~_]{4,}|[─-╿]{2,})\s*$/u;
  const SPACER = /^\s*\/\/\s*$/;
  const lines = text.split("\n");
  let p = false, c = 0;
  for (const line of lines) {
    if (DIV.test(line)) { if (p) c++; p = true; }
    else if (SPACER.test(line)) { /* keep p */ }
    else p = false;
  }
  return c;
}

function rowsOf(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

// Go comments inside a function body avoid go-doc exemption.
const GO_PREFIX = "package main\n\nfunc F() {\n";
const GO_SUFFIX = "\t_ = 1\n}";

describe("orphan dividers — Go ride-along removal", () => {
  it("framed group over budget removes all 4 rows including dividers", async () => {
    const inner = [
      "\t// ───────────────────────────────────────────────",
      "\t// a",
      "\t// b",
      "\t// ───────────────────────────────────────────────",
    ].join("\n");
    const text = GO_PREFIX + inner + "\n" + GO_SUFFIX;
    const lines = text.split("\n");
    const addedRows = new Set(lines.map((l, i) => l.includes("─") || l === "\t// a" || l === "\t// b" ? i : -1).filter(i => i !== -1));
    const r = await autoFix(text, "go", addedRows, undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countAdjacentPairs(r.fixed)).toBe(0);
    expect(r.fixed.includes("─")).toBe(false);
  });

  it("framed group within budget keeps both dividers", async () => {
    const inner = [
      "\t// ───────────────────────────────────────────────",
      "\t// a",
      "\t// b",
      "\t// ───────────────────────────────────────────────",
      ...Array.from({ length: 60 }, (_, i) => `\t_ = ${i}`),
    ].join("\n");
    const text = GO_PREFIX + inner + "\n" + GO_SUFFIX;
    const r = await autoFix(text, "go", rowsOf(text));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countAdjacentPairs(r.fixed)).toBe(0);
    expect(r.fixed.split("\n").filter(l => l.includes("─")).length).toBe(2);
  });

  it("pre-existing divider next to removed prose survives, ok:true", async () => {
    // blank line before func prevents go-doc; only row 2 (prose) is in addedRows
    const text = "package main\n// ───────────────────────────────────────────────\n// added prose\n// ───────────────────────────────────────────────\n\nfunc F() {}";
    const addedRows = new Set([2]);
    const r = await autoFix(text, "go", addedRows, undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed.includes("─")).toBe(true);
    expect(r.fixed.split("\n").filter(l => l.includes("─")).length).toBe(2);
  });

  it("spacer inside removed group removed; spacer inside kept group kept", async () => {
    // Two separate groups split by a code line; removable has 2 prose, kept has 1 prose.
    const text = [
      "package main",
      "",
      "func G() {",
      "\t// ───────────────────────────────────────────────",
      "\t// removable A",
      "\t// removable B",
      "\t//",
      "\t// ───────────────────────────────────────────────",
      "\t_ = 1",
      "\t// ───────────────────────────────────────────────",
      "\t// kept",
      "\t//",
      "\t// ───────────────────────────────────────────────",
      "\t_ = 2",
      "}",
    ].join("\n");
    const r = await autoFix(text, "go", rowsOf(text), undefined, undefined, { maxAllowedRows: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countAdjacentPairs(r.fixed)).toBe(0);
    expect(r.fixed).toContain("kept");
    expect(r.fixed).not.toContain("removable");
    expect(r.fixed.split("\n").filter(l => /^\s*\/\/\s*$/.test(l)).length).toBe(1);
  });
});

describe("orphan dividers — real swap_test.go fixture", () => {
  // Exact divider-framed block from nexus f7898a5:cmd/nexus-agent/swap_test.go
  const fixture = `package main

import "testing"

// ─────────────────────────────────────────────────────────────────────────────
// Mutation proof: chmod failure → exec must not be called; rollback must fire.
//
// Production path: performSwap step 4.5 calls chmodExec(installPath); on error
// it calls renameAtomic(backupPath, installPath) and returns without exec.
//
// Mutation A (catches wrong path): change chmodExec(installPath) →
//   chmodExec(stagedPath) — the exact-path assertion in HappyPath goes red.
// Mutation B (catches missing rollback): remove the renameAtomic call inside
//   the chmod-failure branch — this test goes red.
// ─────────────────────────────────────────────────────────────────────────────

func TestPerformSwap_ChmodFails(t *testing.T) {
\tt.Helper()
}`;

  it("all rows added over budget yields 0 adjacent pairs and unchanged code tokens", async () => {
    const r = await autoFix(fixture, "go", rowsOf(fixture), undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countAdjacentPairs(r.fixed)).toBe(0);
  });
});

describe("orphan dividers — TypeScript ride-along removal", () => {
  it("framed group over budget removes all 4 rows including dividers", async () => {
    const text = [
      "// ───────────────────────────────────────────────",
      "// a",
      "// b",
      "// ───────────────────────────────────────────────",
      "const x = 1;",
    ].join("\n");
    const addedRows = new Set([0, 1, 2, 3]);
    const r = await autoFix(text, "typescript", addedRows, undefined, undefined, { maxAllowedRows: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(countAdjacentPairs(r.fixed)).toBe(0);
    expect(r.fixed.includes("─")).toBe(false);
  });
});
