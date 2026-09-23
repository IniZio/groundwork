/**
 * By-path tests: spawn bun <root>/src/hooks/session-commit-msg-installer.ts
 * exactly as plugin.json invokes it. Also covers functional cases.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync, execSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/session-commit-msg-installer.ts");

function run(
  cwd: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart" }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: cwd, ...env },
    cwd: ROOT,
    timeout: 15_000,
  });
  return {
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
    exit: r.status ?? 1,
  };
}

function makeRepo(opts?: { coreHooksPath?: string }): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gw-sess-inst-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  if (opts?.coreHooksPath) {
    execSync(`git config core.hooksPath "${opts.coreHooksPath}"`, { cwd: dir, stdio: "pipe" });
  }
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: "pipe" });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function additionalContext(stdout: string): string {
  try {
    return (JSON.parse(stdout.trim()) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext ?? "";
  } catch {
    return "";
  }
}

describe("session-commit-msg-installer — by-path (entrypoint test)", () => {
  it("exits 0 always", () => {
    const { dir, cleanup } = makeRepo();
    try {
      const { exit } = run(dir);
      expect(exit).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("install: hook written, announced, bad commit blocked", () => {
    const { dir, cleanup } = makeRepo();
    try {
      const { stdout, exit } = run(dir);
      expect(exit).toBe(0);
      const ctx = additionalContext(stdout);
      expect(ctx.toLowerCase()).toContain("install");

      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      expect(existsSync(hookPath)).toBe(true);
      expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);

      const bad = spawnSync("git", ["commit", "--allow-empty", "-m", "bad message"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GROUNDWORK_COMMIT_LINT: undefined as unknown as string },
      });
      expect(bad.status).not.toBe(0);
    } finally {
      cleanup();
    }
  });

  it("idempotent: second run returns empty stdout (no announcement)", () => {
    const { dir, cleanup } = makeRepo();
    try {
      run(dir); // first install
      const { stdout, exit } = run(dir); // second run
      expect(exit).toBe(0);
      expect(additionalContext(stdout)).toBe("");
    } finally {
      cleanup();
    }
  });

  it("foreign hook: left byte-identical", () => {
    const { dir, cleanup } = makeRepo();
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const FOREIGN = "#!/bin/sh\necho foreign\nexit 0\n";
      writeFileSync(hookPath, FOREIGN, { mode: 0o755 });

      const { stdout, exit } = run(dir);
      expect(exit).toBe(0);
      expect(additionalContext(stdout)).toBe("");
      expect(readFileSync(hookPath, "utf8")).toBe(FOREIGN);
    } finally {
      cleanup();
    }
  });

  it("kill-switch GROUNDWORK_COMMIT_MSG_HOOK=0: nothing written, nothing announced", () => {
    const { dir, cleanup } = makeRepo();
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const { stdout, exit } = run(dir, { GROUNDWORK_COMMIT_MSG_HOOK: "0" });
      expect(exit).toBe(0);
      expect(additionalContext(stdout)).toBe("");
      expect(existsSync(hookPath)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("core.hooksPath set to non-existent dir: warns, no install", () => {
    const { dir, cleanup } = makeRepo({ coreHooksPath: "/tmp/gw-test-no-such-hooks-dir-xyzzy" });
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const { stdout, exit } = run(dir);
      expect(exit).toBe(0);
      expect(existsSync(hookPath)).toBe(false);
      const ctx = additionalContext(stdout);
      expect(ctx).toContain("core.hooksPath");
      expect(ctx).toContain("git config --unset core.hooksPath");
    } finally {
      cleanup();
    }
  });

  it("core.hooksPath set to existing dir: silent skip, no install", () => {
    const existingHooksDir = mkdtempSync(join(tmpdir(), "gw-test-hooks-exist-"));
    const { dir, cleanup } = makeRepo({ coreHooksPath: existingHooksDir });
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const { stdout, exit } = run(dir);
      expect(exit).toBe(0);
      expect(existsSync(hookPath)).toBe(false);
      expect(additionalContext(stdout)).toBe("");
    } finally {
      cleanup();
      rmSync(existingHooksDir, { recursive: true, force: true });
    }
  });

  it("not a git repo: clean no-op, exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-sess-inst-nongit-"));
    try {
      const { exit, stderr } = run(dir);
      expect(exit).toBe(0);
      expect(stderr.trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("embedded agent (CLAUDE_CODE_ENTRYPOINT=sdk-py): silent, nothing written", () => {
    const { dir, cleanup } = makeRepo();
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const { stdout, exit } = run(dir, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
      expect(exit).toBe(0);
      expect(stdout.trim()).toBe("");
      expect(existsSync(hookPath)).toBe(false);
    } finally {
      cleanup();
    }
  });
});
