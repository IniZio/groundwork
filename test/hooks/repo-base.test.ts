import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import { resolveRepoBase, resolveDbPath } from "../../src/hooks/lib/repo-base.js";

const STOP = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");
const NCG = path.resolve(import.meta.dir, "../../src/hooks/new-code-gate.ts");

const tmpDirs: string[] = [];
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const git = (cwd: string, args: string[]) =>
  spawnSync("git", args, { cwd, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

function mkRepo(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gw-repobase-")));
  tmpDirs.push(root);
  git(root, ["init", "-q"]);
  mkdirSync(path.join(root, "apps", "api"), { recursive: true });
  writeFileSync(path.join(root, "apps", "api", "x.ts"), "export const x = 1;\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  return root;
}

function seedStore(root: string) {
  mkdirSync(path.join(root, ".groundwork"), { recursive: true });
  const db = new Database(path.join(root, ".groundwork", "work.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date().toISOString();
  db.run("INSERT INTO motives (id, status, created_at) VALUES ('m1','active',?)", [now]);
  db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('S1',1,'pending',?,'m1')", [now]);
  db.close();
}

function hook(file: string, payload: Record<string, unknown>, projectDir: string) {
  const home = mkdtempSync(path.join(os.tmpdir(), "gw-repobase-home-"));
  tmpDirs.push(home);
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: projectDir };
  delete env.GROUNDWORK_DB;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const r = spawnSync("bun", [file], { input: JSON.stringify(payload), encoding: "utf8", env: env as Record<string, string> });
  return JSON.parse(r.stdout.trim()) as Record<string, unknown>;
}

const stopPayload = (cwd: string, extra: Record<string, unknown> = {}) =>
  ({ hook_event_name: "Stop", session_id: "s1", cwd, stop_hook_active: false, background_tasks: [], ...extra });

describe("resolveRepoBase / resolveDbPath", () => {
  it("git subdir resolves to toplevel", () => {
    const root = mkRepo();
    expect(resolveRepoBase(path.join(root, "apps", "api"))).toBe(root);
  });

  it("non-git dir falls back to raw start", () => {
    const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gw-nogit-")));
    tmpDirs.push(d);
    expect(resolveRepoBase(d)).toBe(d);
  });

  it("GROUNDWORK_DB wins; payload cwd beats CLAUDE_PROJECT_DIR", () => {
    const root = mkRepo();
    seedStore(root);
    const other = mkRepo();
    expect(resolveDbPath(undefined, { GROUNDWORK_DB: "/x/y.db" })).toBe("/x/y.db");
    expect(resolveDbPath(path.join(root, "apps"), { CLAUDE_PROJECT_DIR: other })).toBe(path.join(root, ".groundwork", "work.db"));
    expect(resolveDbPath(undefined, { CLAUDE_PROJECT_DIR: other })).toBeNull();
  });
});

describe("stop-gate — repo-root store resolution", () => {
  it("host: cwd in repo subdir still gates on the root store", () => {
    const root = mkRepo();
    seedStore(root);
    const out = hook(STOP, stopPayload(path.join(root, "apps", "api")), root);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("1 slice(s) incomplete");
  });

  it("linked child: subdir cwd with root store + pointer gives no false no-work-store block", () => {
    const root = mkRepo();
    seedStore(root);
    writeFileSync(path.join(root, ".groundwork", "parent"), JSON.stringify({
      v: 1, motive: "m-parent", slice: "P-07", link_id: "L1", mode: "delegate", root: "/nowhere", created: "2021-01-01T00:00:00Z" }));
    const sub = path.join(root, "apps", "api");
    const tp = path.join(root, "..", `t-${path.basename(root)}.jsonl`);
    tmpDirs.push(tp);
    writeFileSync(path.join(sub, "x.ts"), "export const x = 2;\n");
    writeFileSync(tp, JSON.stringify({ type: "user", timestamp: "2021-01-01T00:00:00Z" }) + "\n");
    appendFileSync(tp, JSON.stringify({
      type: "assistant", timestamp: "2021-01-02T00:00:00Z", cwd: sub, isSidechain: false,
      message: { role: "assistant", content: [{ type: "tool_use", id: "tu0", name: "Write", input: { file_path: path.join(sub, "x.ts"), content: "export const x = 2;\n" } }] },
    }) + "\n");
    const out = hook(STOP, stopPayload(sub, { transcript_path: tp }), root);
    expect(String(out.reason ?? "")).not.toContain("no work store");
  });

  it("worktree inside main checkout does not inherit the main store", () => {
    const root = mkRepo();
    seedStore(root);
    const wt = path.join(root, ".claude", "worktrees", "w1");
    const r = git(root, ["worktree", "add", "-q", "-b", "w1", wt]);
    expect(r.status).toBe(0);
    const out = hook(STOP, stopPayload(path.join(wt, "apps", "api")), root);
    expect(out.decision).toBeUndefined();
    expect(String(out.reason ?? "")).not.toContain("slice(s) incomplete");
  });
});

describe("new-code-gate — repo-root resolution", () => {
  it("subdir cwd reads root Makefile rules and flags new code", () => {
    const root = mkRepo();
    writeFileSync(path.join(root, "Makefile"), "# groundwork-rule: no-console-log\n");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "mk"]);
    writeFileSync(path.join(root, "apps", "api", "y.ts"), "console.log(1);\n");
    const out = hook(NCG, { hook_event_name: "Stop", cwd: path.join(root, "apps", "api") }, root);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("no-console-log");
  });
});
