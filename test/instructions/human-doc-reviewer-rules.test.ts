import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const doc = readFileSync(
  path.resolve(import.meta.dir, "../../agents/human-doc-reviewer.md"),
  "utf8",
);

describe("human-doc-reviewer rules", () => {
  it("flags Decisions table in a new codebase or module", () => {
    expect(doc).toMatch(/`### Decisions` table in a PR adding a new codebase or module/);
  });
  it("flags dev-journal framing", () => {
    expect(doc).toMatch(/dev-journal framing/);
    expect(doc).toMatch(/plans, sessions/);
  });
  it("human-view exception covers pr/ files and pr-body.md", () => {
    expect(doc).toContain(".groundwork/work/*/pr-body.md");
    expect(doc).toContain(".groundwork/work/*/pr/*");
  });
});
