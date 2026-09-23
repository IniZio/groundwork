import { describe, it, expect } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHook, uninstallHook, getHookStatus } from "../../src/hooks/installer.js";

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gw-installer-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: "pipe" });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("commit-msg hook installer", () => {
  it("install: hook present, exec bit set, bad commit rejected", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const result = await installHook({ cwd: dir });
      expect(result.status).toBe("installed");

      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      expect(existsSync(hookPath)).toBe(true);
      expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);

      const bad = spawnSync("git", ["commit", "--allow-empty", "-m", "bad message"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GROUNDWORK_COMMIT_LINT: undefined as unknown as string },
      });
      expect(bad.status).not.toBe(0);

      const good = spawnSync("git", ["commit", "--allow-empty", "-m", "feat: add feature"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(good.status).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("idempotent: second install returns already-current, file byte-identical", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const first = await installHook({ cwd: dir });
      expect(first.status).toBe("installed");

      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const before = readFileSync(hookPath, "utf8");

      const second = await installHook({ cwd: dir });
      expect(second.status).toBe("already-current");

      const after = readFileSync(hookPath, "utf8");
      expect(after).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("foreign hook: left untouched — byte-identical after install attempt", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const hooksDir = join(dir, ".git", "hooks");
      mkdirSync(hooksDir, { recursive: true });
      const hookPath = join(hooksDir, "commit-msg");
      const FOREIGN = "#!/bin/sh\necho 'foreign'\nexit 0\n";
      writeFileSync(hookPath, FOREIGN);

      // BITE PROOF: naive overwrite changes the file
      writeFileSync(hookPath, "#!/bin/sh\necho clobbered\n");
      expect(readFileSync(hookPath, "utf8")).not.toBe(FOREIGN);
      writeFileSync(hookPath, FOREIGN); // restore

      const result = await installHook({ cwd: dir });
      expect(result.status).toBe("skipped-foreign");
      // Foreign hook content unchanged
      expect(readFileSync(hookPath, "utf8")).toBe(FOREIGN);
    } finally {
      cleanup();
    }
  });

  it("getHookStatus: none before install, ours after", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const before = await getHookStatus({ cwd: dir });
      expect(before.status).toBe("none");

      await installHook({ cwd: dir });

      const after = await getHookStatus({ cwd: dir });
      expect(after.status).toBe("ours");
    } finally {
      cleanup();
    }
  });

  it("uninstall: removes our hook, leaves foreign hook intact", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      await installHook({ cwd: dir });
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      expect(existsSync(hookPath)).toBe(true);

      const removed = await uninstallHook({ cwd: dir });
      expect(removed.status).toBe("removed");
      expect(existsSync(hookPath)).toBe(false);

      // Foreign hook not removed
      const FOREIGN = "#!/bin/sh\necho foreign\n";
      writeFileSync(hookPath, FOREIGN);
      const skipped = await uninstallHook({ cwd: dir });
      expect(skipped.status).toBe("skipped-foreign");
      expect(readFileSync(hookPath, "utf8")).toBe(FOREIGN);
    } finally {
      cleanup();
    }
  });
});
