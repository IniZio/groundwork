import { describe, it, expect } from "bun:test";
import { findComments } from "../../src/hooks/lib/comment-density.js";
import { classifyComments, parseText } from "../../src/hooks/languages/parse.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { SWIFT_TOOL_MARKERS } from "../../src/hooks/languages/tool-markers.js";

async function fc(text: string) {
  const r = await findComments(text, "swift", getParser);
  if (!r.ok) throw new Error(`findComments failed: ${r.reason}`);
  return r.comments;
}

async function cl(text: string) {
  const r = await parseText(text, "swift", getParser);
  if (!r.ok) throw new Error(`parseText failed: ${r.reason}`);
  return classifyComments(r.tree.rootNode, text, "swift");
}

function byText<T extends { text: string }>(arr: T[], text: string): T {
  const found = arr.find(c => c.text === text);
  if (!found) {
    throw new Error(`Not found: ${JSON.stringify(text)}\nHave: ${arr.map(c => JSON.stringify(c.text)).join(", ")}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Case 11: doc comments
// ---------------------------------------------------------------------------

describe("(11) swift-doc: /// above func → doc + exempt", () => {
  const src = `import Foundation

/// Returns the parking lot id.
func parkingLotId() -> String { return "x" }

// plain comment
let x = 1
`;

  it("/// is kind doc", async () => {
    const cls = await cl(src);
    const c = byText(cls, "/// Returns the parking lot id.");
    expect(c.kind).toBe("doc");
  });

  it("/// is exempt via swift-doc", async () => {
    const comments = await fc(src);
    const c = byText(comments, "/// Returns the parking lot id.");
    expect(c.exempt).toBe(true);
    expect(c.exemptReason).toBe("swift-doc");
  });

  it("/** Doc */ block is kind doc", async () => {
    const src2 = `/** Doc */\nstruct Foo {}\n// plain\nlet y = 1\n`;
    const cls = await cl(src2);
    const c = byText(cls, "/** Doc */");
    expect(c.kind).toBe("doc");
  });

  it("/** Doc */ is exempt", async () => {
    const src2 = `/** Doc */\nstruct Foo {}\n// plain\nlet y = 1\n`;
    const comments = await fc(src2);
    const c = byText(comments, "/** Doc */");
    expect(c.exempt).toBe(true);
  });

  it("//// is NOT doc (four slashes)", async () => {
    const src3 = `//// not doc\nlet z = 1\n// plain\nlet w = 2\n`;
    const cls = await cl(src3);
    const c = byText(cls, "//// not doc");
    expect(c.kind).not.toBe("doc");
  });
});

// ---------------------------------------------------------------------------
// Case 12: MARK directive
// ---------------------------------------------------------------------------

