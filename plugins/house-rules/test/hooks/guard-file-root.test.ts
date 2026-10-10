import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileDirRoot } from "../../src/hooks/guard.js";

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}
function gitAnswer(file: string): string | null {
  const r = spawnSync("git", ["-C", path.dirname(file), "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

describe("fileDirRoot matches git rev-parse --show-toplevel", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "fdr-")));
  git(root, "init", "-q");
  mkdirSync(path.join(root, "a/b"), { recursive: true });
  mkdirSync(path.join(root, "sub"), { recursive: true });
  git(path.join(root, "sub"), "init", "-q");
  mkdirSync(path.join(root, "sub/deep"), { recursive: true });
  const cases: Record<string, string> = {
    "plain nested file": path.join(root, "a/b/x.ts"),
    "file under .git/hooks": path.join(root, ".git/hooks/x"),
    "file in nested repo": path.join(root, "sub/deep/y.ts"),
  };
  for (const [name, file] of Object.entries(cases)) {
    it(name, () => {
      writeFileSync(file, "");
      expect(fileDirRoot(file, root)).toBe(gitAnswer(file));
    });
  }
  it("under .git answers null like git", () => {
    expect(fileDirRoot(cases["file under .git/hooks"]!, root)).toBeNull();
  });
});
