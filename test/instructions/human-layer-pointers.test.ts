import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("human-facing rules live in groundwork:human-layer", () => {
  for (const rel of ["skills/motive/SKILL.md", "skills/implement/SKILL.md"]) {
    const text = read(rel);
    it(`${rel} points to groundwork:human-layer`, () => {
      expect(text).toContain("groundwork:human-layer");
    });
    it(`${rel} no longer restates the review loop`, () => {
      expect(text).not.toContain("human-doc-check.ts");
      expect(text).not.toContain("groundwork:human-doc-reviewer");
      expect(text).not.toContain("status: PASS");
      expect(text).not.toContain("templates/doc-types/pr-body.md");
    });
  }
  it("vertical-slice points to groundwork:human-layer", () => {
    expect(read("skills/vertical-slice/SKILL.md")).toContain("groundwork:human-layer");
  });
});
