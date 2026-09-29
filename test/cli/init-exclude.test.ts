import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-init-exclude-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Isolate user git config and the token/seal config dir (XDG_CONFIG_HOME).
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  XDG_CONFIG_HOME: path.join(root, "xdg"),
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
} as Record<string, string>;
delete env.GROUNDWORK_DB;

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 15000 });
}
const git = (cwd: string, ...a: string[]) => run("git", a, cwd);
const init = (cwd: string) => run("bun", [MAIN, "init"], cwd);
const porcelain = (cwd: string) => git(cwd, "status", "--porcelain", "-uall").stdout;

function makeRepo(name: string): string {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  git(d, "init", "-q");
  return d;
}
function touchWorkingFile(d: string) {
  mkdirSync(path.join(d, ".groundwork"), { recursive: true });
  writeFileSync(path.join(d, ".groundwork", "x.md"), "x\n");
}
const count = (file: string) =>
  readFileSync(file, "utf8").split("\n").filter(l => l.trim() === ".groundwork/").length;

describe("gw init excludes the working tier", () => {
  it("AC1: untracked file shows before init, hidden after; one exclude line", () => {
    const d = makeRepo("ac1");
    touchWorkingFile(d);
    expect(porcelain(d)).toContain(".groundwork/");
    const r = init(d);
    expect(r.status).toBe(0);
    expect(count(path.join(d, ".git/info/exclude"))).toBe(1);
    expect(porcelain(d)).not.toContain(".groundwork");
  });

  it("AC2: re-running init keeps exactly one line", () => {
    const d = makeRepo("ac2");
    init(d);
    init(d);
    init(d);
    expect(count(path.join(d, ".git/info/exclude"))).toBe(1);
  });

  it("AC3: .gitignore byte-identical when present, stays absent when absent", () => {
    const a = makeRepo("ac3-present");
    writeFileSync(path.join(a, ".gitignore"), "node_modules\n");
    const before = readFileSync(path.join(a, ".gitignore"));
    init(a);
    expect(readFileSync(path.join(a, ".gitignore")).equals(before)).toBe(true);

    const b = makeRepo("ac3-absent");
    init(b);
    expect(existsSync(path.join(b, ".gitignore"))).toBe(false);
  });

  it("AC4: linked worktree writes to git-path info/exclude", () => {
    const main = makeRepo("ac4-main");
    writeFileSync(path.join(main, "f"), "f\n");
    git(main, "add", "f");
    git(main, "commit", "-qm", "init");
    const wt = path.join(root, "ac4-wt");
    expect(git(main, "worktree", "add", "-q", wt).status).toBe(0);
    expect(existsSync(path.join(wt, ".git")) && !existsSync(path.join(wt, ".git", "info"))).toBe(true);
    touchWorkingFile(wt);
    expect(init(wt).status).toBe(0);
    const target = path.resolve(wt, git(wt, "rev-parse", "--git-path", "info/exclude").stdout.trim());
    expect(count(target)).toBe(1);
    expect(porcelain(wt)).not.toContain(".groundwork");
  });

  it("AC5: non-git dir exits 0 and prints a note", () => {
    const d = path.join(root, "nogit");
    mkdirSync(d, { recursive: true });
    const r = init(d);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("note: not a git repository");
  });
});
