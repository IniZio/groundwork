import { describe, it, expect } from "bun:test";
import { readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const AGENTS_DIR = path.join(ROOT, "agents");
const MAX_BYTES = 1536; // 1.5 KB

const agentFiles = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f, absPath: path.join(AGENTS_DIR, f) }));

function extractFrontmatterName(content: string): string | null {
  const m = content.match(/^---\n[\s\S]*?^name:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

describe("agent-shape: frontmatter name is bare (no colon) and matches filename", () => {
  for (const { name, absPath } of agentFiles) {
    it(`${name} frontmatter name is bare and matches basename`, () => {
      const content = readFileSync(absPath, "utf8");
      const agentName = extractFrontmatterName(content);
      expect(agentName, `${name}: missing name: in frontmatter`).not.toBeNull();
      expect(
        agentName,
        `${name}: name must match /^[a-z0-9-]+$/ (no colon/prefix)`,
      ).toMatch(/^[a-z0-9-]+$/);
      const basename = path.basename(name, ".md");
      expect(
        agentName,
        `${name}: name "${agentName}" must equal basename "${basename}"`,
      ).toBe(basename);
    });
  }
});

describe("agent-shape: each agents/*.md ≤1.5 KB with non-empty Output section", () => {
  for (const { name, absPath } of agentFiles) {
    it(`${name} is ≤${MAX_BYTES} bytes`, () => {
      const actual = statSync(absPath).size;
      expect(
        actual,
        `${name}: ${actual} bytes exceeds limit of ${MAX_BYTES} bytes`,
      ).toBeLessThanOrEqual(MAX_BYTES);
    });

    it(`${name} has a non-empty Output section`, () => {
      const content = readFileSync(absPath, "utf8");
      const outputMatch = content.match(/^##\s+Output\s*\n([\s\S]*?)(?=^##\s|\s*$)/m);
      expect(
        outputMatch,
        `${name}: missing ## Output section`,
      ).not.toBeNull();
      const body = outputMatch![1].trim();
      expect(
        body.length > 0,
        `${name}: ## Output section is empty`,
      ).toBe(true);
    });
  }
});
