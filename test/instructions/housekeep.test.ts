import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SKILL_PATH = path.join(ROOT, "plugins/house-rules/skills/housekeep/SKILL.md");

describe("housekeep skill", () => {
  it("SKILL.md exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("SKILL.md has name frontmatter", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/^name:\s*housekeep/m);
  });

  it("SKILL.md has description frontmatter", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/^description:/m);
  });

  const REFS = ["deslop", "deps", "docs-staleness", "lint-debt", "conventions"] as const;

  for (const ref of REFS) {
    it(`reference/${ref}.md exists`, () => {
      expect(existsSync(path.join(ROOT, `plugins/house-rules/skills/housekeep/reference/${ref}.md`))).toBe(true);
    });
  }

  it("SKILL.md links only to reference files that exist", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const linked = [...content.matchAll(/`reference\/([^`]+)`/g)].map(m => m[1]);
    for (const fname of linked) {
      const full = path.join(ROOT, "plugins/house-rules/skills/housekeep/reference", fname);
      expect(existsSync(full), `linked reference/${fname} does not exist`).toBe(true);
    }
  });

  it("HTML-REPORT.md exists", () => {
    expect(existsSync(path.join(ROOT, "plugins/house-rules/skills/housekeep/HTML-REPORT.md"))).toBe(true);
  });

  it("SKILL.md references all 5 lens reference files", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const lensFiles = ["reference/deslop.md", "reference/deps.md", "reference/lint-debt.md", "reference/docs-staleness.md", "reference/conventions.md"];
    for (const f of lensFiles) {
      expect(content, `SKILL.md must reference ${f}`).toContain(f);
    }
  });

  it("SKILL.md contains 'Repo conventions' option label", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toContain("Repo conventions");
  });

  it("SKILL.md maps conventions to reference/conventions.md", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/`conventions`[^`]*`reference\/conventions\.md`/);
  });

  it("SKILL.md contains no mode-selection wording", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).not.toMatch(/housekeep deps/);
    expect(content).not.toMatch(/housekeep lint-debt/);
    expect(content).not.toMatch(/housekeep docs/);
    expect(content).not.toMatch(/housekeep all/);
  });

  it("SKILL.md contains AskUserQuestion", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toContain("AskUserQuestion");
  });

  const CONVENTIONS_PATH = path.join(ROOT, "plugins/house-rules/skills/housekeep/reference/conventions.md");

  it("reference/conventions.md does not mention 'gw conventions'", () => {
    const content = readFileSync(CONVENTIONS_PATH, "utf8");
    expect(content).not.toContain("gw conventions");
  });

  it("reference/conventions.md cites src/conventions/detect.ts", () => {
    const content = readFileSync(CONVENTIONS_PATH, "utf8");
    expect(content).toContain("src/conventions/detect.ts");
  });

  it("reference/conventions.md does not mention 'CLAUDE_PLUGIN_ROOT'", () => {
    const content = readFileSync(CONVENTIONS_PATH, "utf8");
    expect(content).not.toContain("CLAUDE_PLUGIN_ROOT");
  });
});
