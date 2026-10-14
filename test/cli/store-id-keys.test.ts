import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync, readFileSync, existsSync, renameSync, copyFileSync, statSync, readdirSync } from "node:fs";
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

let n = 0;
function newRepo() {
  const dir = path.join(tmp, `r${n++}`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  writeFileSync(path.join(dir, ".gitignore"), ".groundwork/\n");
  git(dir, "add", "a.txt", ".gitignore");
  git(dir, "commit", "-q", "-m", "init");
  const init = gw(dir, ["init"]);
  expect(init.err).toBe("");
  expect(init.code).toBe(0);
  return { dir, db: path.join(dir, ".groundwork", "work.db") };
}
function storeId(db: string): string | undefined {
  const d = new Database(db, { readonly: true });
  try {
    const row = d.query("SELECT value FROM meta WHERE key = 'store_id'").get() as { value: string } | null;
    return row?.value;
  } finally { d.close(); }
}
const sliceAdd = (cwd: string, id: string, env: Record<string, string> = {}) =>
  gw(cwd, ["slice", "add", id, "--desc", "x"], env);

describe("store_id keyed key storage", () => {
  it("(a) init writes store_id and keys under repos/<store_id>, not the legacy dir", () => {
    const { dir, db } = newRepo();
    const id = storeId(db);
    expect(id).toMatch(/^[0-9a-f]{16,}$/);
    const kd = path.join(reposDir, id!);
    expect(existsSync(path.join(kd, "seal.key"))).toBe(true);
    const legacy = path.join(reposDir, createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 16));
    expect(existsSync(legacy)).toBe(false);
  });

  it("(b) legacy path-hash dir is migrated by copy, never deleted", () => {
    const { dir, db } = newRepo();
    const oldId = storeId(db)!;
    const oldDir = path.join(reposDir, oldId);
    const sealBytes = readFileSync(path.join(oldDir, "seal.key"));

    const rw = new Database(db);
    rw.run("DELETE FROM meta WHERE key = 'store_id'");
    rw.close();
    const legacy = path.join(reposDir, createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 16));
    mkdirSync(legacy, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(legacy, "seal.key"), sealBytes, { mode: 0o600 });
    rmSync(oldDir, { recursive: true, force: true });

    const t = gw(dir, ["init"]);
    expect(t.code).toBe(0);
    const newId = storeId(db);
    const newDir = newId ? path.join(reposDir, newId) : "";
    const copiedSeal = newId ? readFileSync(path.join(newDir, "seal.key")) : Buffer.alloc(0);
    console.log(
      `[b] new-store_id=${newId} newDir-exists=${newId ? existsSync(newDir) : false} ` +
      `seal-bytes-equal=${copiedSeal.equals(sealBytes)} ` +
      `legacy-dir-exists=${existsSync(legacy)} ` +
      `legacy-seal-exists=${existsSync(path.join(legacy, "seal.key"))}`,
    );
    expect(newId).toMatch(/^[0-9a-f]{16,}$/);
    expect(copiedSeal.equals(sealBytes)).toBe(true);
    expect(existsSync(path.join(legacy, "seal.key"))).toBe(true);
    expect(statSync(path.join(newDir, "seal.key")).mode & 0o077).toBe(0);
    expect(sliceAdd(dir, "s1").code).toBe(0);
  });

  it("(c) moving the checkout keeps the same seal.key", () => {
    const { dir, db } = newRepo();
    const id = storeId(db)!;
    const sealBefore = readFileSync(path.join(reposDir, id, "seal.key"));
    const dirsBefore = readdirSync(reposDir).sort();
    const moved = path.join(tmp, `moved${n++}`);
    renameSync(dir, moved);
    const add = sliceAdd(moved, "s1");
    const sealAfter = readFileSync(path.join(reposDir, id, "seal.key"));
    console.log(`[c] seal-equal=${sealAfter.equals(sealBefore)} old-dir-exists=${existsSync(dir)} slice-add-code=${add.code}`);
    expect(add.code).toBe(0);
    expect(storeId(path.join(moved, ".groundwork", "work.db"))).toBe(id);
    expect(sealAfter.equals(sealBefore)).toBe(true);
    expect(readdirSync(reposDir).sort()).toEqual(dirsBefore);
  });

  it("(d) a db copied outside the repo and opened via GROUNDWORK_DB keeps the seal.key", () => {
    const { db } = newRepo();
    const id = storeId(db)!;
    const sealBefore = readFileSync(path.join(reposDir, id, "seal.key"));
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
    const dirsBefore = readdirSync(reposDir).sort();
    expect(sliceAdd(elsewhere, "s1", env).code).toBe(0);
    expect(storeId(copy)).toBe(id);
    expect(readFileSync(path.join(reposDir, id, "seal.key")).equals(sealBefore)).toBe(true);
    expect(readdirSync(reposDir).sort()).toEqual(dirsBefore);
  });

  it("(e) separate repos get distinct store_ids and seal keys", () => {
    const a = newRepo();
    const b = newRepo();
    const ia = storeId(a.db);
    const ib = storeId(b.db);
    expect(ia).toBeTruthy();
    expect(ib).toBeTruthy();
    expect(ia).not.toBe(ib);
    const sa = readFileSync(path.join(reposDir, ia!, "seal.key"));
    const sb = readFileSync(path.join(reposDir, ib!, "seal.key"));
    expect(sa.equals(sb)).toBe(false);
  });
});
