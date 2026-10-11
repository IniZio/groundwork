import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, readFileSync, existsSync, renameSync, copyFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-storeid-")));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const xdg = path.join(tmp, "xdg");
const reposDir = path.join(xdg, "groundwork", "repos");

const baseEnv = (() => {
  const e = { ...process.env } as Record<string, string>;
  delete e.GROUNDWORK_DB; delete e.CLAUDE_PROJECT_DIR; delete e.GW;
  return {
    ...e, XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  } as Record<string, string>;
})();

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: baseEnv, encoding: "utf8" });
const gw = (cwd: string, args: string[], extraEnv: Record<string, string> = {}) => {
  const r = spawnSync("bun", [MAIN, ...args], { cwd, env: { ...baseEnv, ...extraEnv }, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const tokenOf = (s: string) => /token: ([0-9a-f]+)/.exec(s)?.[1];

let n = 0;
function newRepo() {
  const dir = path.join(tmp, `r${n++}`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  const init = gw(dir, ["init"]);
  expect(init.err).toBe("");
  expect(init.code).toBe(0);
  const tok = tokenOf(init.out)!;
  expect(tok).toBeTruthy();
  return { dir, tok, db: path.join(dir, ".groundwork", "work.db") };
}
function storeId(db: string): string | undefined {
  const d = new Database(db, { readonly: true });
  try {
    const row = d.query("SELECT value FROM meta WHERE key = 'store_id'").get() as { value: string } | null;
    return row?.value;
  } finally { d.close(); }
}
const sliceAdd = (cwd: string, id: string, tok: string, env: Record<string, string> = {}) =>
  gw(cwd, ["slice", "add", id, "--desc", "x", "--token", tok], env);

describe("store_id keyed key storage", () => {
  it("(a) init writes store_id and keys under repos/<store_id>, not the legacy dir", () => {
    const { dir, tok, db } = newRepo();
    const id = storeId(db);
    expect(id).toMatch(/^[0-9a-f]{16,}$/);
    const kd = path.join(reposDir, id!);
    expect(readFileSync(path.join(kd, "write.token"), "utf8").trim()).toBe(tok);
    expect(existsSync(path.join(kd, "seal.key"))).toBe(true);
    const legacy = path.join(reposDir, createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 16));
    expect(existsSync(legacy)).toBe(false);
  });

  it("(b) legacy path-hash dir is migrated by copy, never deleted", () => {
    const { dir, tok, db } = newRepo();
    const oldId = storeId(db)!;
    const oldDir = path.join(reposDir, oldId);
    const tokBytes = readFileSync(path.join(oldDir, "write.token"));
    const sealBytes = readFileSync(path.join(oldDir, "seal.key"));

    const rw = new Database(db);
    rw.run("DELETE FROM meta WHERE key = 'store_id'");
    rw.close();
    const legacy = path.join(reposDir, createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 16));
    mkdirSync(legacy, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(legacy, "write.token"), tokBytes, { mode: 0o600 });
    writeFileSync(path.join(legacy, "seal.key"), sealBytes, { mode: 0o600 });
    rmSync(oldDir, { recursive: true, force: true });

    const t = gw(dir, ["token"]);
    expect(t.code).toBe(0);
    const printed = tokenOf(t.out);
    const newId = storeId(db);
    const newDir = newId ? path.join(reposDir, newId) : "";
    const copiedTok = newId ? readFileSync(path.join(newDir, "write.token")) : Buffer.alloc(0);
    const copiedSeal = newId ? readFileSync(path.join(newDir, "seal.key")) : Buffer.alloc(0);
    console.log(
      `[b] token-equal=${printed === tok} new-store_id=${newId} newDir-exists=${newId ? existsSync(newDir) : false} ` +
      `token-bytes-equal=${copiedTok.equals(tokBytes)} seal-bytes-equal=${copiedSeal.equals(sealBytes)} ` +
      `legacy-dir-exists=${existsSync(legacy)} legacy-token-exists=${existsSync(path.join(legacy, "write.token"))} ` +
      `legacy-seal-exists=${existsSync(path.join(legacy, "seal.key"))}`,
    );
    expect(printed).toBe(tok);
    expect(newId).toMatch(/^[0-9a-f]{16,}$/);
    expect(copiedTok.equals(tokBytes)).toBe(true);
    expect(copiedSeal.equals(sealBytes)).toBe(true);
    expect(existsSync(path.join(legacy, "write.token"))).toBe(true);
    expect(existsSync(path.join(legacy, "seal.key"))).toBe(true);
    expect(statSync(path.join(newDir, "write.token")).mode & 0o077).toBe(0);
    expect(sliceAdd(dir, "s1", tok).code).toBe(0);
  });

  it("(c) moving the checkout keeps the token valid", () => {
    const { dir, tok } = newRepo();
    const moved = path.join(tmp, `moved${n++}`);
    renameSync(dir, moved);
    const t = gw(moved, ["token"]);
    const add = sliceAdd(moved, "s1", tok);
    const bad = sliceAdd(moved, "s2", "deadbeefdeadbeefdeadbeefdeadbeef");
    console.log(`[c] token-equal=${tokenOf(t.out) === tok} old-dir-exists=${existsSync(dir)} slice-add-code=${add.code} wrong-token-code=${bad.code}`);
    expect(t.code).toBe(0);
    expect(tokenOf(t.out)).toBe(tok);
    expect(add.code).toBe(0);
    expect(bad.code).not.toBe(0);
    expect(bad.code).not.toBeNull();
  });

  it("(d) a db copied outside the repo and opened via GROUNDWORK_DB keeps the token", () => {
    const { tok, db } = newRepo();
    const rw = new Database(db);
    rw.run("PRAGMA wal_checkpoint(TRUNCATE)");
    rw.close();
    const outDir = path.join(tmp, `out${n++}`);
    mkdirSync(outDir, { recursive: true });
    const copy = path.join(outDir, "work.db");
    copyFileSync(db, copy);
    for (const ext of ["-wal", "-shm"]) if (existsSync(db + ext)) copyFileSync(db + ext, copy + ext);
    const elsewhere = path.join(tmp, `cwd${n++}`);
    mkdirSync(elsewhere, { recursive: true });
    const env = { GROUNDWORK_DB: copy };
    const t = gw(elsewhere, ["token"], env);
    expect(t.code).toBe(0);
    expect(tokenOf(t.out)).toBe(tok);
    expect(sliceAdd(elsewhere, "s1", tok, env).code).toBe(0);
  });

  it("(e) separate repos get distinct store_ids and tokens", () => {
    const a = newRepo();
    const b = newRepo();
    const ia = storeId(a.db);
    const ib = storeId(b.db);
    expect(ia).toBeTruthy();
    expect(ib).toBeTruthy();
    expect(ia).not.toBe(ib);
    expect(a.tok).not.toBe(b.tok);
  });
});
