import { describe, it, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceFiles } from "../../src/engine/source-file.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_GO = readFileSync(
  path.join(__dirname, "../fixtures/comment-density/go-directives/corpus.go"),
  "utf8",
);

const GO_BASICS = `// Copyright 2024 Example Corp.\n\npackage demo\n\n// Add adds two ints.\nfunc Add(a, b int) int { return a + b }\n\nfunc body() {\n\t// first line\n\t// second line\n\n\t// separated\n\tx := 1 // trailing\n\t_ = x\n\t// export Foo\n}\n\n//go:build linux\nvar _ = true\n\n//export GoFoo\nfunc GoFoo() {}\n`;

const TS_MIXED = `// line one\n// line two\n/* block */\nconst x = 1;\n`;

let sf = createSourceFiles();
afterEach(() => {
  sf.dispose();
  sf = createSourceFiles();
});

describe("SourceFile classification — Go directives and kinds", () => {
  it("AC4-1: //go:build linux has directive true", async () => {
    const r = await sf.get("go", GO_BASICS);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find(x => x.text === "//go:build linux");
    expect(c).toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("AC4-2: doc comment directly above func Add has kind doc", async () => {
    const r = await sf.get("go", GO_BASICS);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find(x => x.text === "// Add adds two ints.");
    expect(c).toBeDefined();
    expect(c!.kind).toBe("doc");
  });

  it("AC4-3: adjacent // lines share group; blank-separated comment gets different group", async () => {
    const r = await sf.get("go", GO_BASICS);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const first = r.source.comments.find(x => x.text === "// first line");
    const second = r.source.comments.find(x => x.text === "// second line");
    const separated = r.source.comments.find(x => x.text === "// separated");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(separated).toBeDefined();
    expect(first!.group).not.toBeNull();
    expect(first!.group).toBe(second!.group);
    expect(separated!.group).not.toBeNull();
    expect(separated!.group).not.toBe(first!.group);
  });

  it("AC4-4: negative controls — directive false, kind line, trailing group null", async () => {
    const r = await sf.get("go", GO_BASICS);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const firstLine = r.source.comments.find(x => x.text === "// first line");
    expect(firstLine).toBeDefined();
    expect(firstLine!.directive).toBe(false);
    expect(firstLine!.kind).toBe("line");

    const exportSpace = r.source.comments.find(x => x.text === "// export Foo");
    expect(exportSpace).toBeDefined();
    expect(exportSpace!.directive).toBe(false);

    const exportNoSpace = r.source.comments.find(x => x.text === "//export GoFoo");
    expect(exportNoSpace).toBeDefined();
    expect(exportNoSpace!.directive).toBe(true);

    const trailing = r.source.comments.find(x => x.text === "// trailing");
    expect(trailing).toBeDefined();
    expect(trailing!.group).toBeNull();
  });

  it("AC4-5: header — copyright line before package is header true; inner comment is header false", async () => {
    const r = await sf.get("go", GO_BASICS);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const copyright = r.source.comments.find(x => x.text === "// Copyright 2024 Example Corp.");
    expect(copyright).toBeDefined();
    expect(copyright!.header).toBe(true);

    const inner = r.source.comments.find(x => x.text === "// first line");
    expect(inner).toBeDefined();
    expect(inner!.header).toBe(false);
  });

  it("AC4-6: corpus directives", async () => {
    const r = await sf.get("go", CORPUS_GO);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const { comments } = r.source;

    const assertDirective = (text: string) => {
      const c = comments.find(x => x.text === text);
      expect(c, `directive comment not found: ${text}`).toBeDefined();
      expect(c!.directive, `expected directive true for: ${text}`).toBe(true);
    };

    assertDirective("//go:build ignore");
    assertDirective("// +build ignore");
    assertDirective("//go:embed dummy.txt");
    assertDirective("//go:generate stringer -type=Color");
    assertDirective("//go:linkname runtimeGC runtime.GC");
    assertDirective("//go:noinline");
    assertDirective("//export GoFunctionName");
    assertDirective("// nolint");
    assertDirective("//lint:ignore SA1000 this is a deliberate test fixture");
    assertDirective("// +kubebuilder:validation:Optional");

    const nolints = comments.filter(x => x.text === "//nolint:errcheck");
    expect(nolints.length).toBeGreaterThan(0);
    expect(nolints.some(x => x.directive)).toBe(true);

    const prose = comments.find(x => x.text === "// Color represents a display color.");
    expect(prose).toBeDefined();
    expect(prose!.directive).toBe(false);
  });
});

describe("SourceFile classification — default classifier (TypeScript)", () => {
  it("AC4-7: adjacent // share group; adjacent /* gets different group; no directive/header", async () => {
    const r = await sf.get("typescript", TS_MIXED, "x.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const { comments } = r.source;

    const lineOne = comments.find(x => x.text === "// line one");
    const lineTwo = comments.find(x => x.text === "// line two");
    const block = comments.find(x => x.text === "/* block */");
    expect(lineOne).toBeDefined();
    expect(lineTwo).toBeDefined();
    expect(block).toBeDefined();

    expect(lineOne!.group).not.toBeNull();
    expect(lineOne!.group).toBe(lineTwo!.group);

    expect(block!.group).not.toBeNull();
    expect(block!.group).not.toBe(lineTwo!.group);

    expect(lineOne!.directive).toBe(false);
    expect(lineOne!.header).toBe(false);
    expect(lineOne!.kind).toBe("line");
    expect(block!.kind).toBe("block");
  });
});
