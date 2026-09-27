import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const CONTAINERFILE_PATH = path.resolve(
  import.meta.dir,
  "../../test/fixtures/comment-density/nexus-probe/Containerfile",
);

function walkComments(node: any): string[] {
  const found: string[] = [];
  if (node.type.includes("comment")) found.push(node.type);
  for (let i = 0; i < node.childCount; i++) found.push(...walkComments(node.child(i)));
  return found;
}

function hasErrorOrMissing(node: any): boolean {
  if (node.type === "ERROR" || node.type === "MISSING") return true;
  for (let i = 0; i < node.childCount; i++) if (hasErrorOrMissing(node.child(i))) return true;
  return false;
}

describe("dockerfile grammar — Containerfile ungated", () => {
  it("parses local Containerfile: ok, no ERROR/MISSING, exactly 10 comment nodes", async () => {
    const result = await getParser("dockerfile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = readFileSync(CONTAINERFILE_PATH, "utf8");
    const tree = result.parser.parse(content);
    expect(hasErrorOrMissing(tree.rootNode)).toBe(false);
    const comments = walkComments(tree.rootNode);
    expect(comments).toHaveLength(10);
  });
});
