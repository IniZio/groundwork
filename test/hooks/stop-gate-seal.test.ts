import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(ROOT, "src/cli/main.ts");
const HOOK = path.join(ROOT, "src/hooks/stop-gate.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-stop-seal-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function envFor(xdg: string): Record<string, string> {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

let n = 0;
/** Temp git repo with one complete slice and an advisor approval recorded via the real CLI. */
function approvedRepo() {
  const xdg = path.join(tmp, `xdg${n}`);
  mkdirSync(xdg, { recursive: true });
  const env = envFor(xdg);
  const root = path.join(tmp, `r${n++}`);
  mkdirSync(root, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", a, { cwd: root, env, encoding: "utf8" });
  const gw = (...a: string[]) => spawnSync("bun", [MAIN, ...a], { cwd: root, env, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(path.join(root, ".gitignore"), ".groundwork/\n");
  writeFileSync(path.join(root, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  gw("init");
  expect(gw("slice", "add", "S1").status).toBe(0);
  expect(gw("slice", "complete", "S1").status).toBe(0);
  const ap = gw("gate", "approve", "--citation", "a.txt:1");
  expect(ap.stderr).toBe("");
  expect(ap.status).toBe(0);
  return { root, xdg, env };
}

function stop(root: string, env: Record<string, string>) {
  const r = spawnSync("bun", [HOOK], {
    cwd: root, env, encoding: "utf8",
    input: JSON.stringify({ session_id: "seal-test", cwd: root }),
  });
  return { code: r.status, out: r.stdout ?? "" };
}

function findSealKey(xdg: string): string {
  const repos = path.join(xdg, "groundwork", "repos");
  const dir = readdirSync(repos)[0];
  return path.join(repos, dir, ["seal", "key"].join("."));
}

/** Rewrite the newest GATE_APPROVE payload in the repo store, bypassing the CLI. */
function mutateApproval(root: string, edit: (p: Record<string, unknown>) => void) {
  const db = new Database(path.join(root, ".groundwork", "work.db"));
  try {
    const row = db.query("SELECT id, payload FROM events WHERE event_type='GATE_APPROVE' ORDER BY id DESC LIMIT 1").get() as { id: number; payload: string };
    const p = JSON.parse(row.payload) as Record<string, unknown>;
    edit(p);
    db.run("UPDATE events SET payload=? WHERE id=?", [JSON.stringify(p), row.id]);
  } finally { db.close(); }
}

function expectBlocked(root: string, env: Record<string, string>) {
  const out = JSON.parse(stop(root, env).out);
  expect(out.decision).toBe("block");
  expect(out.reason).toContain("approval has no verifiable seal");
}

describe("stop-gate fails closed without a verifiable seal", () => {
  it("positive control: valid sealed approval allows Stop", () => {
    const { root, env } = approvedRepo();
    const out = JSON.parse(stop(root, env).out);
    expect(out.continue).toBe(true);
    expect(out.decision).toBeUndefined();
  });

  it("missing key after approval blocks Stop with the reason", () => {
    const { root, xdg, env } = approvedRepo();
    const keyFile = findSealKey(xdg);
    expect(existsSync(keyFile)).toBe(true);
    rmSync(keyFile);
    const out = JSON.parse(stop(root, env).out);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("approval has no verifiable seal");
  });

  it("seal key present, approval seal stripped blocks Stop with the reason", () => {
    const { root, xdg, env } = approvedRepo();
    expect(existsSync(findSealKey(xdg))).toBe(true);
    mutateApproval(root, (p) => { expect(typeof p.seal).toBe("string"); delete p.seal; });
    expectBlocked(root, env);
  });

  it("seal key present, citation changed after sealing blocks Stop with the reason", () => {
    const { root, xdg, env } = approvedRepo();
    expect(existsSync(findSealKey(xdg))).toBe(true);
    mutateApproval(root, (p) => { p.citation = "EVIL.ts:999"; });
    expectBlocked(root, env);
  });

  it("seal key present, base_commit changed after sealing blocks Stop with the reason", () => {
    const { root, xdg, env } = approvedRepo();
    expect(existsSync(findSealKey(xdg))).toBe(true);
    mutateApproval(root, (p) => { p.base_commit = "deadbeef".repeat(5); });
    expectBlocked(root, env);
  });
});
