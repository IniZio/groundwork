import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Parser, Language } from "../../src/hooks/lib/tree-sitter.js";

const REPO_ROOT = "/home/newman/.local/share/groundwork";
const GRAMMARS_DIR = join(REPO_ROOT, "src/hooks/grammars");
const FIXTURES_DIR = join(REPO_ROOT, "test/fixtures/comment-density/sql");

let parser: Parser;
let language: Language;

// SQL grammar uses 'comment' for -- lines and 'marginalia' for /* */ blocks
function isCommentNode(node: { type: string }): boolean {
  return node.type === "comment" || node.type === "marginalia";
}

function walkCommentNodes(node: any): string[] {
  const found: string[] = [];
  if (isCommentNode(node)) found.push(node.type);
  for (let i = 0; i < node.childCount; i++) {
    found.push(...walkCommentNodes(node.child(i)));
  }
  return found;
}

function hasError(node: any): boolean {
  if (node.type === "ERROR") return true;
  for (let i = 0; i < node.childCount; i++) {
    if (hasError(node.child(i))) return true;
  }
  return false;
}

beforeAll(async () => {
  await Parser.init({
    locateFile: () => join(REPO_ROOT, "src/hooks/lib/tree-sitter.wasm"),
  });
  parser = new Parser();
  const wasm = readFileSync(join(GRAMMARS_DIR, "tree-sitter-sql.wasm"));
  language = await Language.load(new Uint8Array(wasm));
  parser.setLanguage(language);
});

describe("SQL grammar", () => {
  it("AC1: source JSON records provenance", async () => {
    const src = await Bun.file(join(GRAMMARS_DIR, "tree-sitter-sql.source.json")).json();
    expect(src.package).toBe("@derekstride/tree-sitter-sql");
    expect(src.version).toBe("0.3.11");
    expect(src.sha256).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(src.sha256)).toBe(true);
    expect(typeof src.bytes).toBe("number");
    expect(src.bytes).toBeGreaterThan(0);
    expect(src.build_command).toContain("tree-sitter build --wasm");
  });

  it("AC2: realistic fixture parses without ERROR nodes", () => {
    const sql = readFileSync(join(FIXTURES_DIR, "schema.sql"), "utf8");
    expect(sql.split("\n").length).toBeGreaterThanOrEqual(60);
    const tree = parser.parse(sql);
    expect(hasError(tree.rootNode)).toBe(false);
  });

  it("AC3: fixture has at least 10 comment/marginalia nodes", () => {
    const sql = readFileSync(join(FIXTURES_DIR, "schema.sql"), "utf8");
    const tree = parser.parse(sql);
    const comments = walkCommentNodes(tree.rootNode);
    expect(comments.length).toBeGreaterThanOrEqual(10);
  });

  it("AC4: string literals containing comment-like text are NOT comment nodes", () => {
    const snippet = [
      "SELECT '-- this is inside a string, not a comment' AS x,",
      "       '/* also not a comment */' AS y;",
      "-- this IS a real comment",
      "/* this IS a real block comment */",
      "SELECT 1;",
    ].join("\n");
    const tree = parser.parse(snippet);
    const comments = walkCommentNodes(tree.rootNode);
    // Exactly 2: one 'comment' (--)  and one 'marginalia' (/* */)
    expect(comments).toHaveLength(2);
  });

  it("AC5: reports distinct comment node types from fixture", () => {
    const sql = readFileSync(join(FIXTURES_DIR, "schema.sql"), "utf8");
    const tree = parser.parse(sql);
    const allTypes = walkCommentNodes(tree.rootNode);
    const distinct = [...new Set(allTypes)].sort();
    // Log for visibility — SQL grammar uses 'comment' (--) and 'marginalia' (/*)
    console.log("SQL comment node types:", distinct);
    expect(distinct.length).toBeGreaterThanOrEqual(1);
    // Verify the known types are present
    expect(distinct).toContain("comment");
    expect(distinct).toContain("marginalia");
  });

  it("AC6 bite: missing wasm → Language.load fails", async () => {
    const wasmPath = join(GRAMMARS_DIR, "tree-sitter-sql.wasm");
    const backupPath = wasmPath + ".bak";
    renameSync(wasmPath, backupPath);
    try {
      let threw = false;
      try {
        const wasm = readFileSync(wasmPath);
        await Language.load(new Uint8Array(wasm));
      } catch (_e) {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      renameSync(backupPath, wasmPath);
    }
  });
});
