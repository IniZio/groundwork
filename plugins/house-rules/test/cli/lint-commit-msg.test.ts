import { describe, test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { makeRepo, GIT_ENV, PLUGIN_ROOT } from "../hooks/commit-sandbox.js";

function lint(repo: string, message: string) {
  const file = join(repo, "MSG");
  writeFileSync(file, message);
  return spawnSync(join(PLUGIN_ROOT, "bin/house-rules"), ["lint-commit-msg", file], {
    cwd: repo,
    env: GIT_ENV,
    encoding: "utf8",
  });
}

describe("house-rules lint-commit-msg", () => {
  test("a failing message exits 1 with the lint reason", () => {
    const r = lint(makeRepo(), "bad message\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("subject does not match type(scope)?: description");
  });

  test("a passing message exits 0", () => {
    expect(lint(makeRepo(), "fix: good message\n").status).toBe(0);
  });

  test("a repo without .house-rules.json exits 0", () => {
    expect(lint(makeRepo(null), "bad message\n").status).toBe(0);
  });

  test("an invalid .house-rules.json exits 0", () => {
    expect(lint(makeRepo({ rules: { "commit-message": "off" } }), "bad message\n").status).toBe(0);
  });
});
