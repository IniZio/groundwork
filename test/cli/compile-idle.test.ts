import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-compile-idle-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const env = { ...process.env, XDG_CONFIG_HOME: path.join(root, "xdg") } as Record<string, string>;
delete env.GROUNDWORK_DB;
delete env.CLAUDE_PROJECT_DIR;

const gw = (cwd: string, ...a: string[]) =>
  spawnSync("bun", [MAIN, ...a], { cwd, env, encoding: "utf8", timeout: 20000 });

function makeRepo(name: string): string {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  expect(gw(d, "init").status).toBe(0);
  return d;
}

function makeUnit(repo: string, slug: string, daysAgo: number) {
  const dir = path.join(repo, ".groundwork", "work", slug);
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  writeFileSync(path.join(dir, "a.md"), "a\n");
  writeFileSync(path.join(dir, "sub", "b.md"), "b\n");
  const t = new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000);
  for (const p of [path.join(dir, "a.md"), path.join(dir, "sub", "b.md"), path.join(dir, "sub"), dir]) {
    utimesSync(p, t, t);
  }
}

describe("gw compile idle units", () => {
  it("AC1 text lists idle unit foo (15d) and omits fresh bar", () => {
    const repo = makeRepo("ac1");
    makeUnit(repo, "foo", 15);
    makeUnit(repo, "bar", 0);
    const r = gw(repo, "compile");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("idle units (≥14d): foo (15d)");
    expect(r.stdout).not.toContain("bar");
  });

  it("AC2 --json includes idle_units", () => {
    const repo = makeRepo("ac2");
    makeUnit(repo, "foo", 15);
    makeUnit(repo, "bar", 0);
    const r = gw(repo, "compile", "--json");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).idle_units).toEqual([{ slug: "foo", idle_days: 15 }]);
  });

  it("AC3 no work dir prints idle units: none", () => {
    const repo = makeRepo("ac3");
    const r = gw(repo, "compile");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("idle units: none");
  });

  const isRoot = process.getuid?.() === 0;
  it.skipIf(isRoot)("unreadable subdir in one unit is skipped; idle unit still listed, exit 0", () => {
    const repo = makeRepo("unreadable");
    makeUnit(repo, "foo", 15);
    makeUnit(repo, "bad", 15);
    const locked = path.join(repo, ".groundwork", "work", "bad", "sub");
    chmodSync(locked, 0o000);
    try {
      const r = gw(repo, "compile");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("idle units (≥14d): foo (15d)");
      expect(r.stdout).not.toContain("bad");
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
