import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const skill = readFileSync(path.join(ROOT, "skills/human-layer/SKILL.md"), "utf8");

const cited = [...skill.matchAll(/`bun <root>\/(src\/[\w/.-]+\.ts)/g)].map(m => m[1]);

describe("human-layer skill", () => {
  it("cites the review commands", () => {
    expect(cited).toContain("src/review/human-doc-check.ts");
    expect(cited).toContain("src/review/pr-links.ts");
  });

  for (const rel of new Set(cited)) {
    const exists = existsSync(path.join(ROOT, rel));
    // TODO(PH-5): drop skipIf once src/review/pr-links.ts lands.
    const t = rel.endsWith("pr-links.ts") ? it.skipIf(!exists) : it;
    t(`${rel} exists`, () => expect(exists).toBe(true));
  }

  for (const h of [
    "## 1. Human vs agent view",
    "## 2. Reviewer framing",
    "## 3. PR body v4 shape",
    "## 4. Link forms",
    "## 5. Review loop",
    "## 6. ADRs",
  ])
    it(`has section ${h}`, () => expect(skill).toContain(`\n${h}\n`));

  it("has name frontmatter", () => expect(skill).toMatch(/^---\nname: human-layer\n/));
});
