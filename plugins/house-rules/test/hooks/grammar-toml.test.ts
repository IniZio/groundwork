import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, renameSync } from "fs";
import { join } from "path";
import { Parser, Language } from "../../src/hooks/lib/tree-sitter.js";

const GRAMMARS_DIR = join(import.meta.dir, "../../src/hooks/grammars");
const FIXTURE_PATH = join(import.meta.dir, "../../test/fixtures/comment-density/toml/config.toml");

let parser: Parser;
let language: Language;

beforeAll(async () => {
  await Parser.init({
    locateFile: () => join(import.meta.dir, "../../src/hooks/lib/tree-sitter.wasm"),
  });
  parser = new Parser();
  const wasm = readFileSync(join(GRAMMARS_DIR, "tree-sitter-toml.wasm"));
  language = await Language.load(new Uint8Array(wasm));
  parser.setLanguage(language);
});

function collectNodes(node: any): any[] {
  const nodes: any[] = [node];
  for (let i = 0; i < node.childCount; i++) {
    nodes.push(...collectNodes(node.child(i)));
  }
  return nodes;
}

describe("TOML grammar", () => {
  it("AC1: provenance JSON has correct package, version, sha256, bytes", () => {
    const src = JSON.parse(
      readFileSync(join(GRAMMARS_DIR, "tree-sitter-toml.source.json"), "utf8")
    );
    expect(src.package).toBe("@tree-sitter-grammars/tree-sitter-toml");
    expect(src.version).toBe("0.7.0");
    expect(src.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof src.bytes).toBe("number");
    expect(src.bytes).toBeGreaterThan(0);
  });

  it("AC2: fixture parses without ERROR nodes and has ≥60 named nodes", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const errors = all.filter((n) => n.type === "ERROR");
    expect(errors).toHaveLength(0);
    const named = all.filter((n) => n.isNamed);
    expect(named.length).toBeGreaterThanOrEqual(60);
  });

  it("AC3: comment node count ≥ 10 from fixture", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    console.log("TOML fixture comment node count:", commentNodes.length);
    expect(commentNodes.length).toBeGreaterThanOrEqual(10);
  });

  it("AC4: strings containing # are NOT counted as comments (exactly 2 real comments)", () => {
    const code = `# this IS a real comment
key = "value with # fake comment inside"
other = 'another # fake'
multiline = """
still not a # comment here
"""
real_val = 42
# another real comment`;
    const tree = parser.parse(code);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    console.log(
      "AC4 comment texts:",
      commentNodes.map((n: any) => n.text)
    );
    expect(commentNodes).toHaveLength(2);
  });

  it("AC5: distinct comment node types from fixture", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const types = [
      ...new Set(
        all.filter((n: any) => n.type.includes("comment")).map((n: any) => n.type)
      ),
    ];
    console.log("TOML comment node types:", types);
    expect(types.length).toBeGreaterThan(0);
  });

  it("AC6: #:schema directive appears as a comment node", () => {
    const code = `#:schema https://example.com/schema.json
# regular comment
[package]
name = "test"`;
    const tree = parser.parse(code);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n: any) => n.type.includes("comment"));
    console.log("AC6 comment count:", commentNodes.length);
    console.log(
      "AC6 comment texts:",
      commentNodes.map((n: any) => ({ type: n.type, text: n.text }))
    );
    // #:schema should appear as a comment node
    const schemaNode = commentNodes.find((n: any) =>
      n.text.includes("#:schema")
    );
    expect(schemaNode).toBeDefined();
    console.log("AC6 schema node type:", schemaNode?.type);
    console.log("AC6 schema node text:", schemaNode?.text);
  });

  it("AC7 bite: missing wasm → load fails", async () => {
    const wasmPath = join(GRAMMARS_DIR, "tree-sitter-toml.wasm");
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
