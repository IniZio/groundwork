import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-subdir-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const baseEnv = (() => {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, XDG_CONFIG_HOME: path.join(tmp, "xdg"), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
})();

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: baseEnv, encoding: "utf8" });
const gw = (cwd: string, args: string[], env: Record<string, string> = baseEnv) => {
  const r = spawnSync("bun", [MAIN, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

let n = 0;
function repo() {
  const root = path.join(tmp, `r${n++}`);
  mkdirSync(path.join(root, "sub", "deep"), { recursive: true });
  git(root, "init", "-q");
  writeFileSync(path.join(root, "sub", "deep", "a.txt"), "a\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function linked() {
  const parent = repo();
  const child = path.join(tmp, `c${n++}`);
  expect(git(parent, "worktree", "add", "-q", "-b", `b${n}`, child).status).toBe(0);
  gw(parent, ["init"]);
  expect(gw(parent, ["motive", "add", "m1", "--use"]).code).toBe(0);
  expect(gw(parent, ["slice", "add", "S1"]).code).toBe(0);
  gw(child, ["init"]);
  expect(gw(parent, ["scope", "link", child, "--slice", "S1"]).code).toBe(0);
  return { parent, child, csub: path.join(child, "sub", "deep") };
}

describe("gw resolves repo base from a subdirectory", () => {
  it("slice status from subdir finds the root store", () => {
    const root = repo();
    gw(root, ["init"]);
    expect(gw(root, ["slice", "add", "S1"]).code).toBe(0);
    const r = gw(path.join(root, "sub", "deep"), ["slice", "status"]);
    expect(r.err).not.toContain("no work store");
    expect(r.code).toBe(0);
    expect(r.out).toContain("S1");
  });

  it("init from subdir initialises at toplevel, no nested .groundwork", () => {
    const root = repo();
    const sub = path.join(root, "sub", "deep");
    const r = gw(sub, ["init"]);
    expect(r.code).toBe(0);
    expect(existsSync(path.join(root, ".groundwork", "work.db"))).toBe(true);
    expect(existsSync(path.join(sub, ".groundwork"))).toBe(false);
    expect(readdirSync(path.join(root, "sub")).includes(".groundwork")).toBe(false);
  });

  it("linked child with uncommitted file: approve from subdir refused", () => {
    const { child, csub } = linked();
    writeFileSync(path.join(child, "dirty.txt"), "x\n");
    const r = gw(csub, ["gate", "approve", "--citation", "a.txt:1"]);
    expect(r.code).not.toBe(0);
    expect(r.err.toLowerCase()).toContain("uncommitted");
  });

  it("clean linked child: approve from subdir forwards to parent", () => {
    const { parent, csub } = linked();
    const r = gw(csub, ["gate", "approve", "--citation", "a.txt:1"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("forwarded to parent");
    expect(gw(parent, ["slice", "complete", "S1"]).code).toBe(0);
  });

  it("gate status --json from subdir reports scope child", () => {
    const { csub } = linked();
    const r = gw(csub, ["gate", "status", "--json"]);
    expect(JSON.parse(r.out).scope).toBe("child");
  });

  it("GROUNDWORK_DB still wins", () => {
    const root = repo();
    const other = path.join(tmp, "other", "work.db");
    const env = { ...baseEnv, GROUNDWORK_DB: other };
    expect(gw(path.join(root, "sub"), ["init"], env).code).toBe(0);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(path.join(root, ".groundwork", "work.db"))).toBe(false);
  });
});
