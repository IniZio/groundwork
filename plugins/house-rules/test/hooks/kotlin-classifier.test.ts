import { describe, it, expect, afterAll } from "bun:test";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { findComments } from "../../src/hooks/lib/comment-density.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { languageForPath } from "../../src/hooks/languages/registry.js";

// --- languageForPath ---

describe("languageForPath — kotlin", () => {
  it("a.kt → kotlin", () => {
    expect(languageForPath("a.kt")).toBe("kotlin");
  });
  it("build.gradle.kts → kotlin", () => {
    expect(languageForPath("build.gradle.kts")).toBe("kotlin");
  });
});

const sf = createSourceFiles(getParser);
afterAll(() => sf.dispose());

// ---- helpers ----

async function classify(text: string, filePath = "x.kt") {
  const r = await sf.get("kotlin", text, filePath);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.source.comments;
}

async function comments(text: string, filePath = "x.kt") {
  return findComments(text, "kotlin", parserForPath(getParser, filePath));
}

// ---- case 1: template strings containing // ----

describe("case 1 — // inside triple-quoted string → 0 comments", () => {
  it("single-line template literal", async () => {
    const text = `val t = """\n// not comment\n"""\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });

  it("multi-line string with body line containing //", async () => {
    const text = `val t = """\n    // inside\n"""\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });
});

// ---- case 2: string with interpolation containing // ----

describe("case 2 — // in interpolated string → 0 comments", () => {
  it("val s = \"a // b ${x} // c\" → 0 comments", async () => {
    const text = `val s = "a // b \${x} // c"\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });
});

// ---- case 3: trailing comment after string literal ----

describe("case 3 — trailing // after string → exactly 1 comment", () => {
  it('val url = "http://example.com" // base', async () => {
    const text = `val url = "http://example.com" // base\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]!.text).toBe("// base");
  });
});

// ---- case 4: nested block comment ----

describe("case 4 — nested block comment → 1 comment", () => {
  it("/* outer /* inner */ still comment */ val x = 1", async () => {
    const text = `/* outer /* inner */ still comment */ val x = 1\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]!.text).toBe("/* outer /* inner */ still comment */");
  });
});

// ---- case 5: KDoc before fun → kind doc ----

describe("case 5 — KDoc → kind doc", () => {
  it("/** ... */ before fun has kind doc", async () => {
    const text = `/**\n * Finds a lot.\n * @param id the lot\n */\nfun find(id: Int) {}\n`;
    const cs = await classify(text);
    const kdoc = cs.find(c => c.text.startsWith("/**"));
    expect(kdoc).toBeDefined();
    expect(kdoc!.kind).toBe("doc");
  });
});

// ---- case 6: KOTLIN_TOOL_MARKERS → directive true ----

describe("case 6 — tool markers → directive true", () => {
  it("// ktlint-disable no-wildcard-imports", async () => {
    const text = `// ktlint-disable no-wildcard-imports\nval x = 1\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "// ktlint-disable no-wildcard-imports");
    expect(c).toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("//noinspection SpellCheckingInspection", async () => {
    const text = `//noinspection SpellCheckingInspection\nval x = 1\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "//noinspection SpellCheckingInspection");
    expect(c).toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("// language=SQL", async () => {
    const text = `// language=SQL\nval q = "SELECT 1"\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "// language=SQL");
    expect(c).toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("// spotless:off", async () => {
    const text = `// spotless:off\nval x = 1\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "// spotless:off");
    expect(c).toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("//<editor-fold desc=\"x\">", async () => {
    const text = `//<editor-fold desc="x">\nval x = 1\n//</editor-fold>\n`;
    const cs = await classify(text);
    const open = cs.find(x => x.text.startsWith("//<editor-fold"));
    expect(open).toBeDefined();
    expect(open!.directive).toBe(true);
    const close = cs.find(x => x.text.startsWith("//</editor-fold>"));
    expect(close).toBeDefined();
    expect(close!.directive).toBe(true);
  });
});

// ---- case 7: annotation is not a comment ----

describe("case 7 — @Suppress is not a comment", () => {
  it('@Suppress("UNUSED") produces 0 comments', async () => {
    const text = `@Suppress("UNUSED")\nfun foo() {}\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });
});

// ---- case 8: commented-out code is a counted comment ----

describe("case 8 — commented-out code → non-exempt comment", () => {
  it("// val x = foo() is a counted comment", async () => {
    const text = `// val x = foo()\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(1);
    const c = r.comments[0]!;
    expect(c.text).toBe("// val x = foo()");
    expect(c.exempt).toBe(false);
  });
});


describe("case 9 — * in multi-line expression → 0 comments", () => {
  it("val a = 1 *\\n    b has no comment node", async () => {
    const text = `val a = 1 *\n    b\n`;
    const r = await comments(text);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });
});


describe("case 10 — header classification", () => {
  it("license block before package → header true", async () => {
    const text = `/* Copyright 2024 Acme Corp. */\npackage a.b\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text.startsWith("/* Copyright"));
    expect(c).toBeDefined();
    expect(c!.header).toBe(true);
  });

  it("comment before @file:JvmName → header true", async () => {
    const text = `// file header\n@file:JvmName("X")\npackage a.b\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "// file header");
    expect(c).toBeDefined();
    expect(c!.header).toBe(true);
  });

  it("comment after package → header false", async () => {
    const text = `package a.b\n// after package\nfun foo() {}\n`;
    const cs = await classify(text);
    const c = cs.find(x => x.text === "// after package");
    expect(c).toBeDefined();
    expect(c!.header).toBe(false);
  });

  it(".kts with no package: comment → header false", async () => {
    const text = `// build script\nplugins { kotlin("jvm") }\n`;
    const cs = await classify(text, "build.gradle.kts");
    const c = cs.find(x => x.text === "// build script");
    expect(c).toBeDefined();
    expect(c!.header).toBe(false);
  });
});
