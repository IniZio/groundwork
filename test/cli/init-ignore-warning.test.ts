import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-init-ignore-warn-"));
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

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 15000 });
}
const git = (cwd: string, ...a: string[]) => run("git", a, cwd);
const init = (cwd: string) => run("bun", [MAIN, "init"], cwd);

function makeRepo(name: string, gitignore?: string, commit = false): string {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  git(d, "init", "-q");
  if (gitignore !== undefined) {
    writeFileSync(path.join(d, ".gitignore"), gitignore);
    if (commit) {
      git(d, "add", ".gitignore");
      expect(git(d, "commit", "-qm", "ignore").status).toBe(0);
    }
  }
  return d;
}
const WARN = "warning: no committed .gitignore rule covers .groundwork/";

describe("gw init warns when no committed ignore rule covers .groundwork/", () => {
  it("(a) no .gitignore: warns, info/exclude still written, no .gitignore created", () => {
    const d = makeRepo("a");
    const r = init(d);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(WARN);
    expect(readFileSync(path.join(d, ".git/info/exclude"), "utf8")).toContain(".groundwork/");
    expect(existsSync(path.join(d, ".gitignore"))).toBe(false);
  });

  it("(b) committed .gitignore with .groundwork/: silent, bytes unchanged", () => {
    const d = makeRepo("b", ".groundwork/\n", true);
    const before = readFileSync(path.join(d, ".gitignore"));
    const r = init(d);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain(WARN);
    expect(readFileSync(path.join(d, ".gitignore")).equals(before)).toBe(true);
  });

  it("(c) untracked .gitignore with .groundwork/: warns, bytes unchanged", () => {
    const d = makeRepo("c", ".groundwork/\n", false);
    const before = readFileSync(path.join(d, ".gitignore"));
    const r = init(d);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(WARN);
    expect(readFileSync(path.join(d, ".gitignore")).equals(before)).toBe(true);
  });

  it("(d) committed .gitignore with !.groundwork/: warns, bytes unchanged", () => {
    const d = makeRepo("d", "!.groundwork/\n", true);
    const before = readFileSync(path.join(d, ".gitignore"));
    const r = init(d);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(WARN);
    expect(readFileSync(path.join(d, ".gitignore")).equals(before)).toBe(true);
  });
});
