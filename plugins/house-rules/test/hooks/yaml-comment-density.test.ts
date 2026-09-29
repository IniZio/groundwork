/**
 * YAML comment-density autofix safety tests.
 *
 * Post-strip output must parse (Bun.YAML) to the same data as the input,
 * with no trailing whitespace left behind, and `#` that is not a comment
 * (quoted strings, plain scalars, block scalar bodies) must survive.
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";
import { YAML_TOOL_MARKERS } from "../../src/hooks/languages/tool-markers.js";

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

function filler(n: number): string {
  return Array.from({ length: n }, (_, i) => `# removable prose ${i}`).join("\n");
}

async function fix(text: string): Promise<string> {
  const r = await autoFix(text, "yaml", allRows(text));
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

function sameData(a: string, b: string): void {
  expect(Bun.YAML.parse(b)).toEqual(Bun.YAML.parse(a));
}

function noTrailingWs(text: string): void {
  const bad = text.split("\n").filter((l) => /[ \t]+$/.test(l));
  expect(bad).toEqual([]);
}

describe("fixEntryFor(yaml)", () => {
  it("is stable", () => {
    expect(fixEntryFor("yaml").stability).toBe("stable");
  });
});

describe("hazard: trailing `key: value # comment`", () => {
  const src = [
    "name: ci # trailing prose one",
    "on:",
    "  push:",
    "    branches: [main]   # padded trailing two",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest # trailing three",
    filler(20),
    "",
  ].join("\n");

  it("comments stripped, no trailing whitespace, data identical", async () => {
    const out = await fix(src);
    expect(out).not.toContain("trailing prose one");
    expect(out).not.toContain("padded trailing two");
    expect(out).not.toContain("trailing three");
    expect(out).toContain("name: ci\n");
    expect(out).toContain("    branches: [main]\n");
    expect(out).toContain("    runs-on: ubuntu-latest\n");
    noTrailingWs(out);
    sameData(src, out);
  });
});

describe("hazard: `#` that is not a comment", () => {
  const KEEP = [
    'URL: "http://x.example/#frag # not comment"',
    "SQ: 'issue #42 stays'",
    "PLAIN: build#7",
  ];
  const src = [...KEEP, "other: 1 # prose to strip", filler(20), ""].join("\n");

  it("quoted and plain-scalar hashes survive byte-identical", async () => {
    const out = await fix(src);
    for (const l of KEEP) expect(out.split("\n")).toContain(l);
    expect(out).not.toContain("prose to strip");
    noTrailingWs(out);
    sameData(src, out);
  });
});

describe("hazard: block scalar bodies", () => {
  const BODY = [
    "  script: |",
    "    #!/bin/sh",
    "    # hash line inside literal block",
    '    echo "# still text"',
    "  folded: >",
    "    text with # hash",
    "    # another body line",
  ];
  const src = ["jobs:", ...BODY, "  # prose between keys", "  after: v", filler(20), ""].join("\n");

  it("`#` lines inside | and > bodies are data, not stripped", async () => {
    const out = await fix(src);
    for (const l of BODY) expect(out.split("\n")).toContain(l);
    expect(out).not.toContain("prose between keys");
    sameData(src, out);
    expect((Bun.YAML.parse(out) as any).jobs.script).toContain("# hash line inside literal block");
  });
});

describe("hazard: multi-document and whole-line indented comments", () => {
  const src = [
    "# first doc prose",
    "a: 1",
    "---",
    "# second doc prose",
    "b:",
    "  # indented prose one",
    "  c: 2",
    "  # indented prose two",
    "  d:",
    "    # deeper prose",
    "    - x",
    "---",
    "e: 3 # third doc trailing",
    filler(20),
    "",
  ].join("\n");

  it("`---` separators kept, comments gone, docs parse identically", async () => {
    const out = await fix(src);
    expect(out.split("\n").filter((l) => l === "---")).toHaveLength(2);
    for (const gone of ["first doc prose", "second doc prose", "indented prose", "deeper prose", "third doc trailing"]) {
      expect(out).not.toContain(gone);
    }
    noTrailingWs(out);
    const before = Bun.YAML.parse(src) as unknown[];
    expect(before).toHaveLength(3);
    sameData(src, out);
  });
});

describe("directives are never stripped", () => {
  const DIRECTIVES = [
    "# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json",
    "# yamllint disable rule:line-length",
    "# yamllint disable-line rule:truthy",
    "# yamllint enable",
    "# prettier-ignore",
  ];
  const src = [
    DIRECTIVES[0],
    DIRECTIVES[1],
    "a: 1 # prose alpha",
    DIRECTIVES[2],
    "b: 2",
    DIRECTIVES[3],
    "c: [ 1,  2 ] " + "# renovate: datasource=docker depName=nexus-probe",
    DIRECTIVES[4],
    "d:   [ 3 ]",
    "# prose beta",
    filler(20),
    "",
  ].join("\n");

  it("markers survive; prose removed; identity, not count", async () => {
    const out = await fix(src);
    const lines = out.split("\n");
    for (const d of DIRECTIVES) expect(lines).toContain(d);
    expect(out).toContain("# renovate: datasource=docker depName=nexus-probe");
    expect(out).not.toContain("prose alpha");
    expect(out).not.toContain("prose beta");
    expect(out).not.toContain("removable prose");
    sameData(src, out);
  });

  it("findComments marks each directive exempt", async () => {
    const r = await findComments(src, "yaml");
    if (!r.ok) throw new Error(r.reason);
    const exempt = r.comments.filter((c) => c.exempt).map((c) => c.text.trim());
    for (const d of DIRECTIVES) expect(exempt).toContain(d);
    expect(exempt.some((t) => t.startsWith("# renovate:"))).toBe(true);
    expect(r.comments.find((c) => c.text.includes("prose alpha"))?.exempt).toBe(false);
  });

  it("marker regexes reject look-alike prose", () => {
    const hit = (s: string) => YAML_TOOL_MARKERS.some((re) => re.test(s));
    expect(hit("yamllint disable rule:x")).toBe(true);
    expect(hit("prettier-ignore")).toBe(true);
    expect(hit("renovate: datasource=npm")).toBe(true);
    expect(hit("we use yamllint in CI")).toBe(false);
    expect(hit("renovate handles this")).toBe(false);
    expect(hit("dependabot updates these")).toBe(false);
  });
});

describe("under budget passes through unchanged", () => {
  const src = [
    ...Array.from({ length: 40 }, (_, i) => `key_${i}: ${i}`),
    "# one short note",
    "",
  ].join("\n");

  it("fixed equals original", async () => {
    expect(await fix(src)).toBe(src);
  });
});
