import { describe, it, expect } from "bun:test";
import { collectErrorRows, parserForPath } from "../../src/hooks/languages/parse.js";
import { findComments } from "../../src/hooks/lib/comment-density.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const ktParser = parserForPath(getParser, "sample.kt");
const tsParser = parserForPath(getParser, "sample.ts");

const KT_SNIPPET = `package com.example
class Widget {
    // comment one
    fun render(m: Map<String, List<Int>>) {
        m.forEach { (k, v): Map.Entry<String, List<Int>> ->
            println(k)
        }
    }
    // comment two
    fun other() = 1
}
`;

function rowOf(text: string, substr: string): number {
  const idx = text.indexOf(substr);
  if (idx === -1) throw new Error(`substr not found: ${substr}`);
  return text.slice(0, idx).split("\n").length - 1;
}

describe("collectErrorRows — Kotlin destructured-lambda error", () => {
  it("comment one is NOT in the error set; bad lambda row IS", async () => {
    const r = await ktParser("kotlin");
    if (!r.ok) throw new Error(`kotlin parser failed: ${r.reason}`);
    const tree = r.parser.parse(KT_SNIPPET)!;
    expect(tree.rootNode.hasError).toBe(true);
    const rows = collectErrorRows(tree.rootNode, "kotlin");

    const commentOneRow = rowOf(KT_SNIPPET, "// comment one");
    const badLambdaRow  = rowOf(KT_SNIPPET, "m.forEach { (k, v):");

    expect(rows.has(commentOneRow), "comment one must not be an error row").toBe(false);
    expect(rows.has(badLambdaRow),  "bad lambda row must be an error row").toBe(true);
  });

  it("exact set: anon-token rows plus skipped tail, phantom row excluded", async () => {
    const r = await ktParser("kotlin");
    if (!r.ok) throw new Error(`kotlin parser failed: ${r.reason}`);
    const tree = r.parser.parse(KT_SNIPPET)!;
    const rows = collectErrorRows(tree.rootNode, "kotlin");
    expect([...rows].sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("skipped tail (rows after ERROR last child) is fully marked", async () => {
    const r = await ktParser("kotlin");
    if (!r.ok) throw new Error(`kotlin parser failed: ${r.reason}`);
    const tree = r.parser.parse(KT_SNIPPET)!;
    const rows = collectErrorRows(tree.rootNode, "kotlin");
    for (const skippedRow of [5, 6, 7, 8, 9, 10]) {
      expect(rows.has(skippedRow), `skipped-tail row ${skippedRow} must be marked`).toBe(true);
    }
  });
});

describe("collectErrorRows — phantom row", () => {
  it("ERROR ending at column 0 does not include the extra row; exact set is [1]", async () => {
    const r = await ktParser("kotlin");
    if (!r.ok) throw new Error(`kotlin parser failed: ${r.reason}`);
    const text = "package com.example\nclass A {\n";
    const tree = r.parser.parse(text)!;
    expect(tree.rootNode.hasError, "test fixture must have a parse error").toBe(true);
    const rows = collectErrorRows(tree.rootNode, "kotlin");
    expect([...rows].sort((a, b) => a - b)).toEqual([1]);
  });
});

describe("collectErrorRows — TypeScript recovery wrap", () => {
  it("wrapped comment not in error set; exact set is [1, 3]", async () => {
    const text = [
      "// comment before",
      "const x = {",
      "// wrapped comment",
      "const y = 1;",
    ].join("\n") + "\n";
    const r = await tsParser("typescript");
    if (!r.ok) throw new Error(`typescript parser failed: ${r.reason}`);
    const tree = r.parser.parse(text)!;
    expect(tree.rootNode.hasError).toBe(true);
    const rows = collectErrorRows(tree.rootNode, "typescript");
    expect([...rows].sort((a, b) => a - b)).toEqual([1, 3]);
  });
});

describe("findComments — Kotlin snippet comment-density end-to-end", () => {
  it("comment one is counted; comment two is excluded as skipped-tail error content", async () => {
    const r = await findComments(KT_SNIPPET, "kotlin", ktParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = r.comments.map(c => c.text);
    expect(texts, "comment one must be counted").toContain("// comment one");
    expect(texts, "comment two is skipped-tail content and must NOT be counted").not.toContain("// comment two");
    expect(r.errorRows.size, "file still has error rows").toBeGreaterThan(0);
  });

  it("errorRows are narrow: far fewer than whole-span mapping", async () => {
    const r = await findComments(KT_SNIPPET, "kotlin", ktParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.errorRows.size).toBeLessThanOrEqual(10);
  });
});

describe("guard: edit that introduces syntax error is still detected", () => {
  it("TS: adding unparseable content grows errorRows.size", async () => {
    const clean = 'export const v = "ALPHA";\n';
    const broken = 'export const v = "ALPHA";\nexport const = = ;(\n';

    const rC = await tsParser("typescript");
    const rB = await tsParser("typescript");
    if (!rC.ok || !rB.ok) throw new Error("typescript parser failed");

    const treeClean = rC.parser.parse(clean)!;
    const treeBroke = rB.parser.parse(broken)!;

    const cleanRows = collectErrorRows(treeClean.rootNode, "typescript");
    const brokenRows = collectErrorRows(treeBroke.rootNode, "typescript");

    expect(brokenRows.size, "broken file must have error rows").toBeGreaterThan(0);
    expect(brokenRows.size, "broken has more error rows than clean").toBeGreaterThan(cleanRows.size);
  });

  it("Kotlin: adding bad destructured lambda grows errorRows.size", async () => {
    const clean = "package com.example\nfun ok() = 1\n";
    const r = await ktParser("kotlin");
    if (!r.ok) throw new Error(`kotlin parser failed: ${r.reason}`);

    const treeClean = r.parser.parse(clean)!;
    const treeBroke = r.parser.parse(KT_SNIPPET)!;

    const cleanRows = collectErrorRows(treeClean.rootNode, "kotlin");
    const brokenRows = collectErrorRows(treeBroke.rootNode, "kotlin");

    expect(brokenRows.size).toBeGreaterThan(0);
    expect(brokenRows.size).toBeGreaterThan(cleanRows.size);
  });
});
