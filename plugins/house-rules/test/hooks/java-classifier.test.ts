import { describe, it, expect, afterAll } from "bun:test";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { findComments, stripComments } from "../../src/hooks/lib/comment-density.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { languageForPath } from "../../src/hooks/languages/registry.js";

describe("languageForPath — java", () => {
  it("Foo.java → java", () => {
    expect(languageForPath("Foo.java")).toBe("java");
  });
  it("src/main/java/a/B.java → java", () => {
    expect(languageForPath("src/main/java/a/B.java")).toBe("java");
  });
});

const sf = createSourceFiles(getParser);
afterAll(() => sf.dispose());

async function classify(text: string, filePath = "X.java") {
  const r = await sf.get("java", text, filePath);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.source.comments;
}

async function comments(text: string, filePath = "X.java") {
  return findComments(text, "java", parserForPath(getParser, filePath));
}

// ---- a: languageForPath (already above) ----

// ---- b: Javadoc → kind doc, exempt true ----

describe("case b — Javadoc → kind doc + exempt", () => {
  it("/** Doc. */ before method → kind doc", async () => {
    const text = `class A {\n  /** Doc. */\n  void m() {}\n}\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text.startsWith("/**"));
    expect(c).toBeDefined();
    expect(c!.kind).toBe("doc");
  });

  it("/** Doc. */ before method → findComments exempt true", async () => {
    const text = `class A {\n  /** Doc. */\n  void m() {}\n}\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(x => x.text.startsWith("/**"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("multi-line class Javadoc → kind doc", async () => {
    const text = `/**\n * A class.\n * @author me\n */\nclass A {}\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text.startsWith("/**"));
    expect(c).toBeDefined();
    expect(c!.kind).toBe("doc");
  });
});

// ---- c: ordinary comments inside class body ----

describe("case c — plain comments inside class body → not doc/directive/header", () => {
  const src = `package a;\nclass A {\n  // plain\n  /* block */\n  void m() {}\n}\n`;

  it("// plain → kind not doc, directive false, header false", async () => {
    const cs = await classify(src);
    const c = cs.find(x => x.text === "// plain");
    expect(c).toBeDefined();
    expect(c!.kind).not.toBe("doc");
    expect(c!.directive).toBe(false);
    expect(c!.header).toBe(false);
  });

  it("/* block */ → kind not doc, directive false, header false", async () => {
    const cs = await classify(src);
    const c = cs.find(x => x.text === "/* block */");
    expect(c).toBeDefined();
    expect(c!.kind).not.toBe("doc");
    expect(c!.directive).toBe(false);
    expect(c!.header).toBe(false);
  });

  it("// plain → findComments exempt false", async () => {
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(x => x.text === "// plain");
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("/* block */ → findComments exempt false", async () => {
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(x => x.text === "/* block */");
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

// ---- d: header classification ----

describe("case d — header classification", () => {
  it("license block before package → header true and exempt true", async () => {
    const src = `/*\n * Licensed under Apache 2.0\n */\npackage a;\nclass A {}\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text.startsWith("/*"));
    expect(c).toBeDefined();
    expect(c!.header).toBe(true);
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fc = r.comments.find(x => x.text.startsWith("/*"));
    expect(fc).toBeDefined();
    expect(fc!.exempt).toBe(true);
  });

  it("comment after package → header false", async () => {
    const src = `package a;\n// after package\nclass A {}\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text === "// after package");
    expect(c).toBeDefined();
    expect(c!.header).toBe(false);
  });

  it("no-package file: // hdr before import → header true", async () => {
    const src = `// hdr\nimport java.util.List;\nclass A {}\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text === "// hdr");
    expect(c).toBeDefined();
    expect(c!.header).toBe(true);
  });

  it("package-info style: /* lic */ before @Deprecated package → header true", async () => {
    const src = `/* lic */\n@Deprecated\npackage a;\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text === "/* lic */");
    expect(c).toBeDefined();
    expect(c!.header).toBe(true);
  });

  it("comment-only file → header false", async () => {
    const src = `// standalone\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text === "// standalone");
    expect(c).toBeDefined();
    expect(c!.header).toBe(false);
  });

  it("trailing comment on same line as package → header false", async () => {
    const src = `package a; // trailing\nclass A {}\n`;
    const cs = await classify(src);
    const c = cs.find(x => x.text === "// trailing");
    expect(c).toBeDefined();
    expect(c!.header).toBe(false);
  });
});

// ---- e: tool markers ----

type MarkerCase = { title: string; src: string; marker: string };

function markerSrc(marker: string): string {
  return `class A {\n  void m() {\n    ${marker}\n  }\n}\n`;
}

function markerSrcTrailing(stmt: string, marker: string): string {
  return `class A {\n  void m() {\n    ${stmt} ${marker}\n  }\n}\n`;
}

const MARKER_CASES: MarkerCase[] = [
  { title: "NOSONAR bare", src: markerSrc("// NOSONAR"), marker: "// NOSONAR" },
  { title: "NOSONAR with rule", src: markerSrc("// NOSONAR squid:S106"), marker: "// NOSONAR squid:S106" },
  { title: "NOSONAR trailing after stmt", src: markerSrcTrailing("System.out.println(x);", "// NOSONAR"), marker: "// NOSONAR" },
  { title: "NOPMD with reason", src: markerSrc("// NOPMD - reason"), marker: "// NOPMD - reason" },
  { title: "CHECKSTYLE:OFF", src: markerSrc("// CHECKSTYLE:OFF"), marker: "// CHECKSTYLE:OFF" },
  { title: "CHECKSTYLE:ON", src: markerSrc("// CHECKSTYLE:ON"), marker: "// CHECKSTYLE:ON" },
  { title: "CHECKSTYLE.OFF: MagicNumber", src: markerSrc("// CHECKSTYLE.OFF: MagicNumber"), marker: "// CHECKSTYLE.OFF: MagicNumber" },
  { title: "CHECKSTYLE.ON: MagicNumber", src: markerSrc("// CHECKSTYLE.ON: MagicNumber"), marker: "// CHECKSTYLE.ON: MagicNumber" },
  { title: "CHECKSTYLE:OFF block form", src: `class A {\n  /* CHECKSTYLE:OFF */\n  void m() {}\n}\n`, marker: "/* CHECKSTYLE:OFF */" },
  { title: "@formatter:off", src: markerSrc("// @formatter:off"), marker: "// @formatter:off" },
  { title: "@formatter:on", src: markerSrc("// @formatter:on"), marker: "// @formatter:on" },
  { title: "noinspection unchecked", src: markerSrc("//noinspection unchecked"), marker: "//noinspection unchecked" },
  { title: "$NON-NLS-1$", src: markerSrcTrailing(`String s = "a";`, `// $NON-NLS-1$`), marker: "// $NON-NLS-1$" },
  { title: "spotless:off", src: markerSrc("// spotless:off"), marker: "// spotless:off" },
  { title: "spotless:on", src: markerSrc("// spotless:on"), marker: "// spotless:on" },
  { title: "CPD-OFF", src: markerSrc("// CPD-OFF"), marker: "// CPD-OFF" },
  { title: "CPD-ON", src: markerSrc("// CPD-ON"), marker: "// CPD-ON" },
  { title: "deepcode ignore HardcodedPassword", src: markerSrc("// deepcode ignore HardcodedPassword: test"), marker: "// deepcode ignore HardcodedPassword: test" },
  { title: "file deepcode ignore HardcodedPassword", src: markerSrc("// file deepcode ignore HardcodedPassword: test"), marker: "// file deepcode ignore HardcodedPassword: test" },
  { title: "nosemgrep", src: markerSrc("// nosemgrep: java.lang.security.audit"), marker: "// nosemgrep: java.lang.security.audit" },
  { title: "fall through", src: `class A {\n  void m(int x) {\n    switch (x) { case 1: m(0); // fall through\n    case 2: m(1); }\n  }\n}\n`, marker: "// fall through" },
  { title: "falls through", src: `class A {\n  void m(int x) {\n    switch (x) { case 1: m(0); // falls through\n    case 2: m(1); }\n  }\n}\n`, marker: "// falls through" },
  { title: "fallthrough", src: `class A {\n  void m(int x) {\n    switch (x) { case 1: m(0); // fallthrough\n    case 2: m(1); }\n  }\n}\n`, marker: "// fallthrough" },
];

describe("case e — tool markers → directive true + exempt true + stripComments keeps marker", () => {
  for (const { title, src, marker } of MARKER_CASES) {
    it(`${title} — directive true`, async () => {
      const cs = await classify(src);
      const c = cs.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found in classified`).toBeDefined();
      expect(c!.directive).toBe(true);
    });

    it(`${title} — findComments exempt true`, async () => {
      const r = await comments(src);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.reason);
      const c = r.comments.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found`).toBeDefined();
      expect(c!.exempt).toBe(true);
    });

    it(`${title} — stripComments keeps marker, removes prose`, async () => {
      const prose = "// removable prose";
      const fullSrc = src + `class B {\n  void n() {\n    ${prose}\n  }\n}\n`;
      const r = await comments(fullSrc);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.reason);
      const nonExempt = r.comments.filter(c => !c.exempt);
      const { text: stripped } = stripComments(fullSrc, nonExempt);
      expect(stripped).toContain(marker);
      expect(stripped).not.toContain("removable prose");
    });
  }
});

// ---- f: negative controls ----

describe("case f — negative controls → directive false + exempt false", () => {
  const NEG: Array<{ title: string; src: string; marker: string }> = [
    { title: "NOSONARX → not directive", src: markerSrc("// NOSONARX"), marker: "// NOSONARX" },
    { title: "Checkstyle off (wrong case) → not directive", src: markerSrc("// Checkstyle off"), marker: "// Checkstyle off" },
    { title: "fall back to default → not directive", src: markerSrc("// fall back to default"), marker: "// fall back to default" },
    { title: "noqa (Python marker) → not directive", src: markerSrc("// noqa"), marker: "// noqa" },
  ];

  for (const { title, src, marker } of NEG) {
    it(`${title} — directive false`, async () => {
      const cs = await classify(src);
      const c = cs.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found`).toBeDefined();
      expect(c!.directive).toBe(false);
    });

    it(`${title} — findComments exempt false`, async () => {
      const r = await comments(src);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.reason);
      const c = r.comments.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found`).toBeDefined();
      expect(c!.exempt).toBe(false);
    });
  }
});

// ---- g: strings → 0 comments ----

describe("case g — string literals → 0 comments", () => {
  it('String s = "// not a comment" → 0 comments', async () => {
    const src = `class A {\n  void m() {\n    String s = "// not a comment";\n  }\n}\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });

  it("text block with embedded /* nope */ // nope → 0 comments", async () => {
    const src = `class A {\n  void m() {\n    String s = """\n      /* nope */ // nope\n      """;\n  }\n}\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });
});
