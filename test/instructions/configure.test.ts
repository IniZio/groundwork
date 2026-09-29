import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { resolveConfigText } from "../../plugins/house-rules/src/config/resolve.mjs";
import { matchPath } from "../../plugins/house-rules/src/config/manifest.mjs";
import { scaffold, renderStructure } from "../../plugins/house-rules/src/config/structure.mjs";
import { parseFrontmatter, validateFrontmatter, missingHeadings } from "../../plugins/house-rules/src/engine/frontmatter.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const SKILL_PATH = path.join(ROOT, "plugins/house-rules/skills/configure/SKILL.md");
const SCHEMA_URL =
  "https://raw.githubusercontent.com/IniZio/groundwork/main/plugins/house-rules/house-rules.schema.json";
const README_PATH = path.join(ROOT, "plugins/house-rules/README.md");
const FORBIDDEN = /kill.?switch|bypass|GROUNDWORK_|--no-verify|disable/i;

describe("configure skill", () => {
  it("SKILL.md exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("SKILL.md has name frontmatter", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toMatch(/^name:\s*configure\s*$/m);
  });

  it("SKILL.md stays model-invocable", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).not.toContain("disable-model-invocation");
  });

  it("SKILL.md tells the agent to run house-rules config", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toContain("house-rules config");
  });

  it("SKILL.md cites the published schema URL", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toContain(SCHEMA_URL);
  });

  it("SKILL.md shows pinning a preset in .house-rules.json", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toContain('"preset"');
    expect(content).toContain(".house-rules.json");
  });

  it("SKILL.md states loosening is a human decision", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/human decision/i);
    expect(content).toMatch(/ask the user/i);
  });

  it("SKILL.md drops the removed max_per_100 option", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).not.toContain("max_per_100");
  });

  it("SKILL.md advertises no off/warn severity", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).not.toMatch(/["`]off["`]|["`]warn["`]/);
    expect(content).not.toMatch(/\b(loosen|tighten)/i);
  });

  it("SKILL.md states comment-density accepts error only and is not configurable", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/`comment-density`: `"error"` only.*not configurable/);
  });

  it("SKILL.md no longer calls artifact-structure unconfigurable", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const line = content.split("\n").find((l) => l.startsWith("- `artifact-structure`"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/no options|not configurable/);
    for (const key of ["govern", "types", "forbidden"]) expect(line).toContain(`\`${key}\``);
    expect(content).toContain("`stray-artifacts`");
  });

  it("SKILL.md teaches no escape route", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).not.toMatch(FORBIDDEN);
  });

  it("escape-route regex matches a known-bad sentence (positive control)", () => {
    const sample = "Set GROUNDWORK_X=1 or use --no-verify to bypass the hook.";
    expect(sample).toMatch(FORBIDDEN);
  });
});

function jsonBlocks(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
}

function manifestExample(file: string) {
  const block = jsonBlocks(file).find((b) => b.includes('"types"'));
  expect(block).toBeDefined();
  return resolveConfigText("/nonexistent", block!).rules["artifact-structure"].options;
}

function decisionType(opts: ReturnType<typeof manifestExample>) {
  expect(opts.types).toBeDefined();
  const def = opts.types?.decision;
  expect(def).toBeDefined();
  if (!opts.types || !def) throw new Error("decision type missing from example");
  return def;
}

describe("artifact-structure manifest examples", () => {
  for (const [name, file] of [["README", README_PATH], ["SKILL.md", SKILL_PATH]] as const) {
    it(`${name} example resolves to a usable manifest`, () => {
      const opts = manifestExample(file);
      expect(decisionType(opts).generates).toBe("doc/decisions/{slug:kebab}.md");
      expect(matchPath("doc/decisions/use-bun.md", opts)?.type).toBe("decision");
      expect(matchPath("doc/decisions/Use Bun.md", opts)).toBeNull();
      expect(renderStructure(opts).join("\n")).toContain("forbidden: docs/**");
    });
  }

  it("README example scaffolds a file that satisfies its own frontmatter and headings", () => {
    const opts = manifestExample(README_PATH);
    const out = scaffold("decision", { slug: "Use Bun", title: "Use Bun" }, opts, "2026-01-02");
    expect(out.path).toBe("doc/decisions/use-bun.md");
    const decision = decisionType(opts);
    const { frontmatter, headings } = decision;
    expect(frontmatter).toBeDefined();
    expect(headings).toBeDefined();
    if (!frontmatter || !headings) throw new Error("example decision lacks frontmatter or headings");
    const parsed = parseFrontmatter(out.content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateFrontmatter(frontmatter, parsed.data ?? {})).toEqual([]);
    expect(missingHeadings(parsed.body, headings)).toEqual([]);
    expect(validateFrontmatter(frontmatter, { title: "x", status: "bogus" }).length).toBeGreaterThan(0);
  });

  it("README documents the manifest keys, placeholders, commands and ignore semantics", () => {
    const readme = readFileSync(README_PATH, "utf8");
    for (const t of ["tier", "generates", "description", "instruction", "template", "frontmatter", "headings"]) {
      expect(readme).toContain(`- \`${t}\`:`);
    }
    for (const t of ["`govern`", "`forbidden`", "{name:kebab}", "{name:camel}", "{name:pascal}", "`stray-artifacts`", "house-rules structure", "house-rules where <type|text>", "house-rules new <type> key=value"]) {
      expect(readme).toContain(t);
    }
    expect(readme).toContain("enforced even when the file is gitignored or excluded");
    expect(readme).not.toMatch(/artifact-structure \| severity `error` only; no options/);
  });
});
