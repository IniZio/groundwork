import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { configDirForDb } from "../../src/store/key-store.js";

const TMP = mkdtempSync(path.join(tmpdir(), "gw-token-hygiene-"));
let tmpDirs: string[] = [TMP];

function makeRepoDir(): string {
  const dir = mkdtempSync(path.join(TMP, "repo-"));
  mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
  return dir;
}

function runGw(args: string[], cwd: string) {
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(TMP, "xdg") } as Record<string, string>;
  delete env.GROUNDWORK_DB; delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("bun", [path.resolve("src/cli/main.ts"), ...args], { cwd, encoding: "utf8", env, timeout: 10000 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [TMP];
  mkdirSync(TMP, { recursive: true });
});

describe("token removal — init leaves tokens alone", () => {
  it("gw init prints no token and stores none in meta", () => {
    const dir = makeRepoDir();
    const r = runGw(["init"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/token:/);
    const db = new Database(path.join(dir, ".groundwork", "work.db"), { readonly: true });
    const row = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get("token");
    db.close();
    expect(row).toBeNull();
  });

  it("existing write.token file is left untouched by init", () => {
    const dir = makeRepoDir();
    runGw(["init"], dir);
    const tokPath = path.join(configDirForDb(path.join(dir, ".groundwork", "work.db")), "write.token");
    mkdirSync(path.dirname(tokPath), { recursive: true });
    writeFileSync(tokPath, "deadbeef12345678deadbeef12345678\n");
    const r = runGw(["init"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/token:/);
    expect(existsSync(tokPath)).toBe(true);
    expect(readFileSync(tokPath, "utf8")).toBe("deadbeef12345678deadbeef12345678\n");
  });
});
