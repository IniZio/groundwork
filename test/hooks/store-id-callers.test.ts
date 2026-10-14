import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";

const ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(ROOT, "src/cli/main.ts");
const HOOK = path.join(ROOT, "src/hooks/stop-gate.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-storeid-callers-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function envFor(xdg: string, extra: Record<string, string> = {}): Record<string, string> {
  const e = { ...process.env } as Record<string, string | undefined>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...(e as Record<string, string>), XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
    ...extra,
  };
}

let n = 0;
function fresh() {
  const id = n++;
  const xdg = path.join(tmp, `xdg${id}`);
  mkdirSync(xdg, { recursive: true });
  return { xdg, id, reposDir: path.join(xdg, "groundwork", "repos") };
}
function gitRepo(dir: string, env: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, env, encoding: "utf8" });
  git("init", "-q");
  writeFileSync(path.join(dir, ".gitignore"), ".groundwork/\n");
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
}
const gwIn = (cwd: string, env: Record<string, string>, ...a: string[]) => {
  const r = spawnSync("bun", [MAIN, ...a], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const stop = (cwd: string, env: Record<string, string>) => {
  const r = spawnSync("bun", [HOOK], { cwd, env, encoding: "utf8", input: JSON.stringify({ session_id: "sid-test", cwd }) });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
function storeId(db: string): string | undefined {
  const d = new Database(db, { readonly: true });
  try {
    return (d.query("SELECT value FROM meta WHERE key = 'store_id'").get() as { value: string } | null)?.value;
  } finally { d.close(); }
}

describe("store_id key callers", () => {
  it("(a) stop-gate with GROUNDWORK_DB outside the repo verifies seal via store_id; missing seal.key blocks", () => {
    const { xdg, id, reposDir } = fresh();
    const repo = path.join(tmp, `repo${id}`);
    const elsewhere = path.join(tmp, `elsewhere${id}`);
    const db = path.join(elsewhere, "state", "custom.db");
    const env = envFor(xdg, { GROUNDWORK_DB: db });
    gitRepo(repo, env);
    mkdirSync(path.dirname(db), { recursive: true });

    const init = gwIn(repo, env, "init");
    expect(init.code, `init: ${JSON.stringify(init)}`).toBe(0);
    expect(gwIn(repo, env, "slice", "add", "S1").code).toBe(0);
    expect(gwIn(repo, env, "slice", "complete", "S1").code).toBe(0);
    const ap = gwIn(repo, env, "gate", "approve", "--citation", "a.txt:1");
    expect(ap.code, `approve: ${JSON.stringify(ap)}`).toBe(0);

    const sid = storeId(db);
    expect(sid, `store_id of ${db}`).toBeTruthy();
    const sealKey = path.join(reposDir, sid!, "seal.key");
    expect(existsSync(sealKey), `seal.key expected at ${sealKey}`).toBe(true);

    const ok = stop(repo, env);
    const okOut = ok.out ? JSON.parse(ok.out) : {};
    expect(okOut.decision, `allowed run: ${JSON.stringify(ok)}`).toBeUndefined();
    expect(okOut.continue, `allowed run: ${JSON.stringify(ok)}`).toBe(true);

    rmSync(sealKey);
    const bad = stop(repo, env);
    const badOut = bad.out ? JSON.parse(bad.out) : {};
    expect(badOut.decision, `blocked run: ${JSON.stringify(bad)}`).toBe("block");

    expect(existsSync(path.join(repo, ".groundwork", "work.db")), `repo has stray work.db: ${repo}`).toBe(false);
    const legacy = path.join(path.dirname(path.dirname(db)), ".groundwork", "work.db");
    expect(existsSync(legacy), `repo-path lookup would resolve to ${legacy}`).toBe(false);
  });

  it("(b) scope link child gets its own store_id and key dir", () => {
    const { xdg, id, reposDir } = fresh();
    const env = envFor(xdg);
    const parent = path.join(tmp, `parent${id}`);
    const child = path.join(tmp, `child${id}`);
    gitRepo(parent, env);
    gitRepo(child, env);

    const init = gwIn(parent, env, "init");
    expect(init.code, `init: ${JSON.stringify(init)}`).toBe(0);
    expect(gwIn(parent, env, "slice", "add", "S1").code).toBe(0);
    const link = gwIn(parent, env, "scope", "link", child, "--slice", "S1");
    expect(link.code, `link: ${JSON.stringify(link)}`).toBe(0);
    const cinit = gwIn(child, env, "init");
    expect(cinit.code, `child init: ${JSON.stringify(cinit)}`).toBe(0);

    const pId = storeId(path.join(parent, ".groundwork", "work.db"));
    const cId = storeId(path.join(child, ".groundwork", "work.db"));
    expect(pId, `parent id`).toBeTruthy();
    expect(cId, `child id`).toBeTruthy();
    expect(cId, `parent=${pId} child=${cId}`).not.toBe(pId);
    const pDir = path.join(reposDir, pId!);
    const cDir = path.join(reposDir, cId!);
    expect(pDir).not.toBe(cDir);
    expect(existsSync(path.join(cDir, "seal.key")), `missing ${path.join(cDir, "seal.key")}`).toBe(true);
    expect(existsSync(path.join(cDir, "write.token")), `unexpected ${path.join(cDir, "write.token")}`).toBe(false);
  });

  it("(c) stop-gate in a fresh repo with no .groundwork creates no work.db", () => {
    const { xdg, id } = fresh();
    const env = envFor(xdg);
    const repo = path.join(tmp, `bare${id}`);
    gitRepo(repo, env);
    const r = stop(repo, env);
    expect(r.code, `stop: ${JSON.stringify(r)}`).toBe(0);
    expect(existsSync(path.join(repo, ".groundwork", "work.db")), `work.db in ${repo}`).toBe(false);
    expect(existsSync(path.join(repo, ".groundwork")), `.groundwork exists in ${repo}`).toBe(false);
  });
});
