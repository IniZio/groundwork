import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import { readWriteToken } from "../../src/store/key-store.js";

const TMP = "/dev/shm/gw-token-hygiene-test";
mkdirSync(TMP, { recursive: true });
let tmpDirs: string[] = [];

function makeRepoDir(): string {
  const dir = mkdtempSync(path.join(TMP, "repo-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
  return dir;
}

function runGw(args: string[], cwd: string, env?: Record<string, string>): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [path.resolve("src/cli/main.ts"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
  }
  tmpDirs = [];
});

describe("token hygiene — T15", () => {
  it("gw init: token not stored in meta table", () => {
    const dir = makeRepoDir();
    const r = runGw(["init"], dir);
    expect(r.status).toBe(0);
    const dbPath = path.join(dir, ".groundwork", "work.db");
    const db = new Database(dbPath, { readonly: true });
    const row = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get("token");
    db.close();
    expect(row).toBeNull();
  });

  it("gw init: token printed to stdout", () => {
    const dir = makeRepoDir();
    const r = runGw(["init"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/token: [0-9a-f]{32}/);
  });

  it("gw init: token stored in config dir", () => {
    const dir = makeRepoDir();
    runGw(["init"], dir);
    const tok = readWriteToken(dir);
    expect(tok).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gw init on already-initialized store: does NOT print token (use gw token instead)", () => {
    const dir = makeRepoDir();
    runGw(["init"], dir);
    const r2 = runGw(["init"], dir);
    expect(r2.status).toBe(0);
    expect(r2.stdout).toMatch(/already initialized/);
    expect(r2.stdout).not.toMatch(/token:/);
  });

  it("gw token: prints current token", () => {
    const dir = makeRepoDir();
    runGw(["init"], dir);
    const r = runGw(["token"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/token: [0-9a-f]{32}/);
  });

  it("gw init: migrates token from meta to config dir", () => {
    const dir = makeRepoDir();
    const dbPath = path.join(dir, ".groundwork", "work.db");
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    runMigrations(db, MIGRATIONS);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", ["token", "deadbeef12345678deadbeef12345678"]);
    db.close();
    const r = runGw(["init"], dir);
    expect(r.status).toBe(0);
    const tok = readWriteToken(dir);
    expect(tok).toBe("deadbeef12345678deadbeef12345678");
    const db2 = new Database(dbPath, { readonly: true });
    const row = db2.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get("token");
    db2.close();
    expect(row).toBeNull();
  });
});
