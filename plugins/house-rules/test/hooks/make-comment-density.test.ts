/**
 * Make comment-density autofix (stable).
 *
 * Over-budget plain `#` comments are stripped; never stripped: `# groundwork-rule:` lines
 * (read by the new-code gate), tab-prefixed recipe lines, `\#`, `define ... endef` bodies,
 * and `#` inside variable values or continuation lines.
 */
import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText, classifyComments } from "../../src/hooks/languages/parse.js";

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

const PROSE = Array.from({ length: 12 }, (_, i) => `# prose comment ${i} that is removable`);

async function fix(text: string) {
  const r = await autoFix(text, "make", allRows(text));
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

describe("fixEntryFor(make)", () => {
  it("is stable and safe", () => {
    expect(fixEntryFor("make")).toEqual({ stability: "stable", applicability: "safe" });
  });
});

describe("make autofix: over-budget plain comments", () => {
  const src = [
    "# groundwork-rule: no-console-log",
    "# groundwork-rule: no-ts-any",
    "CC = gcc",
    ...PROSE,
    "all: main.o",
    "\t$(CC) -o app main.o",
    "",
  ].join("\n");

  it("removes every prose line, keeps code and groundwork-rule lines byte-identical", async () => {
    const out = await fix(src);
    for (const p of PROSE) expect(out).not.toContain(p);
    expect(out.split("\n").filter((l) => l.startsWith("#"))).toEqual([
      "# groundwork-rule: no-console-log",
      "# groundwork-rule: no-ts-any",
    ]);
    expect(out).toContain("CC = gcc\n");
    expect(out).toContain("all: main.o\n\t$(CC) -o app main.o\n");
  });

  it("strips the same prose when the groundwork-rule line sits after it (order varied)", async () => {
    const reordered = ["CC = gcc", ...PROSE, "# groundwork-rule: no-ts-any", "all:", "\t@true", ""].join("\n");
    const out = await fix(reordered);
    for (const p of PROSE) expect(out).not.toContain(p);
    expect(out).toContain("# groundwork-rule: no-ts-any");
  });
});

describe("make autofix: hazards are never treated as strippable comments", () => {
  const RECIPE_COMMENT = "\t# recipe hash line handed to the shell";
  const RECIPE_TRAILING = "\t@echo hi # shell trailing hash";
  const ESCAPED = "HASH_CHAR = \\#";
  const DEFINE_LINES = [
    "define BUILD_STEP",
    "# body hash line inside define",
    "echo building $(1) # shell comment inside define",
    "endef",
  ];
  const TAB_HASH = "\t# tab-prefixed hash the grammar reports as a comment";
  const VALUE = 'HEADING = "## v1"';
  const CONT = ["SRCS = a.c \\", "  # continuation hash line", "  b.c"];

  const src = [
    "CC = gcc",
    ...PROSE,
    ESCAPED,
    VALUE,
    TAB_HASH,
    ...CONT,
    ...DEFINE_LINES,
    "all:",
    RECIPE_COMMENT,
    RECIPE_TRAILING,
    "",
  ].join("\n");

  it("prose removed while every hazard line survives byte-identical", async () => {
    const out = await fix(src);
    for (const p of PROSE) expect(out).not.toContain(p);
    for (const l of [ESCAPED, VALUE, TAB_HASH, ...CONT, ...DEFINE_LINES, RECIPE_COMMENT, RECIPE_TRAILING]) {
      expect(out.split("\n")).toContain(l);
    }
  });

  it("classifier marks grammar-reported define-body and tab-prefixed hash comments as directives", async () => {
    for (const [t, seen, label] of [
      [["C = a \\", "  # cont", "  b", "define X", "# body", "endef", ""].join("\n"), "# body", "make-define-body"],
      [["A = 1", "\t# tab-prefixed hash", "B = 2", ""].join("\n"), "# tab-prefixed hash", "make-recipe-line"],
    ] as const) {
      const r = await parseText(t, "make", getParser);
      if (!r.ok) throw new Error(r.reason);
      const hit = classifyComments(r.tree.rootNode, t, "make").find((c) => c.text === seen);
      expect(hit, `${seen} must be reported by the grammar`).toBeDefined();
      expect(hit!.directive).toBe(true);
      expect(hit!.label).toBe(label);
    }
  });

  it("under-budget file passes through unchanged", async () => {
    const small = ["# one note", ...Array.from({ length: 40 }, (_, i) => `V${i} = ${i}`), ""].join("\n");
    const r = await autoFix(small, "make", allRows(small));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.removed).toBe(0);
      expect(r.fixed).toBe(small);
    }
  });
});
