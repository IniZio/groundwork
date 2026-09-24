import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, renameSync } from "fs";
import { join } from "path";
import { Parser, Language } from "../../src/hooks/lib/tree-sitter.js";

const GRAMMARS_DIR = join(import.meta.dir, "../../src/hooks/grammars");
const FIXTURE_PATH = join(import.meta.dir, "../../test/fixtures/comment-density/make/Makefile");

let parser: Parser;
let language: Language;

beforeAll(async () => {
  await Parser.init({
    locateFile: () => join(import.meta.dir, "../../src/hooks/lib/tree-sitter.wasm"),
  });
  parser = new Parser();
  const wasm = readFileSync(join(GRAMMARS_DIR, "tree-sitter-make.wasm"));
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

describe("Make grammar", () => {
  it("AC1: provenance JSON has correct package, version, sha256, bytes", () => {
    const src = JSON.parse(
      readFileSync(join(GRAMMARS_DIR, "tree-sitter-make.source.json"), "utf8")
    );
    expect(src.package).toBe("tree-sitter-make");
    expect(src.version).toBe("1.1.1");
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

  it("AC3: comment count ≥ 10 in fixture", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    console.log("Make fixture comment count:", commentNodes.length);
    expect(commentNodes.length).toBeGreaterThanOrEqual(10);
  });

  it("AC4: recipe # disambiguation — report what tree-sitter sees", () => {
    // Makefile requires real TAB before recipe lines
    const code = [
      "# this IS a real comment",
      "GREETING = hello",
      "",
      "greet: ## this might be a comment",
      '\techo "# not a comment inside string"',
      "\techo hello # this might be a comment too",
    ].join("\n");
    const tree = parser.parse(code);
    const all = collectNodes(tree.rootNode);
    const commentNodes = all.filter((n) => n.type.includes("comment"));
    console.log("AC4 comment count:", commentNodes.length);
    for (const c of commentNodes) {
      console.log(`  type=${c.type} text=${JSON.stringify(c.text)}`);
    }
    // Assertion: at minimum the standalone # comment line is detected
    expect(commentNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("AC5: distinct comment node types", () => {
    const src = readFileSync(FIXTURE_PATH, "utf8");
    const tree = parser.parse(src);
    const all = collectNodes(tree.rootNode);
    const types = [
      ...new Set(
        all.filter((n) => n.type.includes("comment")).map((n) => n.type)
      ),
    ];
    console.log("Make comment node types:", types);
    expect(types.length).toBeGreaterThanOrEqual(1);
  });

  it("AC6 bite: missing wasm → load fails", async () => {
    const wasmPath = join(GRAMMARS_DIR, "tree-sitter-make.wasm");
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
