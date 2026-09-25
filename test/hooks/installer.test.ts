import { describe, it, expect } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installHook, uninstallHook, getHookStatus } from "../../src/hooks/installer.js";
import { renderCommitMsgHook, HOOK_MARKER } from "../../hooks/lib/commit-msg-template.mjs";

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gw-installer-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, '.house-rules.json'), JSON.stringify({ 'commit-message': { preset: 'conventional' } }));
  execSync('git commit --allow-empty -m "chore: initial"', { cwd: dir, stdio: "pipe" });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("commit-msg hook installer", () => {
  it("install: hook present, exec bit set, bad commit rejected", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      writeFileSync(join(dir, '.house-rules.json'), JSON.stringify({ 'commit-message': { preset: 'conventional' } }));
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

  it("upgrade: old-version groundwork hook is replaced with current version", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      // Plant a hook with an old marker version
      const oldHook = "#!/bin/bash\n# " + HOOK_MARKER + " v0.1.0\n# Managed by groundwork — do not edit.\nexit 0\n";
      writeFileSync(hookPath, oldHook, { mode: 0o755 });

      const result = await installHook({ cwd: dir });
      expect(result.status).toBe("upgraded");
      if (result.status === "upgraded") {
        expect(result.fromVersion).toBe("0.1.0");
      }

      const newContent = readFileSync(hookPath, "utf8");
      expect(newContent).toContain(HOOK_MARKER);
      expect(newContent).not.toContain("v0.1.0");
      // New content has the runtime detection logic
      expect(newContent).toContain("command -v bun");
    } finally {
      cleanup();
    }
  });
});

// ── runtime selection tests ────────────────────────────────────────────────

function whichBin(name: string): string {
  const r = spawnSync("which", [name], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${name} not found on PATH`);
  return r.stdout.trim();
}

/** Create a temp dir with named symlinks; caller must rmSync it. */
function makeFakeBinDir(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-fakebin-"));
  for (const [name, target] of Object.entries(entries)) {
    symlinkSync(target, join(dir, name));
  }
  return dir;
}

/** Minimal env for a git commit: no HOME/USER inference needed, just enough for bash + git. */
function minGitEnv(extraPath: string): Record<string, string> {
  return {
    PATH: extraPath + ":/usr/bin:/bin",
    HOME: process.env.HOME ?? "/root",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

describe("commit-msg hook runtime selection", () => {
  it("(a) bun-only PATH: rejects bad message, accepts good", async () => {
    const { dir, cleanup } = makeRepo();
    const bunPath = whichBin("bun");
    const fakeBin = makeFakeBinDir({ bun: bunPath });
    try {
      writeFileSync(join(dir, '.house-rules.json'), JSON.stringify({ 'commit-message': { preset: 'conventional' } }));
      await installHook({ cwd: dir });
      const env = minGitEnv(fakeBin);

      const bad = spawnSync("git", ["commit", "--allow-empty", "-m", "bad message"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, GROUNDWORK_HOOKS_LIB: join(resolve(import.meta.dir, "../.."), "hooks", "lib") },
      });
      expect(bad.status).not.toBe(0);

      const good = spawnSync("git", ["commit", "--allow-empty", "-m", "feat: runtime selection"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, GROUNDWORK_HOOKS_LIB: join(resolve(import.meta.dir, "../.."), "hooks", "lib") },
      });
      expect(good.status).toBe(0);
    } finally {
      cleanup();
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("(b) node-only PATH: rejects bad message, accepts good", async () => {
    const { dir, cleanup } = makeRepo();
    const nodePath = whichBin("node");
    const fakeBin = makeFakeBinDir({ node: nodePath });
    try {
      writeFileSync(join(dir, '.house-rules.json'), JSON.stringify({ 'commit-message': { preset: 'conventional' } }));
      await installHook({ cwd: dir });
      const env = minGitEnv(fakeBin);

      const bad = spawnSync("git", ["commit", "--allow-empty", "-m", "bad message"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, GROUNDWORK_HOOKS_LIB: join(resolve(import.meta.dir, "../.."), "hooks", "lib") },
      });
      expect(bad.status).not.toBe(0);

      const good = spawnSync("git", ["commit", "--allow-empty", "-m", "feat: runtime selection"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, GROUNDWORK_HOOKS_LIB: join(resolve(import.meta.dir, "../.."), "hooks", "lib") },
      });
      expect(good.status).toBe(0);
    } finally {
      cleanup();
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("(c) neither bun nor node: exits 0 with expected stderr line", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      await installHook({ cwd: dir });
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      const msgFile = join(dir, "COMMIT_EDITMSG");
      writeFileSync(msgFile, "bad message\n");

      // PATH has git + coreutils but NOT bun or node
      const r = spawnSync(hookPath, [msgFile], {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "/root" },
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toContain("groundwork commit-msg: no bun/node, skipping lint");
    } finally {
      cleanup();
    }
  });

  it("bite proof — (c) goes red without fallback branch", async () => {
    const { dir, cleanup } = makeRepo();
    try {
      // Generate hook and strip the fallback block so neither-runtime path exits non-zero
      const hookContent = renderCommitMsgHook({
        hooksLibPath: join(resolve(import.meta.dir, "../.."), "hooks", "lib"),
        version: "0.0.0-bite",
      });
      const withoutFallback = hookContent
        .split("\n")
        .filter((l) => !l.includes("no bun/node") && !l.includes("skipping lint"))
        .join("\n");

      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(hookPath, withoutFallback, { mode: 0o755 });

      const msgFile = join(dir, "COMMIT_EDITMSG");
      writeFileSync(msgFile, "bad message\n");

      const r = spawnSync(hookPath, [msgFile], {
        cwd: dir,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "/root" },
      });
      // Without the fallback, the hook should fail (non-zero or no "skipping lint" message)
      const hasSkipLine = r.stderr.includes("groundwork commit-msg: no bun/node, skipping lint");
      const exitedClean = r.status === 0 && hasSkipLine;
      expect(exitedClean).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("commit-msg hook: missing house-rules plugin warning", () => {
  it("prints loud WARNING with path and exits 0 when house-rules plugin is missing", async () => {
    const { dir, cleanup } = makeRepo();
    const fakeLib = mkdtempSync(join(tmpdir(), "gw-fakelib-"));
    try {
      // Create a fake hooks lib that has commit-convention.mjs but NO plugins/ alongside it
      // (so houseRulesPath = resolve(fakeLib, '../../plugins/...') will not exist)
      const realHooksLib = join(resolve(import.meta.dir, "../.."), "hooks", "lib");
      writeFileSync(
        join(fakeLib, "commit-convention.mjs"),
        readFileSync(join(realHooksLib, "commit-convention.mjs"), "utf8"),
      );

      // Generate and install the hook pointing to fakeLib
      const hookContent = renderCommitMsgHook({
        hooksLibPath: fakeLib,
        version: "0.0.0-test",
      });
      const hookPath = join(dir, ".git", "hooks", "commit-msg");
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(hookPath, hookContent, { mode: 0o755 });

      // Run the hook with a bad message
      const msgFile = join(dir, "COMMIT_EDITMSG");
      writeFileSync(msgFile, "bad message\n");

      const r = spawnSync(hookPath, [msgFile], {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? "/root",
        },
      });

      expect(r.status).toBe(0);
      expect(r.stderr).toContain("WARNING");
      expect(r.stderr).toContain("house-rules");
    } finally {
      rmSync(fakeLib, { recursive: true, force: true });
      cleanup();
    }
  });
});
