import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync, symlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePointer, serializePointer, sameRoot } from "../../src/store/scope-pointer.js";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-nswt-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const baseEnv = (() => {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
})();
// Parent and child sides get different XDG dirs: models a sandbox with its own ~/.config.
const envFor = (side: "parent" | "child") => ({ ...baseEnv, XDG_CONFIG_HOME: path.join(tmp, `xdg-${side}`) });

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: envFor("parent"), encoding: "utf8" });
const gw = (side: "parent" | "child", cwd: string, ...a: string[]) => {
  const r = spawnSync("bun", [MAIN, ...a], { cwd, env: envFor(side), encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const tokenOf = (s: string) => /token: (\S+)/.exec(s)?.[1];

let n = 0;
function setup() {
  const dir = path.join(tmp, `w${n++}`);
  const parent = path.join(dir, "parent");
  const alias = path.join(dir, "alias");
  const child = path.join(dir, "child");
  mkdirSync(parent, { recursive: true });
  git(parent, "init", "-q");
  writeFileSync(path.join(parent, "a.txt"), "a\n");
  git(parent, "add", "a.txt");
  git(parent, "commit", "-q", "-m", "init");
  symlinkSync(parent, alias);
  expect(git(parent, "worktree", "add", "-q", "-b", `b${n}`, child).status).toBe(0);
  const init = gw("parent", parent, "init");
  const tok = tokenOf(init.out)!;
  expect(gw("parent", parent, "motive", "add", "m1", "--use", "--token", tok).code).toBe(0);
  expect(gw("parent", parent, "slice", "add", "S", "--token", tok).code).toBe(0);
  expect(gw("parent", parent, "scope", "link", child, "--slice", "S", "--token", tok).code).toBe(0);

  // Aliasing approach: the pointer stores the parent's realpath, and the child can resolve that directly,
  // so a cwd-based alias cannot reach it. Instead a host-side helper rewrites the pointer's `root` to the
  // symlink alias path (a variant of the pointer a sandbox mount could produce). The child then reaches the
  // parent only through the alias; sameRoot() must realpath both sides to treat it as the same repo.
  const pf = path.join(child, ".groundwork", "parent");
  const p = parsePointer(readFileSync(pf, "utf8"));
  expect(p.root).not.toBe(alias);
  writeFileSync(pf, serializePointer({ ...p, root: alias }));
  expect(parsePointer(readFileSync(pf, "utf8")).root).toBe(alias);
  expect(sameRoot(alias, parent)).toBe(true);
  return { parent, alias, child, tok };
}

function childFlow(child: string, approve: boolean) {
  const init = gw("child", child, "init");
  expect(init.code).toBe(0);
  const ctok = tokenOf(init.out) ?? tokenOf(gw("child", child, "token").out)!;
  writeFileSync(path.join(child, "b.txt"), "b\n");
  git(child, "add", "b.txt");
  expect(git(child, "commit", "-q", "-m", "child work").status).toBe(0);
  const head = git(child, "rev-parse", "HEAD").stdout.trim();
  if (approve) expect(gw("child", child, "gate", "approve", "--citation", "b.txt:1", "--token", ctok).code).toBe(0);
  return head;
}

describe("nested scope worktree + alias", () => {
  it("child without approve: parent complete refused (bite)", () => {
    const { parent, child, tok } = setup();
    childFlow(child, false);
    const r = gw("parent", parent, "slice", "complete", "S", "--token", tok);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot complete slice 'S'");
  });

  it("alias-root child init registers in parent inbox; approve forwards; parent complete flips refused to ok", () => {
    const { parent, child, tok } = setup();
    expect(gw("parent", parent, "slice", "complete", "S", "--token", tok).code).toBe(1);
    childFlow(child, true);
    expect(existsSync(path.join(child, ".groundwork", "work.db"))).toBe(true);
    const r = gw("parent", parent, "slice", "complete", "S", "--token", tok);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });

  it("AC2: child worktree removed after APPROVE, parent complete still succeeds", () => {
    const { parent, child, tok } = setup();
    const head = childFlow(child, true);
    expect(git(parent, "worktree", "remove", "--force", child).status).toBe(0);
    rmSync(child, { recursive: true, force: true });
    expect(existsSync(child)).toBe(false);
    // Commit lives in the shared object store of the parent repo, so it stays reachable via its branch.
    expect(git(parent, "cat-file", "-e", `${head}^{commit}`).status).toBe(0);
    const r = gw("parent", parent, "slice", "complete", "S", "--token", tok);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  });
});
