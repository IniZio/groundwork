import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HASHED_PR_BODY_HEADINGS } from "../../src/cli/gate-status.js";

const repoRoot = join(import.meta.dir, "..", "..");
const template = readFileSync(join(repoRoot, "templates", "doc-types", "pr-body.md"), "utf8");
const lines = template.split("\n").map((l) => l.trimEnd());

describe("pr-body template / HASHED_PR_BODY_HEADINGS seam", () => {
  it("hashed heading list is non-empty", () => {
    expect(HASHED_PR_BODY_HEADINGS.length).toBeGreaterThan(0);
  });

  for (const h of HASHED_PR_BODY_HEADINGS) {
    it(`template has heading "## ${h}"`, () => {
      expect(lines).toContain(`## ${h}`);
    });
  }
});
