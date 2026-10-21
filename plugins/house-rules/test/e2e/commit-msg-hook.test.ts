import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { git, makeRepo, runPluginHook, tempDir, GIT_ENV, PLUGIN_ROOT } from "../hooks/commit-sandbox.js";

const BAD = "bad message";
const GOOD = "fix: good message";

let repo: string;

beforeAll(() => {
  repo = makeRepo();
  expect(runPluginHook("SessionStart", "install-commit-msg.ts", repo, { source: "startup" }).exit).toBe(0);
  writeFileSync(join(repo, "bad.txt"), `${BAD}\n`);
  writeFileSync(join(repo, "good.txt"), `${GOOD}\n`);
});

const commit = (args: string[], input?: string) => git(repo, ["commit", "--allow-empty", ...args], input);

describe("installed commit-msg hook gates real git commits", () => {
  test("git commit -m", () => {
    const bad = commit(["-m", BAD]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("subject does not match type(scope)?: description");
    expect(commit(["-m", GOOD]).status).toBe(0);
  });

  test("git commit -F <file>", () => {
    expect(commit(["-F", "bad.txt"]).status).not.toBe(0);
    expect(commit(["-F", "good.txt"]).status).toBe(0);
  });

  test("git commit -F -", () => {
    expect(commit(["-F", "-"], `${BAD}\n`).status).not.toBe(0);
    expect(commit(["-F", "-"], `${GOOD}\n`).status).toBe(0);
  });

  test("git commit --amend -m", () => {
    const bad = git(repo, ["commit", "--amend", "--allow-empty", "-m", BAD]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("subject does not match");
    expect(git(repo, ["commit", "--amend", "--allow-empty", "-m", GOOD]).status).toBe(0);
  });

  test("core.commentChar lines are dropped under commit.cleanup=strip and kept otherwise", () => {
    writeFileSync(join(repo, "commented.txt"), `${GOOD}\n\n; a note\n`);
    const strip = ["-c", "core.commentChar=;", "-c", "commit.cleanup=strip"];
    expect(git(repo, [...strip, "commit", "--allow-empty", "-F", "commented.txt"]).status).toBe(0);
    expect(git(repo, ["-c", "core.commentChar=;", "commit", "--allow-empty", "-F", "commented.txt"]).status).not.toBe(0);
  });

  test("commit.cleanup=scissors cuts the message at the scissors line", () => {
    writeFileSync(join(repo, "scissors.txt"), `${GOOD}\n# ------------------------ >8 ------------------------\nbelow the cut\n`);
    expect(git(repo, ["-c", "commit.cleanup=scissors", "commit", "--allow-empty", "-F", "scissors.txt"]).status).toBe(0);
  });

  test("the next session repoints a hook whose plugin path is gone", () => {
    const other = makeRepo();
    const hook = join(other, ".git/hooks/commit-msg");
    runPluginHook("SessionStart", "install-commit-msg.ts", other, { source: "startup" });
    writeFileSync(hook, readFileSync(hook, "utf8").replaceAll(PLUGIN_ROOT, "/gone/house-rules"));
    const skipped = git(other, ["commit", "--allow-empty", "-m", BAD]);
    expect(skipped.status).toBe(0);
    expect(skipped.stderr.trim().split("\n")).toHaveLength(1);
    runPluginHook("SessionStart", "install-commit-msg.ts", other, { source: "startup" });
    expect(git(other, ["commit", "--allow-empty", "-m", BAD]).status).not.toBe(0);
  });

  test("the hook runs under node when bun is absent", () => {
    const bin = tempDir("hr-commit-bin-");
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    symlinkSync(Bun.which("node")!, join(bin, "node"));
    const env = { ...GIT_ENV, PATH: bin };
    const run = (msg: string) => spawnSync("git", ["commit", "--allow-empty", "-m", msg], { cwd: repo, env, encoding: "utf8" });
    expect(run(BAD).status).not.toBe(0);
    expect(run(GOOD).status).toBe(0);
  });

  test("with neither bun nor node the hook skips with a one-line notice", () => {
    const bin = tempDir("hr-commit-bin-");
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    const r = spawnSync("git", ["commit", "--allow-empty", "-m", BAD], {
      cwd: repo,
      env: { ...GIT_ENV, PATH: bin },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });
});
