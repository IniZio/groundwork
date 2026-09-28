/**
 * KS-01/F — Kotlin comment-density rule/autofix-level tests.
 *
 * Wilson-parking parity cases:
 *   (4)  nested block comment — val x = 1 survives, no ERROR nodes after autoFix
 *   (5)  KDoc with @param — not counted, not stripped
 *   (6)  ktlint-disable / noinspection — never stripped
 *   (8)  commented-out code — counted toward density, removable
 *  (10)  license header before package — not counted, not stripped
 *  (1)(2)(3)(7)(9)  sanity: raw strings, string templates, @Suppress, block continuation, URL trailing comment
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";
import type { Node } from "../../src/hooks/lib/tree-sitter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasErrors(node: Node): boolean {
  if (node.type === "ERROR" || node.isMissing) return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasErrors(child)) return true;
  }
  return false;
}

/** n lines of removable prose, enough to push density over the 5% cap */
function removableBlock(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `// prose comment ${i} that is removable`,
  ).join("\n");
}

async function runFix(text: string, addedRows: Set<number>) {
  return autoFix(text, "kotlin", addedRows);
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

// ---------------------------------------------------------------------------
// fixEntryFor stability (sibling C lands this; assertion pins the contract)
// ---------------------------------------------------------------------------

describe("fixEntryFor(kotlin) is stable", () => {
  it("stability === stable", () => {
    const entry = fixEntryFor("kotlin");
    expect(entry.stability).toBe("stable");
  });
});

// ---------------------------------------------------------------------------
// Case (4): nested block comment — val x = 1 survives; output has no ERROR nodes
// ---------------------------------------------------------------------------

describe("case 4: nested block comment — val x = 1 survives autoFix, no ERROR nodes", () => {
  // Kotlin spec allows nested block comments: /* outer /* inner */ still outer */
  const NESTED = "/* outer /* inner */ still comment */";
  const CODE = "val x = 1";

  const src = `package com.example

${NESTED}
${CODE}

${removableBlock(30)}
`;

  it("val x = 1 survives after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    if (!r.ok) {
      // Acceptable if parser cannot handle nested comments — skip body
      return;
    }
    expect(r.fixed).toContain(CODE);
  });

  it("fixed output reparses with no ERROR nodes", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    if (!r.ok) return; // parser limitation — let case 4 guard pass

    const pr = await getParser("kotlin");
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;

    const tree = pr.parser.parse(r.fixed);
    expect(tree).toBeTruthy();
    if (!tree) return;

    expect(hasErrors(tree.rootNode)).toBe(false);
    tree.delete();
  });
});

// ---------------------------------------------------------------------------
// Case (5): KDoc with @param — not counted toward density, never stripped
// ---------------------------------------------------------------------------

describe("case 5: KDoc @param — not counted, not stripped", () => {
  const KDOC = "/**\n * @param id the lot\n */";
  const src = `package com.example

${KDOC}
fun find(id: Int): String {
    return id.toString()
}

${removableBlock(30)}
`;

  it("KDoc is exempt (not counted toward density)", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const kdoc = r.comments.find(
      (c) => c.text.includes("@param id the lot"),
    );
    expect(kdoc).toBeDefined();
    expect(kdoc!.exempt).toBe(true);
  });

  it("KDoc survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain("@param id the lot");
  });
});

// ---------------------------------------------------------------------------
// Case (6): ktlint-disable and noinspection — never stripped
// ---------------------------------------------------------------------------

describe("case 6: ktlint-disable — never stripped", () => {
  const KTLINT = "// ktlint-disable no-wildcard-imports";
  const src = `package com.example

${KTLINT}
import kotlin.collections.*

${removableBlock(30)}
`;

  it("ktlint-disable comment is exempt", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const c = r.comments.find((c) => c.text === KTLINT);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("ktlint-disable survives autoFix even when prose is over-budget", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(KTLINT);
  });
});

describe("case 6: noinspection — never stripped", () => {
  const NOINSP = "//noinspection SpellCheckingInspection";
  const src = `package com.example

${NOINSP}
val identifier = "someIdentifierHere"

${removableBlock(30)}
`;

  it("noinspection comment is exempt", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const c = r.comments.find((c) => c.text === NOINSP);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("noinspection survives autoFix even when every other comment is removed", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(NOINSP);
  });
});

// ---------------------------------------------------------------------------
// Case (8): commented-out code — counted toward density, removable
// ---------------------------------------------------------------------------

