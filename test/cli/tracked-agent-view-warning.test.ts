import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-tracked-warn-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  XDG_CONFIG_HOME: path.join(root, "xdg"),
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
} as Record<string, string>;
delete env.GROUNDWORK_DB;
delete env.CLAUDE_PROJECT_DIR;

const WARNING = "warning: 1 agent-view file(s) under .groundwork/ are tracked by git; untrack with: git rm -r --cached .groundwork, then a plain git commit (not git commit -- <path>, which re-adds them)\n";

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 15000 });
}
const git = (cwd: string, ...a: string[]) => run("git", a, cwd);
const gw = (cwd: string, ...a: string[]) => run("bun", [MAIN, ...a], cwd);

function makeRepo(name: string, tracked: boolean): string {
  const d = path.join(root, name);
  mkdirSync(path.join(d, ".groundwork/work/x"), { recursive: true });
  git(d, "init", "-q");
  writeFileSync(path.join(d, ".groundwork/work/x/motive.md"), "x\n");
  if (tracked) {
    git(d, "add", "-f", ".groundwork/work/x/motive.md");
    expect(git(d, "commit", "-qm", "track").status).toBe(0);
  }
  return d;
}

describe("tracked agent-view warning", () => {
  it("(a) init and compile warn with N=1 when a .groundwork file is tracked", () => {
    const d = makeRepo("tracked", true);
    const i = gw(d, "init");
    expect(i.status).toBe(0);
    expect(i.stderr).toBe(WARNING);
    const c = gw(d, "compile");
    expect(c.status).toBe(0);
    expect(c.stderr).toBe(WARNING);
    expect(git(d, "ls-files", "--", ".groundwork").stdout.trim()).toBe(".groundwork/work/x/motive.md");
  });

  it("(b) no warning when .groundwork files are only untracked", () => {
    const d = makeRepo("clean", false);
    const i = gw(d, "init");
    expect(i.status).toBe(0);
    expect(i.stderr).toBe("");
    const c = gw(d, "compile");
    expect(c.status).toBe(0);
    expect(c.stderr).toBe("");
  });

  it("(c) compile --json stdout stays valid JSON; warning on stderr", () => {
    const d = makeRepo("json", true);
    expect(gw(d, "init").status).toBe(0);
    const c = gw(d, "compile", "--json");
    expect(c.status).toBe(0);
    expect(() => JSON.parse(c.stdout)).not.toThrow();
    expect(c.stderr).toBe(WARNING);
  });
});
