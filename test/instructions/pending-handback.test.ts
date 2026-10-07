import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

describe("pending hand-back rule is stated where the parent handles child results", () => {
  for (const rel of ["skills/implement/SKILL.md", "agents/orchestrator.md"]) {
    it(`${rel} keys the pending rule on task-notification`, () => {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      const i = text.indexOf("Pending:");
      expect(i, `${rel}: missing "Pending:" rule`).toBeGreaterThanOrEqual(0);
      const line = text.slice(i, i + 300);
      expect(line).toContain("task-notification");
      expect(line).toContain("status: completed");
    });
  }
});
