import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, renameSync } from "fs";
import { join } from "path";
import { Parser, Language } from "../../src/hooks/lib/tree-sitter.js";
import type { Node } from "../../src/hooks/lib/tree-sitter.js";

const REPO_ROOT = "/home/newman/.local/share/groundwork";
const GRAMMARS_DIR = join(REPO_ROOT, "src/hooks/grammars");
const LIB_DIR = join(REPO_ROOT, "src/hooks/lib");
const FIXTURE_PATH = join(REPO_ROOT, "test/fixtures/comment-density/rust/lib.rs");

let parser: Parser;
let language: Language;

beforeAll(async () => {
  const wasmBinary = readFileSync(join(LIB_DIR, "tree-sitter.wasm")).buffer;
  await Parser.init({ wasmBinary });
  parser = new Parser();
  const wasm = readFileSync(join(GRAMMARS_DIR, "tree-sitter-rust.wasm"));
  language = await Language.load(new Uint8Array(wasm));
  parser.setLanguage(language);
});

function walkNodes(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkNodes(child, fn);
  }
}

// AC1 — Provenance
describe("AC1: provenance record", () => {
  it("has correct package and version", () => {
    const src = JSON.parse(
      readFileSync(join(GRAMMARS_DIR, "tree-sitter-rust.source.json"), "utf-8")
    );
    expect(src.package).toBe("tree-sitter-rust");
    expect(src.version).toBe("0.24.0");
    expect(src.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(src.bytes).toBeGreaterThan(0);
  });
});

// AC2 — Realistic fixture parses without ERROR nodes
describe("AC2: fixture parse — no errors, ≥60 named nodes", () => {
  it("parses lib.rs without ERROR nodes and has enough nodes", () => {
    const src = readFileSync(FIXTURE_PATH, "utf-8");
    const tree = parser.parse(src);
    let errorCount = 0;
    let namedCount = 0;
    walkNodes(tree.rootNode, (n) => {
      if (n.type === "ERROR") errorCount++;
      if (n.isNamed) namedCount++;
    });
    expect(errorCount).toBe(0);
    expect(namedCount).toBeGreaterThanOrEqual(60);
  });
});

// AC3 — Comment count
describe("AC3: comment count ≥12 in fixture", () => {
  it("finds at least 12 comment nodes", () => {
    const src = readFileSync(FIXTURE_PATH, "utf-8");
    const tree = parser.parse(src);
    const comments: Node[] = [];
    walkNodes(tree.rootNode, (n) => {
      if (n.type.includes("comment")) comments.push(n);
    });
    expect(comments.length).toBeGreaterThanOrEqual(12);
  });
});

// AC4 — Strings are NOT comments
describe("AC4: strings not counted as comments", () => {
  it("counts exactly 3 comment nodes in the control snippet", () => {
    const snippet = `fn main() {
    let s = "string with // fake comment and /* block */ too";
    let r = r#"raw string with // fake and /* block */"#;
    // this IS a real line comment
    /* this IS a real block comment */
    /// this IS a doc comment
    println!("{}", s);
}`;
    const snippetParser = new Parser();
    snippetParser.setLanguage(language);
    const tree = snippetParser.parse(snippet);
    const comments: Node[] = [];
    walkNodes(tree.rootNode, (n) => {
      if (n.type === "line_comment" || n.type === "block_comment") comments.push(n);
    });
    expect(comments.length).toBe(3);
  });
});

// AC5 — Node types
describe("AC5: comment node types investigation", () => {
  it("logs distinct comment node types from fixture", () => {
    const src = readFileSync(FIXTURE_PATH, "utf-8");
    const tree = parser.parse(src);
    const typeSet = new Set<string>();
    const commentNodes: Array<{ type: string; text: string }> = [];
    walkNodes(tree.rootNode, (n) => {
      if (n.type.includes("comment")) {
        typeSet.add(n.type);
        commentNodes.push({ type: n.type, text: n.text.slice(0, 20) });
      }
    });
    const types = [...typeSet].sort();
    console.log("Rust comment node types:", types);
    console.log("Comment node samples:", commentNodes);

    // Assert which types line_comment and block_comment are present
    // and record what /// and //! produce.
    const lineComments = commentNodes.filter((c) => c.type === "line_comment");
    const blockComments = commentNodes.filter((c) => c.type === "block_comment");
    console.log("line_comment count:", lineComments.length);
    console.log("block_comment count:", blockComments.length);
    console.log(
      "/// samples (line_comment):",
      lineComments.filter((c) => c.text.startsWith("///"))
    );
    console.log(
      "//! samples (line_comment):",
      lineComments.filter((c) => c.text.startsWith("//!"))
    );

    // The Rust grammar folds /// and //! into line_comment.
    expect(types).toContain("line_comment");
    expect(types).toContain("block_comment");
  });

  it("/// doc comments produce line_comment nodes", () => {
    const snippet = `/// doc comment\nfn foo() {}`;
    const p = new Parser();
    p.setLanguage(language);
    const tree = p.parse(snippet);
    const commentTypes: string[] = [];
    walkNodes(tree.rootNode, (n) => {
      if (n.type.includes("comment")) commentTypes.push(n.type);
    });
    console.log("/// node type:", commentTypes);
    expect(commentTypes).toContain("line_comment");
  });

  it("//! inner doc comments produce line_comment nodes", () => {
    const snippet = `//! inner doc\nfn bar() {}`;
    const p = new Parser();
    p.setLanguage(language);
    const tree = p.parse(snippet);
    const commentTypes: string[] = [];
    walkNodes(tree.rootNode, (n) => {
      if (n.type.includes("comment")) commentTypes.push(n.type);
    });
    console.log("//! node type:", commentTypes);
    expect(commentTypes).toContain("line_comment");
  });
});

describe("AC6: bite proof — missing wasm fails", () => {
  it("bite: missing wasm → load fails", async () => {
    const wasmPath = join(GRAMMARS_DIR, "tree-sitter-rust.wasm");
    const backupPath = wasmPath + ".bak";
    renameSync(wasmPath, backupPath);
    try {
      let threw = false;
      try {
        const wasm = readFileSync(wasmPath);
        await Language.load(new Uint8Array(wasm));
      } catch (e) {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      renameSync(backupPath, wasmPath);
    }
  });
});
