import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full, ext));
    else if (entry.isFile() && entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function findBareGwLines(content: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const [i, text] of content.split("\n").entries()) {
    if (/`gw\s/.test(text) || /^\s*gw\s/.test(text) || /`\S+\.ts\s/.test(text)) {
      hits.push({ line: i + 1, text });
    }
  }
  return hits;
}

describe("bare-gw detector — fixture", () => {
  it("detects backtick-form bare invocation", () => {
    expect(findBareGwLines("`gw slice add S1 --token T`")).toHaveLength(1);
  });

  it("detects code-block-line bare invocation", () => {
    expect(findBareGwLines("gw init  # get token T")).toHaveLength(1);
  });

  it("does not flag $GW invocation", () => {
    expect(findBareGwLines("`$GW slice add S1 --token T`")).toHaveLength(0);
  });

  it("does not flag GW= definition line", () => {
    expect(findBareGwLines('GW="bun /path/to/src/cli/main.ts"')).toHaveLength(0);
  });

  it("detects bare .ts path used as executable in backticks", () => {
    expect(findBareGwLines("`/path/to/src/cli/main.ts init`")).toHaveLength(1);
  });

  it("does not flag bun-prefixed .ts invocation", () => {
    expect(findBareGwLines("`bun /path/to/src/cli/main.ts init`")).toHaveLength(0);
  });

  it("does not flag .ts file reference with no trailing space", () => {
    expect(findBareGwLines("see `src/foo.ts` for details")).toHaveLength(0);
  });
});

describe("bare-gw — shipped agent, skill, and src files", () => {
  const agentFiles = collectFiles(path.join(ROOT, "agents"), ".md");
  const skillFiles = collectFiles(path.join(ROOT, "skills"), "SKILL.md");
  const srcFiles = collectFiles(path.join(ROOT, "src"), ".ts");
  const allFiles = [...agentFiles, ...skillFiles, ...srcFiles];

  it("shipped file set is non-empty", () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file);
    it(`${rel} has no bare gw invocations`, () => {
      const hits = findBareGwLines(readFileSync(file, "utf8"));
      if (hits.length > 0) {
        const msg = hits.map(h => `  line ${h.line}: ${h.text.slice(0, 100)}`).join("\n");
        expect(hits, `Bare gw invocations in ${rel}:\n${msg}`).toHaveLength(0);
      }
    });
  }
});
