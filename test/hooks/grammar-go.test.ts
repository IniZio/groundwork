import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, renameSync } from "fs";
import { join } from "path";
import { Parser, Language } from "../../src/hooks/lib/tree-sitter.js";

const GRAMMARS_DIR = join(import.meta.dir, "../../src/hooks/grammars");
const FIXTURE_PATH = join(import.meta.dir, "../../test/fixtures/comment-density/go/main.go");

let parser: Parser;
let language: Language;

beforeAll(async () => {
  await Parser.init({
    locateFile: () => join(import.meta.dir, "../../src/hooks/lib/tree-sitter.wasm"),
  });
  parser = new Parser();
  const wasm = readFileSync(join(GRAMMARS_DIR, "tree-sitter-go.wasm"));
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

describe("Go grammar", () => {
  it("AC1: provenance JSON has correct package, version, sha256, bytes", async () => {
    const src = JSON.parse(
      readFileSync(join(GRAMMARS_DIR, "tree-sitter-go.source.json"), "utf8")
    );
    expect(src.package).toBe("tree-sitter-go");
    expect(src.version).toBe("0.25.0");
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

  it("AC3: comment node count matches grep heuristic (diff ≤ 2), ≥ 10 comments", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    // Grep heuristic: lines starting with // (after trim) or containing /*
    // Note: tree-sitter counts block comments as one node regardless of lines,
    // while grep counts per-line, so a multi-line /* */ may differ by ≤1.
    const lines = src.split("\n");
    const grepCount = lines.filter(
      (l) => l.trimStart().startsWith("//") || l.includes("/*")
    ).length;
    const diff = Math.abs(commentNodes.length - grepCount);
    // Difference ≤ 2 is acceptable: block comments span multiple lines in grep
    // but appear as a single node in the AST.
    expect(diff).toBeLessThanOrEqual(2);
    expect(commentNodes.length).toBeGreaterThanOrEqual(10);
  });

  it("AC4: strings containing // or /* are NOT counted as comments", () => {
    const code = `package main
import "fmt"
func main() {
  s := "this has // a fake comment inside"
  r := \`raw string with // fake comment
and /* block */ too\`
  _ = s
  _ = r
  // this IS a real comment
  fmt.Println("done")
}`;
    const tree = parser.parse(code);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    expect(commentNodes).toHaveLength(1);
  });

  it("AC5: distinct comment node types include 'comment'", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const types = [...new Set(all.filter((n) => n.type.includes("comment")).map((n) => n.type))];
    console.log("Go comment node types:", types);
    expect(types).toContain("comment");
  });

  it("AC6 bite: missing wasm → load fails", async () => {
    const wasmPath = join(GRAMMARS_DIR, "tree-sitter-go.wasm");
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
