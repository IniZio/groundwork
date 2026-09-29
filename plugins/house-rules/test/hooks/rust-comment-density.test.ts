/**
 * Rust comment-density rule/autofix-level tests.
 *
 * Covers:
 *   fixEntryFor("rust").stability === "stable"
 *   Per-edit guard strips over-budget prose comments (Write + Edit payloads)
 *   Never stripped: /// //! /** /*! doc comments, SAFETY:, @generated
 *   //// and /*** are ordinary comments (not exempt)
 *   Strings, raw strings, char literals, lifetimes are not comments
 *   Nested block comments are one node and strip cleanly
 *   Under-budget rust unchanged; gate fix path
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";

function removableBlock(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `// prose comment ${i} that is removable`,
  ).join("\n");
}

async function runFix(text: string, addedRows: Set<number>) {
  return autoFix(text, "rust", addedRows);
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

async function fixed(src: string): Promise<string> {
  const r = await runFix(src, allRows(src));
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

async function comments(src: string) {
  const r = await findComments(src, "rust");
  if (!r.ok) throw new Error(r.reason);
  return r.comments;
}

describe("fixEntryFor(rust) is stable", () => {
  it("stability === stable", () => {
    expect(fixEntryFor("rust").stability).toBe("stable");
  });
});

describe("per-edit guard: Write payload removes over-budget prose comments", () => {
  const CODE_LINE = "fn main() {}";
  const src = `${CODE_LINE}\n\n${removableBlock(30)}\n`;

  it("code line survives autoFix", async () => {
    expect(await fixed(src)).toContain(CODE_LINE);
  });

  it("over-budget prose comment is removed", async () => {
    expect(await fixed(src)).not.toContain("removable");
  });
});

describe("per-edit guard: Edit payload only strips comments in addedRows", () => {
  const EXISTING = "// existing prose before edit";
  const ADDED = "// added prose that is removable";
  const src = `${EXISTING}\nfn main() {}\n\n${removableBlock(29)}\n${ADDED}\n`;

  it("added prose removed; comment outside addedRows survives", async () => {
    const lines = src.split("\n");
    const addedIdx = lines.findIndex((l) => l === ADDED);
    expect(addedIdx).toBeGreaterThanOrEqual(0);
    const r = await runFix(src, new Set([addedIdx]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(ADDED);
    expect(r.fixed).toContain(EXISTING);
    expect(r.fixed).toContain("// prose comment 0 that is removable");
  });
});

describe("doc comments are exempt and survive", () => {
  const cases: Array<[string, string, string]> = [
    ["///", "/// outer doc marker", "/// outer doc marker\nfn a() {}"],
    ["//!", "//! inner doc marker", "//! inner doc marker\nfn a() {}"],
    [
      "/** */",
      "outer block doc marker",
      "/** outer block doc marker */\nfn a() {}",
    ],
    [
      "/*! */",
      "inner block doc marker",
      "/*! inner block doc marker */\nfn a() {}",
    ],
  ];

  for (const [label, needle, head] of cases) {
    const src = `${head}\n\n${removableBlock(30)}\n`;

    it(`${label} is exempt in findComments`, async () => {
      const c = (await comments(src)).find((x) => x.text.includes(needle));
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
    });

    it(`${label} survives autoFix`, async () => {
      const out = await fixed(src);
      expect(out).toContain(needle);
      expect(out).not.toContain("removable");
    });
  }
});

describe("//// and /*** are not doc comments", () => {
  const src = `//// four slash banner\n/*** triple star banner */\nfn a() {}\n\n${removableBlock(30)}\n`;

  it("are not exempt", async () => {
    const cs = await comments(src);
    const four = cs.find((x) => x.text.includes("four slash banner"));
    const star = cs.find((x) => x.text.includes("triple star banner"));
    expect(four).toBeDefined();
    expect(star).toBeDefined();
    expect(four!.exempt).toBe(false);
    expect(star!.exempt).toBe(false);
  });

  it("are stripped by autoFix", async () => {
    const out = await fixed(src);
    expect(out).not.toContain("four slash banner");
    expect(out).not.toContain("triple star banner");
    expect(out).toContain("fn a() {}");
  });
});

describe("tool markers are never stripped", () => {
  const SAFETY = "// SAFETY: pointer is valid for the whole call";
  const GENERATED = "// @generated";

  it("SAFETY above unsafe is exempt and survives", async () => {
    const src = `fn a(p: *const u8) -> u8 {\n    ${SAFETY}\n    unsafe { *p }\n}\n\n${removableBlock(30)}\n`;
    const c = (await comments(src)).find((x) => x.text === SAFETY);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    const out = await fixed(src);
    expect(out).toContain(SAFETY);
    expect(out).not.toContain("removable");
  });

  it("@generated is exempt and survives", async () => {
    const src = `${GENERATED}\nfn a() {}\n\n${removableBlock(30)}\n`;
    const c = (await comments(src)).find((x) => x.text === GENERATED);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    const out = await fixed(src);
    expect(out).toContain(GENERATED);
    expect(out).not.toContain("removable");
  });
});

describe("string-ish literals are not comments", () => {
  const lines = [
    'let a = r#"// not a comment"#;',
    'let b = "http://x // y";',
    'let c = "/* z */";',
    "let d = '/';",
    "fn e<'a>(x: &'a str) -> &'a str { x }",
  ];
  const src = `${lines.join("\n")}\n\n${removableBlock(30)}\n`;

  it("none are reported as comments", async () => {
    const cs = await comments(src);
    for (const needle of ["not a comment", "// y", "/* z */"]) {
      expect(cs.find((x) => x.text.includes(needle))).toBeUndefined();
    }
    expect(cs.length).toBe(30);
  });

  it("lines are byte-identical after autoFix", async () => {
    const out = await fixed(src);
    for (const l of lines) expect(out).toContain(l);
    expect(out).not.toContain("removable");
  });
});

describe("nested block comments", () => {
  const NESTED = "/* a /* b */ c */";
  const src = `fn a() {}\n${NESTED}\n\n${removableBlock(30)}\n`;

  it("is found as one comment", async () => {
    const cs = await comments(src);
    const hits = cs.filter((x) => x.text.includes("/* a"));
    expect(hits.length).toBe(1);
    expect(hits[0].text).toBe(NESTED);
    expect(cs.length).toBe(31);
  });

  it("strips cleanly with no dangling */ and still parses", async () => {
    const out = await fixed(src);
    expect(out).toContain("fn a() {}");
    expect(out).not.toContain("*/");
    expect(out).not.toContain("/*");
    const r = await findComments(out, "rust");
    expect(r.ok).toBe(true);
  });
});

describe("under-budget rust — passes through unchanged", () => {
  const fns = Array.from(
    { length: 45 },
    (_, i) => `fn f${i}() -> i32 { ${i} }`,
  ).join("\n");
  const src = `// a brief note\n${fns}\n`;

  it("fixed equals original", async () => {
    const r = await runFix(src, allRows(src));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toBe(src);
  });
});

describe("gate fix path: .rs file is processed by autoFix", () => {
  const src = `fn main() {}\n\n${removableBlock(40)}\n`;

  it("autoFix reduces non-exempt comment count", async () => {
    const before = (await comments(src)).filter((c) => !c.exempt).length;
    const out = await fixed(src);
    const after = (await comments(out)).filter((c) => !c.exempt).length;
    expect(before).toBe(40);
    expect(after).toBeLessThan(before);
  });
});
