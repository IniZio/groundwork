import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkStore } from "../../src/store/store.js";
import { activeSlug, idleDays, listUnits } from "../../src/store/work-units.js";

let root: string;
let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  root = mkdtempSync(path.join(tmpdir(), "wu-"));
  mkdirSync(path.join(root, ".groundwork"), { recursive: true });
});
afterEach(() => {
  if (savedEnv !== undefined) process.env.CLAUDE_PROJECT_DIR = savedEnv;
  rmSync(root, { recursive: true, force: true });
});

const dbFile = () => path.join(root, ".groundwork", "work.db");
function seed(slug?: string): void {
  const s = new WorkStore(dbFile());
  if (slug) s.setMeta("active_motive", slug);
  s.close();
}

describe("activeSlug", () => {
  it("returns the seeded active_motive", () => {
    seed("my-unit");
    expect(activeSlug(root)).toBe("my-unit");
  });
  it("returns null when active_motive absent", () => {
    seed();
    expect(activeSlug(root)).toBeNull();
  });
  it("returns null when active_motive is default", () => {
    seed("default");
    expect(activeSlug(root)).toBeNull();
  });
  it("returns null and creates no DB when none exists", () => {
    expect(activeSlug(root)).toBeNull();
    expect(existsSync(dbFile())).toBe(false);
  });
});

describe("listUnits", () => {
  it("lists sorted directory names only", () => {
    const w = path.join(root, ".groundwork", "work");
    mkdirSync(path.join(w, "b"), { recursive: true });
    mkdirSync(path.join(w, "a"));
    writeFileSync(path.join(w, "stray.md"), "x");
    expect(listUnits(root)).toEqual(["a", "b"]);
  });
  it("returns [] when work dir absent", () => {
    expect(listUnits(root)).toEqual([]);
  });
});

describe("idleDays", () => {
  it("uses recursive max mtime", () => {
    const w = path.join(root, ".groundwork", "work");
    const old = path.join(w, "old");
    const fresh = path.join(w, "fresh");
    mkdirSync(path.join(old, "sub"), { recursive: true });
    mkdirSync(fresh, { recursive: true });
    writeFileSync(path.join(old, "sub", "f.md"), "x");
    writeFileSync(path.join(fresh, "f.md"), "x");
    const t = new Date(Date.now() - 15 * 86_400_000);
    for (const p of [path.join(old, "sub", "f.md"), path.join(old, "sub"), old]) utimesSync(p, t, t);
    expect(idleDays(old)).toBeGreaterThanOrEqual(14);
    expect(idleDays(fresh)).toBe(0);
  });
  it("sees a fresh nested file under old-dated dirs", () => {
    const u = path.join(root, ".groundwork", "work", "u");
    mkdirSync(path.join(u, "sub"), { recursive: true });
    writeFileSync(path.join(u, "sub", "f.md"), "x");
    const t = new Date(Date.now() - 15 * 86_400_000);
    utimesSync(path.join(u, "sub"), t, t);
    utimesSync(u, t, t);
    expect(idleDays(u)).toBe(0);
  });
  it("does not follow symlink loops", () => {
    const u = path.join(root, ".groundwork", "work", "loop");
    mkdirSync(path.join(u, "sub"), { recursive: true });
    symlinkSync(u, path.join(u, "sub", "back"));
    const t = new Date(Date.now() - 15 * 86_400_000);
    utimesSync(path.join(u, "sub"), t, t);
    utimesSync(u, t, t);
    expect(idleDays(u)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(idleDays(u))).toBe(true);
  }, 3000);
});
