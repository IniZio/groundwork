import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CHILD_GATE,
  CHILD_LINK,
  CHILD_REGISTER,
  SCOPE_UNLINK,
  SCOPE_VERIFY,
  ScopePointerVersionError,
  parsePointer,
  readPointer,
  sameRoot,
  serializePointer,
  type ScopePointer,
} from "../../src/store/scope-pointer.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "sp-"));
  mkdirSync(path.join(tmp, ".groundwork"), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const valid = (): ScopePointer => ({
  v: 1,
  motive: "m",
  slice: "S-1",
  link_id: "L1",
  mode: "direct",
  root: "/abs/repo",
  created: "2026-10-03T00:00:00.000Z",
});
const pfile = () => path.join(tmp, ".groundwork", "parent");

describe("parsePointer", () => {
  it("accepts a valid pointer from string and object", () => {
    expect(parsePointer(JSON.stringify(valid()))).toEqual(valid());
    expect(parsePointer(valid())).toEqual(valid());
  });
  it("keeps optional worktree", () => {
    expect(parsePointer({ ...valid(), mode: "delegate", worktree: "/w" }).worktree).toBe("/w");
  });
  for (const f of ["motive", "slice", "link_id", "mode", "root", "created"]) {
    it(`throws naming missing ${f}`, () => {
      const o: Record<string, unknown> = { ...valid() };
      delete o[f];
      expect(() => parsePointer(o)).toThrow(f);
    });
    it(`throws naming wrong-typed ${f}`, () => {
      expect(() => parsePointer({ ...valid(), [f]: 5 })).toThrow(f);
    });
  }
  it("throws on wrong-typed worktree", () => {
    expect(() => parsePointer({ ...valid(), worktree: 1 })).toThrow("worktree");
  });
  it("throws on unknown mode", () => {
    expect(() => parsePointer({ ...valid(), mode: "weird" })).toThrow("mode");
  });
  it("throws on invalid JSON and non-objects", () => {
    expect(() => parsePointer("{nope")).toThrow();
    expect(() => parsePointer("[]")).toThrow();
    expect(() => parsePointer(null)).toThrow();
  });
  it("throws a distinct version error for v > 1", () => {
    let err: unknown;
    try { parsePointer({ ...valid(), v: 2 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ScopePointerVersionError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("v");
  });
  it("throws a plain error for missing or bad v", () => {
    const o: Record<string, unknown> = { ...valid() };
    delete o.v;
    expect(() => parsePointer(o)).toThrow("v");
    expect(() => parsePointer({ ...valid(), v: "1" })).toThrow("v");
  });
});

describe("readPointer", () => {
  it("returns null when file is absent", () => {
    expect(readPointer(tmp)).toBeNull();
  });
  it("reads a valid file", () => {
    writeFileSync(pfile(), serializePointer(valid()));
    expect(readPointer(tmp)).toEqual(valid());
  });
  it("throws on present-but-invalid file", () => {
    writeFileSync(pfile(), "garbage");
    expect(() => readPointer(tmp)).toThrow();
    writeFileSync(pfile(), "");
    expect(() => readPointer(tmp)).toThrow();
  });
  it("throws version error on future version", () => {
    writeFileSync(pfile(), JSON.stringify({ ...valid(), v: 9 }));
    expect(() => readPointer(tmp)).toThrow(ScopePointerVersionError);
  });
});

describe("serializePointer", () => {
  it("round-trips through parsePointer", () => {
    const p = { ...valid(), worktree: "/w" };
    expect(parsePointer(serializePointer(p))).toEqual(p);
  });
});

describe("sameRoot", () => {
  it("symlink alias equals canonical", () => {
    const real = path.join(tmp, "real");
    mkdirSync(real);
    const link = path.join(tmp, "alias");
    symlinkSync(real, link);
    expect(sameRoot(link, real)).toBe(true);
  });
  it("different dirs differ", () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    mkdirSync(a);
    mkdirSync(b);
    expect(sameRoot(a, b)).toBe(false);
  });
});

describe("event constants", () => {
  it("names", () => {
    expect([CHILD_LINK, CHILD_REGISTER, CHILD_GATE, SCOPE_VERIFY, SCOPE_UNLINK]).toEqual([
      "CHILD_LINK", "CHILD_REGISTER", "CHILD_GATE", "SCOPE_VERIFY", "SCOPE_UNLINK",
    ]);
  });
});
