import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HASHED_PR_BODY_HEADINGS = ["Summary", "Why", "Changes", "Impact"] as const;
const repoRoot = join(import.meta.dir, "..", "..");
const template = readFileSync(join(repoRoot, "templates", "doc-types", "pr-body.md"), "utf8");
const lines = template.split("\n").map((l) => l.trimEnd());

describe("pr-body template / HASHED_PR_BODY_HEADINGS seam", () => {
  it("hashed heading list is non-empty", () => {
    expect(HASHED_PR_BODY_HEADINGS.length).toBeGreaterThan(0);
  });

  it("hashed headings equal the template's level-2 headings before '## Review focus'", () => {
    const reviewIdx = lines.indexOf("## Review focus");
    expect(reviewIdx).toBeGreaterThan(-1);
    const before = lines
      .slice(0, reviewIdx)
      .filter((l) => l.startsWith("## "))
      .map((l) => l.slice(3));
    expect(before).toEqual([...HASHED_PR_BODY_HEADINGS]);
  });

  for (const h of HASHED_PR_BODY_HEADINGS) {
    it(`template has heading "## ${h}"`, () => {
      expect(lines).toContain(`## ${h}`);
    });
  }
});