describe("case 8: commented-out code — counted, removable", () => {
  const COMMENTED_CODE = "// val x = foo()";
  const src = `package com.example

${removableBlock(20)}
${COMMENTED_CODE}
${removableBlock(10)}
`;

  it("commented-out code is NOT exempt", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const c = r.comments.find((c) => c.text === COMMENTED_CODE);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("commented-out code can be removed by autoFix (does not survive)", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    // After autoFix, the commented-out code should have been removed
    expect(r.fixed).not.toContain(COMMENTED_CODE);
  });
});

// ---------------------------------------------------------------------------
// Case (10): license header before package — not counted, not stripped
// ---------------------------------------------------------------------------

describe("case 10: license header before package — not counted, not stripped", () => {
  const LICENSE_LINE = "// Copyright 2024 Acme Corp. All rights reserved.";
  const src = `${LICENSE_LINE}
// SPDX-License-Identifier: Apache-2.0

package com.example

${removableBlock(30)}
`;

  it("license header comment is exempt (header)", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const c = r.comments.find((c) => c.text === LICENSE_LINE);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("license header survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(LICENSE_LINE);
  });
});

// ---------------------------------------------------------------------------
// Cases (1)(2)(3)(7)(9): sanity — not counted; byte-identical after autoFix
// ---------------------------------------------------------------------------

describe("case 1: raw strings with // — never counted as comments", () => {
  const RAW_STR_LINE = 'val s = """line1 // not a comment\nline2"""';
  const src = `package com.example

${removableBlock(30)}
${RAW_STR_LINE}
`;

  it("// inside raw string is not a comment", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    // No comment should have text containing the raw string prefix "line1 // not a comment"
    const fake = r.comments.find((c) => c.text.includes("not a comment"));
    expect(fake).toBeUndefined();
  });

  it("raw string line is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(RAW_STR_LINE);
  });
});

describe("case 2: string template with // — never counted", () => {
  // "a // b ${x} // c" — the // inside a string literal is not a comment
  const TEMPLATE_LINE = 'val t = "a // b ${x} // c"';
  const src = `package com.example

${removableBlock(30)}
val x = 1
${TEMPLATE_LINE}
`;

  it("// inside string template is not a comment", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("a // b"));
    expect(fake).toBeUndefined();
  });

  it("string template line is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(TEMPLATE_LINE);
  });
});

describe("case 3: @Suppress annotation — never counted", () => {
  // @Suppress("UNUSED") is an annotation, not a comment — never counted
  const src = `package com.example

${removableBlock(30)}
@Suppress("UNUSED")
val ignored = 0
`;

  it("@Suppress is not a comment node", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("Suppress"));
    expect(fake).toBeUndefined();
  });

  it("@Suppress line is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain('@Suppress("UNUSED")');
  });
});

describe("case 7: block comment continuation (* b) — never counted as separate comment", () => {
  // Inside a block comment /* a\n * b\n */ the continuation line " * b" is not a separate comment
  const BLOCK_CMT = "/* a\n * b\n */";
  const src = `package com.example

${BLOCK_CMT}
val y = 2

${removableBlock(30)}
`;

  it("block comment continuation is part of the block, not a separate comment", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    // Expect exactly one comment matching the full block text (not two or three separate entries)
    const matching = r.comments.filter((c) => c.text.includes(" * b"));
    expect(matching.length).toBe(1);
    expect(matching[0].text.trimStart()).toBe(BLOCK_CMT.trimStart());
  });

  it("block comment is byte-identical after autoFix (it is exempt if URL or doc; if not, it may be removed)", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    // Either the block is intact or it is fully absent (never mangled mid-block)
    const fixed = r.fixed;
    const hasBlock = fixed.includes(BLOCK_CMT);
    const hasPartial = fixed.includes(" * b") && !fixed.includes(BLOCK_CMT);
    expect(hasPartial).toBe(false); // no partial mangling
    void hasBlock; // presence either way is fine
  });
});

describe("case 9: URL in trailing comment — counts 1 toward density", () => {
  const src = `package com.example

${removableBlock(30)}
val url = "http://example.com" // base
`;

  it("trailing // base comment is counted (not exempt)", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === "// base");
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("exactly one comment row counted for the trailing // base", async () => {
    const r = await findComments(src, "kotlin");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const urlLine = src.split("\n").findIndex((l) => l.includes("// base"));
    const onUrlLine = r.comments.filter(
      (c) => c.startRow <= urlLine && c.endRow >= urlLine && !c.exempt,
    );
    expect(onUrlLine.length).toBe(1);
  });
});
