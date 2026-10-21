import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, makeRepo, tempDir, runPluginHook, PLUGIN_ROOT } from "./commit-sandbox.js";

const MARKER = "# HOUSE-RULES-COMMIT-MSG";
const FOREIGN = "#!/bin/sh\necho custom hook\n";
const STALE_GROUNDWORK =
  '#!/bin/bash\n# GROUNDWORK-COMMIT-MSG v2.13.0\n# Managed by groundwork — do not edit.\nGROUNDWORK_HOOKS_LIB="/gone/hooks/lib"\n';

const install = (cwd: string) => runPluginHook("SessionStart", "install-commit-msg.ts", cwd, { source: "startup" });
const hookAt = (repo: string, dir = ".git/hooks") => join(repo, dir, "commit-msg");

function expectInstalled(file: string): void {
  const text = readFileSync(file, "utf8");
  expect(text.split("\n")).toContain(MARKER);
  expect(text).toContain(PLUGIN_ROOT);
  expect(statSync(file).mode & 0o111).not.toBe(0);
}

describe("commit-msg installer ownership", () => {
  test("absent hook is installed", () => {
    const repo = makeRepo();
    const r = install(repo);
    expect(r.exit).toBe(0);
    expectInstalled(hookAt(repo));
  });

  test("a second run leaves the hook byte-identical and prints nothing", () => {
    const repo = makeRepo();
    install(repo);
    const before = readFileSync(hookAt(repo), "utf8");
    const r = install(repo);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(hookAt(repo), "utf8")).toBe(before);
  });

  test("house-rules' own hook with a stale plugin path is rewritten", () => {
    const repo = makeRepo();
    writeFileSync(hookAt(repo), `#!/bin/sh\n${MARKER}\ncli='/old/house-rules/0.18.0/src/cli/lint-commit-msg.mjs'\n`, { mode: 0o755 });
    install(repo);
    expectInstalled(hookAt(repo));
    expect(readFileSync(hookAt(repo), "utf8")).not.toContain("/old/house-rules/0.18.0");
  });

  test("the old groundwork hook is replaced", () => {
    const repo = makeRepo();
    writeFileSync(hookAt(repo), STALE_GROUNDWORK, { mode: 0o755 });
    install(repo);
    expectInstalled(hookAt(repo));
    expect(readFileSync(hookAt(repo), "utf8")).not.toContain("GROUNDWORK");
  });

  test("a repo without .house-rules.json gets no hook and no output", () => {
    const repo = makeRepo(null);
    const r = install(repo);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(hookAt(repo))).toBe(false);
  });

  test("a repo without .house-rules.json loses a stale groundwork or house-rules hook", () => {
    for (const stale of [STALE_GROUNDWORK, `#!/bin/sh\n${MARKER}\ncli='/old/lint-commit-msg.mjs'\n`]) {
      const repo = makeRepo(null);
      writeFileSync(hookAt(repo), stale, { mode: 0o755 });
      const r = install(repo);
      expect(r.exit).toBe(0);
      expect(existsSync(hookAt(repo))).toBe(false);
      expect(r.stdout.trim().split("\n")).toHaveLength(1);
    }
  });

  test("a repo without .house-rules.json keeps a foreign hook and prints nothing", () => {
    const repo = makeRepo(null);
    writeFileSync(hookAt(repo), FOREIGN, { mode: 0o755 });
    const r = install(repo);
    expect(readFileSync(hookAt(repo), "utf8")).toBe(FOREIGN);
    expect(r.stdout).toBe("");
  });

  test("a foreign hook is left alone with one line on manual wiring", () => {
    const repo = makeRepo();
    writeFileSync(hookAt(repo), FOREIGN, { mode: 0o755 });
    const r = install(repo);
    expect(r.exit).toBe(0);
    expect(readFileSync(hookAt(repo), "utf8")).toBe(FOREIGN);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(r.stdout).toContain('house-rules lint-commit-msg "$1"');
  });

  test("core.hooksPath at a hook manager is left alone with one line on manual wiring", () => {
    for (const managed of [".husky/_", ".lefthook/hooks", ".pre-commit-hooks"]) {
      const repo = makeRepo();
      mkdirSync(join(repo, managed), { recursive: true });
      git(repo, ["config", "core.hooksPath", managed]);
      const r = install(repo);
      expect(r.exit).toBe(0);
      expect(existsSync(hookAt(repo, managed))).toBe(false);
      expect(existsSync(hookAt(repo))).toBe(false);
      expect(r.stdout.trim().split("\n")).toHaveLength(1);
      expect(r.stdout).toContain('house-rules lint-commit-msg "$1"');
    }
  });

  test("a plain core.hooksPath directory receives the hook", () => {
    const repo = makeRepo();
    git(repo, ["config", "core.hooksPath", "githooks"]);
    install(repo);
    expectInstalled(hookAt(repo, "githooks"));
    expect(existsSync(hookAt(repo))).toBe(false);
  });

  test("a linked worktree installs into the shared hooks dir", () => {
    const repo = makeRepo();
    const wt = join(tempDir("hr-commit-wt-"), "wt");
    expect(git(repo, ["worktree", "add", "-q", "-b", "side", wt]).status).toBe(0);
    install(wt);
    expectInstalled(hookAt(repo));
  });

  test("outside a git repo nothing is written or printed", () => {
    const dir = tempDir("hr-commit-nogit-");
    const r = install(dir);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(join(dir, ".git"))).toBe(false);
  });
});
