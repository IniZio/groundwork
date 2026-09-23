import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SKILL_PATH = path.join(ROOT, "skills/housekeep/SKILL.md");

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

  const REFS = ["deslop", "deps", "docs-staleness", "lint-debt"] as const;

  for (const ref of REFS) {
    it(`reference/${ref}.md exists`, () => {
      expect(existsSync(path.join(ROOT, `skills/housekeep/reference/${ref}.md`))).toBe(true);
    });
  }

  it("SKILL.md links only to reference files that exist", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const linked = [...content.matchAll(/`reference\/([^`]+)`/g)].map(m => m[1]);
    for (const fname of linked) {
      const full = path.join(ROOT, "skills/housekeep/reference", fname);
      expect(existsSync(full), `linked reference/${fname} does not exist`).toBe(true);
    }
  });
});
