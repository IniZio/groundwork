import { describe, it, expect } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const GRAMMARS_DIR = path.resolve(import.meta.dir, "../../src/hooks/grammars");
const HOOKS_DIR = path.resolve(import.meta.dir, "../../src/hooks");


const DOCKERFILE_REF = "142dedaa:deploy/nexus-probe/Dockerfile";
const CONTAINERFILE_REF = "142dedaa:deploy/nexus-probe/toolchain/.nexus/Containerfile";
const HERDR_REPO = process.env["HERDR_REPO"] ?? "";

function refExists(ref: string): boolean {
  try {
    execSync(`git -C ${HERDR_REPO} cat-file -e ${ref}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const herdrAvailable =
  existsSync(HERDR_REPO) &&
  refExists(DOCKERFILE_REF) &&
  refExists(CONTAINERFILE_REF);

function gitShow(ref: string): string {
  return execSync(`git -C ${HERDR_REPO} show ${ref}`, { encoding: "utf8" });
}

function walkComments(node: any): string[] {
  const found: string[] = [];
  if (node.type.includes("comment")) found.push(node.type);
  for (let i = 0; i < node.childCount; i++) found.push(...walkComments(node.child(i)));
  return found;
}

function hasError(node: any): boolean {
  if (node.type === "ERROR") return true;
  for (let i = 0; i < node.childCount; i++) if (hasError(node.child(i))) return true;
  return false;
}

describe("dockerfile grammar", () => {
  it("AC1: source JSON records provenance and sha256", async () => {
    const src = await Bun.file(path.join(GRAMMARS_DIR, "tree-sitter-dockerfile.source.json")).json();
    expect(src.repo).toContain("camdencheek/tree-sitter-dockerfile");
    expect(src.commit).toHaveLength(40);
    expect(src.cli_version).toMatch(/^0\.25\./);
    expect(src.sha256).toHaveLength(64);
    expect(typeof src.bytes).toBe("number");
    expect(src.bytes).toBeGreaterThan(0);
  });

  describe("AC2: getParser('dockerfile') parses correctly", () => {
    it("parses sample to exactly 1 comment node with no ERROR nodes", async () => {
      const result = await getParser("dockerfile");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tree = result.parser.parse('# c\nRUN echo "# not"\n');
      const comments = walkComments(tree.rootNode);
      expect(comments).toHaveLength(1);
      expect(hasError(tree.rootNode)).toBe(false);
    });

    it.skipIf(!herdrAvailable)("parses real Dockerfile (177 lines) without crashing, 87 comment nodes", async () => {
      const content = gitShow(DOCKERFILE_REF);
      const result = await getParser("dockerfile");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tree = result.parser.parse(content);
      expect(hasError(tree.rootNode)).toBe(false);
      const comments = walkComments(tree.rootNode);
      expect(comments).toHaveLength(87);
    });

    it.skipIf(!herdrAvailable)("AC3: line 1 node type includes 'comment'", async () => {
      const content = gitShow(DOCKERFILE_REF);
      const result = await getParser("dockerfile");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tree = result.parser.parse(content);
      const firstNode = tree.rootNode.child(0);
      expect(firstNode?.type).toContain("comment");
    });

    it("AC2 bite: dockerfile wasm missing in temp copy → probe returns ok=false", () => {
      const tmp = `/tmp/gw-dockerfile-bite-${process.pid}`;
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(path.join(tmp, "hooks"), { recursive: true });
      cpSync(HOOKS_DIR, path.join(tmp, "hooks"), { recursive: true });
      rmSync(path.join(tmp, "hooks/grammars/tree-sitter-dockerfile.wasm"));
      writeFileSync(path.join(tmp, "probe.ts"), [
        'import { getParser } from "./hooks/lib/tree-sitter-loader.js";',
        'const r = await getParser("dockerfile");',
        'process.stdout.write(r.ok ? "ok=true\\n" : "ok=false\\n");',
        'process.exit(r.ok ? 1 : 0);',
      ].join("\n"));
      const result = spawnSync("bun", [path.join(tmp, "probe.ts")], {
        cwd: tmp, encoding: "utf8", timeout: 30000,
      });
      rmSync(tmp, { recursive: true, force: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ok=false");
    });
  });

  it.skipIf(!herdrAvailable)("AC4: Containerfile content (same syntax) parses without error", async () => {
    const content = gitShow(CONTAINERFILE_REF);
    const result = await getParser("dockerfile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = result.parser.parse(content);
    expect(hasError(tree.rootNode)).toBe(false);
    const comments = walkComments(tree.rootNode);
    expect(comments.length).toBeGreaterThan(0);
  });
});
