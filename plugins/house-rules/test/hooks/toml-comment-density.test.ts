/**
 * TOML comment-density autofix safety.
 *
 * Covers:
 *   fixEntryFor("toml").stability === "stable"
 *   `#:schema <url>` (taplo / Even Better TOML) never stripped, on line 1 or later;
 *     plain `# schema ...` prose is still strippable
 *   `#` inside basic/literal strings and multi-line strings is data, never touched
 *   trailing `key = value # note` loses the comment with no trailing whitespace
 *   comments interleaved in multi-line arrays and before [table] / [[array]] headers
 *   post-strip output parses (Bun.TOML.parse) to the same data as the input
 *
 * Directive decisions: only `#:schema` is a real TOML directive. `# taplo: ...`
 * and rustfmt-style markers are not TOML syntax, so they stay strippable.
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";

function removableBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `# prose comment ${i} that is removable`).join("\n");
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

async function fix(text: string, rows: Set<number> = allRows(text)): Promise<string> {
  const r = await autoFix(text, "toml", rows);
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

function sameData(a: string, b: string): void {
  expect(JSON.stringify(Bun.TOML.parse(a))).toBe(JSON.stringify(Bun.TOML.parse(b)));
}

const HAZARDS = [
  "[hazards]",
  'basic = "a # not a comment"',
  "literal = 'b # not a comment either'",
  'ml_basic = """',
  "# looks like a comment",
  "line two # still text",
  '"""',
  "ml_literal = '''",
  "# also text",
  "  # indented text",
  "'''",
  "trailing = 1 # strip me",
  'trailing_str = "x" # strip me too',
  "list = [",
  "  # interleaved before the first item",
  "  1, # after one",
  "  # between items",
  "  2,",
  "  # after the last item",
  "]",
  "# comment before a table header",
  "[hazards.sub]",
  'k = "v"',
  "# comment before an array-of-tables header",
  "[[hazards.arr]]",
  "n = 1",
  "[[hazards.arr]]",
  "n = 2",
].join("\n");

const STRING_DATA_LINES = [
  'basic = "a # not a comment"',
  "literal = 'b # not a comment either'",
  "# looks like a comment",
  "line two # still text",
  "# also text",
  "  # indented text",
];

describe("fixEntryFor(toml) is stable", () => {
  it("stability === stable", () => {
    expect(fixEntryFor("toml").stability).toBe("stable");
  });
});

describe("toml hazards: over-budget file with string-embedded # and array/header comments", () => {
  const src = `${HAZARDS}\n\n${removableBlock(40)}\n`;

  it("over-budget prose is stripped", async () => {
    const out = await fix(src);
    expect(out).not.toContain("# prose comment 0 that is removable");
    expect(out).not.toContain("# prose comment 39 that is removable");
  });

  it("# inside basic, literal, multi-line strings survives byte-identical", async () => {
    const out = await fix(src);
    for (const line of STRING_DATA_LINES) expect(out.split("\n")).toContain(line);
  });

  it("output parses to the same data as the input", async () => {
    const out = await fix(src);
    sameData(out, src);
    expect(Bun.TOML.parse(out)).toEqual(Bun.TOML.parse(src));
  });

  it("no line gains or keeps trailing whitespace after a trailing comment is stripped", async () => {
    const out = await fix(src);
    for (const l of out.split("\n")) expect(l).toBe(l.trimEnd());
    const lines = out.split("\n");
    const one = lines.find((l) => l.startsWith("trailing = 1"));
    const two = lines.find((l) => l.startsWith("trailing_str = "));
    expect(["trailing = 1", "trailing = 1 # strip me"]).toContain(one!);
    expect(['trailing_str = "x"', 'trailing_str = "x" # strip me too']).toContain(two!);
    expect(out.includes("strip me too") && out.includes("1 # strip me")).toBe(false);
  });

  it("table / array-of-table headers and array items survive", async () => {
    const out = await fix(src);
    const lines = out.split("\n");
    for (const h of ["[hazards]", "[hazards.sub]", "[[hazards.arr]]"]) expect(lines).toContain(h);
    expect(lines).toContain("  1,");
    expect(lines).toContain("  2,");
    expect(lines).toContain("]");
  });
});

describe("toml: string-embedded # are never reported as comments", () => {
  it("findComments sees none of the in-string # lines", async () => {
    const r = await findComments(HAZARDS, "toml");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const texts = r.comments.map((c) => c.text);
    for (const t of texts) {
      expect(t).not.toContain("not a comment");
      expect(t).not.toContain("looks like a comment");
      expect(t).not.toContain("still text");
      expect(t).not.toContain("also text");
      expect(t).not.toContain("indented text");
    }
  });
});

describe("toml #:schema directive", () => {
  const SCHEMA = "#:schema https://json.schemastore.org/pyproject.json";
  const LATE = "#:schema https://example.com/late.json";

  it("line-1 #:schema survives an over-budget strip", async () => {
    const src = `${SCHEMA}\n[a]\nk = 1\n\n${removableBlock(40)}\n`;
    const out = await fix(src);
    expect(out.split("\n")[0]).toBe(SCHEMA);
    expect(out).not.toContain("prose comment 0 that");
    sameData(out, src);
  });

  it("#:schema not on line 1 survives an over-budget strip", async () => {
    const src = `[a]\nk = 1\n\n${LATE}\n[b]\nj = 2\n\n${removableBlock(40)}\n`;
    const out = await fix(src);
    expect(out.split("\n")).toContain(LATE);
    expect(out).not.toContain("prose comment 0 that");
    sameData(out, src);
  });

  it("plain '# schema' prose is still stripped", async () => {
    const PLAIN = "# schema notes for the table below";
    const src = `[a]\nk = 1\n\n${PLAIN}\n[b]\nj = 2\n\n${removableBlock(40)}\n`;
    const out = await fix(src);
    expect(out).not.toContain(PLAIN);
    sameData(out, src);
  });

  it("'# taplo:' prose is not a directive and is stripped", async () => {
    const NOTE = "# taplo: format the next table by hand";
    const src = `[a]\nk = 1\n\n${NOTE}\n[b]\nj = 2\n\n${removableBlock(40)}\n`;
    const out = await fix(src);
    expect(out).not.toContain(NOTE);
    sameData(out, src);
  });
});

describe("toml Edit payload: only addedRows are stripped", () => {
  it("existing comment kept, added comment removed", async () => {
    const EXISTING = "# existing prose before edit";
    const ADDED = "# added prose that is removable";
    const src = `[a]\nk = 1\n\n${EXISTING}\n\n${removableBlock(29)}\n${ADDED}\n`;
    const idx = src.split("\n").findIndex((l) => l === ADDED);
    const out = await fix(src, new Set([idx]));
    expect(out).not.toContain(ADDED);
    expect(out).toContain(EXISTING);
    sameData(out, src);
  });
});