describe("(12) // MARK: - Lifecycle → directive", () => {
  const src = `// MARK: - Lifecycle\nclass Foo {}\n// plain\nlet x = 1\n`;

  it("// MARK: - Lifecycle has directive=true", async () => {
    const cls = await cl(src);
    const c = byText(cls, "// MARK: - Lifecycle");
    expect(c.directive).toBe(true);
  });

  it("// plain is NOT directive (negative control)", async () => {
    const cls = await cl(src);
    const c = byText(cls, "// plain");
    expect(c.directive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 13: swiftlint markers
// ---------------------------------------------------------------------------

describe("(13) swiftlint markers → directive", () => {
  it("// swiftlint:disable force_cast", async () => {
    const src = `struct Foo {}\n// swiftlint:disable force_cast\nlet x = 1\n// plain\n`;
    const cls = await cl(src);
    const c = byText(cls, "// swiftlint:disable force_cast");
    expect(c.directive).toBe(true);
  });

  it("// swiftlint:disable:next line_length", async () => {
    const src = `struct Foo {}\n// swiftlint:disable:next line_length\nlet x = 1\n// plain\n`;
    const cls = await cl(src);
    const c = byText(cls, "// swiftlint:disable:next line_length");
    expect(c.directive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SWIFT_TOOL_MARKERS exhaustive coverage — one sample per regex
// ---------------------------------------------------------------------------

describe("SWIFT_TOOL_MARKERS: each regex has a matching directive sample", () => {
  const SAMPLES: [RegExp, string, string][] = [
    [SWIFT_TOOL_MARKERS[0]!, "// swift-tools-version:5.9", "swift-tools-version:5.9"],
    [SWIFT_TOOL_MARKERS[1]!, "// swiftlint:enable all", "swiftlint:enable all"],
    [SWIFT_TOOL_MARKERS[2]!, "// swift-format-ignore", "swift-format-ignore"],
    [SWIFT_TOOL_MARKERS[3]!, "// swiftformat:disable all", "swiftformat:disable all"],
    [SWIFT_TOOL_MARKERS[4]!, "// periphery:ignore", "periphery:ignore"],
    [SWIFT_TOOL_MARKERS[5]!, "// sourcery: AutoMockable", "sourcery: AutoMockable"],
    [SWIFT_TOOL_MARKERS[6]!, "// MARK: - Section", "MARK: - Section"],
  ];

  for (const [re, commentText, inner] of SAMPLES) {
    it(`${commentText} matches regex ${re} and is directive`, async () => {
      const src = `struct Foo {}\n${commentText}\nlet x = 1\n// hello\n`;
      expect(re.test(inner)).toBe(true);
      const cls = await cl(src);
      const c = byText(cls, commentText);
      expect(c.directive).toBe(true);
    });
  }

  it("SWIFT_TOOL_MARKERS has exactly 7 entries", () => {
    expect(SWIFT_TOOL_MARKERS.length).toBe(7);
  });

  it("// hello is NOT a directive (negative control)", async () => {
    const src = `struct Foo {}\n// MARK: - X\n// hello\nlet x = 1\n`;
    const cls = await cl(src);
    const c = byText(cls, "// hello");
    expect(c.directive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

describe("Header: leading group at row 0 → header", () => {
  it("group starting at row 0 is header=true", async () => {
    const src = `// Copyright 2024 Acme.\nstruct Foo {}\n// inner\nlet x = 1\n`;
    const cls = await cl(src);
    const c = byText(cls, "// Copyright 2024 Acme.");
    expect(c.header).toBe(true);
  });

  it("group after #!/usr/bin/swift shebang → header=true", async () => {
    const src = `#!/usr/bin/swift\n// Copyright 2024 Acme.\nstruct Foo {}\n// inner\nlet x = 1\n`;
    const cls = await cl(src);
    const c = byText(cls, "// Copyright 2024 Acme.");
    expect(c.header).toBe(true);
  });

  it("comment deeper in file is NOT header", async () => {
    const src = `// header\nstruct Foo {}\n// inner comment\nlet x = 1\n`;
    const cls = await cl(src);
    const c = byText(cls, "// inner comment");
    expect(c.header).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 15: compiler directives are not comments
// ---------------------------------------------------------------------------

describe("(15) compiler directives → 0 comments", () => {
  it("if #available(iOS 15, *) {} produces 0 comments", async () => {
    const src = `func f() {\n  if #available(iOS 15, *) {}\n}\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(0);
  });

  it("if #available + one real comment → 1 comment", async () => {
    const src = `func f() {\n  // one real comment\n  if #available(iOS 15, *) {}\n}\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(1);
  });

  it("#selector(foo) produces 0 comments", async () => {
    const src = `class C: NSObject {\n  @objc func foo() {}\n  func bar() { _ = #selector(foo) }\n}\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(0);
  });

  it("#if DEBUG ... #endif produces 0 comments", async () => {
    const src = `struct Foo {\n  #if DEBUG\n  var debug = true\n  #endif\n}\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(0);
  });

  it("#if DEBUG + one real comment → 1 comment", async () => {
    const src = `struct Foo {\n  #if DEBUG\n  // debug comment\n  var debug = true\n  #endif\n}\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Case 16: raw strings and multi-line strings don't produce comments
// ---------------------------------------------------------------------------

describe("(16) raw/multiline string literals → 0 comments", () => {
  it("#\"raw // not\"# → 0 comments", async () => {
    const src = `let s = #"raw // not"#\nlet x = 1\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(0);
  });

  it("#\"raw // not\"# + one real comment → 1 comment", async () => {
    const src = `let s = #"raw // not"#\n// real comment\nlet x = 1\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(1);
  });

  it('""" multiline with // inside → 0 comments', async () => {
    const src = `let m = """\n  // inside\n  text\n  """\nlet x = 1\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(0);
  });

  it('""" multiline with // inside + one real comment → 1 comment', async () => {
    const src = `let m = """\n  // inside\n  text\n  """\n// real comment\nlet x = 1\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nested block comment
// ---------------------------------------------------------------------------

describe("Nested /* outer /* inner */ still */ → exactly 1 comment", () => {
  it("nested block comment counts as 1", async () => {
    const src = `/* outer /* inner */ still */\nlet x = 1\n`;
    const cls = await cl(src);
    expect(cls.length).toBe(1);
  });

  it("after stripping, let x = 1 survives and reparses without errors", async () => {
    const src = `/* outer /* inner */ still */\nlet x = 1\n`;
    const pr = await parseText(src, "swift", getParser);
    if (!pr.ok) throw new Error(pr.reason);
    const stripped = src.replace(/\/\*.*?\*\//s, "").trim();
    const pr2 = await parseText(stripped, "swift", getParser);
    if (!pr2.ok) throw new Error(`stripped parse failed: ${pr2.reason}`);
    expect(pr2.errorRows.size).toBe(0);
    expect(stripped).toContain("let x = 1");
  });
});

// ---------------------------------------------------------------------------
// Case 17: note markers (WP-ticket style) vs plain TODO
// ---------------------------------------------------------------------------

describe("(17) TODO(WP-12) exempt; TODO: plain is NOT", () => {
  it("// TODO(WP-12): fix is exempt (note-marker rule)", async () => {
    const src = `func f() {\n  // TODO(WP-12): fix\n  let x = 1\n  _ = x\n}\n`;
    const comments = await fc(src);
    const c = byText(comments, "// TODO(WP-12): fix");
    expect(c.exempt).toBe(true);
  });

  it("// TODO: fix later is NOT exempt", async () => {
    const src = `func f() {\n  // TODO: fix later\n  let x = 1\n  _ = x\n}\n`;
    const comments = await fc(src);
    const c = byText(comments, "// TODO: fix later");
    expect(c.exempt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 18: URL exemption
// ---------------------------------------------------------------------------

describe("(18) URL comment is exempt", () => {
  it("// https://developer.apple.com/doc is exempt", async () => {
    const src = `func f() {\n  // https://developer.apple.com/doc\n  let x = 1\n  _ = x\n}\n`;
    const comments = await fc(src);
    const c = byText(comments, "// https://developer.apple.com/doc");
    expect(c.exempt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 19: divider exemption
// ---------------------------------------------------------------------------

describe("(19) divider comment is exempt", () => {
  it("// ----- is exempt", async () => {
    const src = `func f() {\n  // -----\n  let x = 1\n  _ = x\n}\n`;
    const comments = await fc(src);
    const c = byText(comments, "// -----");
    expect(c.exempt).toBe(true);
  });
});
