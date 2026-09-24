import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { check } from "../../src/hooks/guard.js";

function write(filePath: string, content: string) {
  return { tool_name: "Write", tool_input: { file_path: filePath, content } };
}

function edit(filePath: string, old_string: string, new_string: string) {
  return { tool_name: "Edit", tool_input: { file_path: filePath, old_string, new_string } };
}

function getHso(r: { stdout: string }): Record<string, unknown> {
  if (!r.stdout.trim()) return {};
  const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
  return (parsed.hookSpecificOutput as Record<string, unknown>) ?? {};
}

function makeGitRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guard-stray-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
  }
});

describe("guard stray-artifacts check", () => {
  it("Write docs/x.md in repo with doc/ → deny naming doc/", async () => {
    const dir = makeGitRepo({ "doc/readme.md": "# doc" });
    tmpDirs.push(dir);
    const filePath = path.join(dir, "docs", "x.md");
    const r = await check({ ...write(filePath, "# x"), cwd: dir });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso.permissionDecision).toBe("deny");
    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("doc/");
  });

  it("Write root test-foo.mjs → deny (root scratch file)", async () => {
    const dir = makeGitRepo({ "src/index.ts": "export {};" });
    tmpDirs.push(dir);

    const filePath = path.join(dir, "test-foo.mjs");
    const r = await check({ ...write(filePath, "export const x = 1;"), cwd: dir });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso.permissionDecision).toBe("deny");
  });

  it("Write doc/x.md in repo with doc/ → allow (canonical dir)", async () => {
    const dir = makeGitRepo({ "doc/readme.md": "# doc" });
    tmpDirs.push(dir);

    const filePath = path.join(dir, "doc", "x.md");
    const r = await check({ ...write(filePath, "# x"), cwd: dir });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso.permissionDecision).toBeUndefined();
  });

  it("Edit existing tracked docs/old.md → not denied by stray (existing file)", async () => {
    // pre !== null → stray check skipped even for non-canonical dir
    const dir = makeGitRepo({ "docs/old.md": "# old content\n" });
    tmpDirs.push(dir);

    const filePath = path.join(dir, "docs", "old.md");
    const r = await check({ ...edit(filePath, "# old content", "# new content"), cwd: dir });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso.permissionDecision).toBeUndefined();
  });
});
