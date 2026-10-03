import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, readdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkStore } from "../../src/store/store.js";
import { ingestInbox } from "../../src/store/scope-inbox.js";
import { linksFor, requirement } from "../../src/store/scope-link.js";
import { readPointer, CHILD_REGISTER } from "../../src/store/scope-pointer.js";
import {
  ScopeError, SCOPE_PARENT, assertCommittedForApprove, childInit, forwardVerdict, scopeLink, scopeUnlink, scopeVerify,
} from "../../src/cli/scope.js";

const tmp = mkdtempSync(path.join(tmpdir(), "gw-scope-"));
const prevXdg = process.env.XDG_CONFIG_HOME;
beforeAll(() => { process.env.XDG_CONFIG_HOME = path.join(tmp, "xdg"); });
afterAll(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
});

const genv = {
  ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
} as Record<string, string>;
const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, env: genv, encoding: "utf8" });

let n = 0;
function makeParent(): { dir: string; store: WorkStore; head: string } {
  const dir = path.join(tmp, `parent${n++}`);
  mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
  git(dir, "init", "-q");
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "init");
  const head = git(dir, "rev-parse", "HEAD").stdout.trim();
  const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
  store.createMotive("m1");
  store.setActiveMotive("m1");
  for (const id of ["S1", "S2", "S3"]) store.insertSlice({ id, wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
  return { dir, store, head };
}
function makeChild(parent: string): string {
  const d = path.join(tmp, `child${n++}`);
  const r = git(parent, "worktree", "add", "-q", "-b", `b${n}`, d);
  if (r.status !== 0) mkdirSync(d, { recursive: true });
  return d;
}
const code = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (e) { return e instanceof ScopeError ? e.code : `other:${(e as Error).message}`; }
  return undefined;
};
const snapshot = (d: string) => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : []);

describe("scopeLink", () => {
  it("defaults to delegate and writes pointer", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    const l = scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(l.mode).toBe("delegate");
    expect(readPointer(c)?.link_id).toBe(l.link_id);
    expect(readPointer(c)?.motive).toBe("m1");
  });
  it("rejects bad mode, missing dir, self link", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    expect(code(() => scopeLink(p.store, { childDir: c, slice: "S1", mode: "bogus", repoDir: p.dir }))).toBe("BAD_MODE");
    expect(code(() => scopeLink(p.store, { childDir: path.join(tmp, "nope"), slice: "S1", repoDir: p.dir }))).toBe("NO_CHILD_DIR");
    expect(code(() => scopeLink(p.store, { childDir: p.dir, slice: "S1", repoDir: p.dir }))).toBe("SELF_LINK");
    const alias = path.join(tmp, `alias${n++}`);
    symlinkSync(p.dir, alias);
    expect(code(() => scopeLink(p.store, { childDir: alias, slice: "S1", repoDir: p.dir }))).toBe("SELF_LINK");
  });
});

describe("scopeUnlink", () => {
  it("records unlink; requires reason and a live link", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    expect(code(() => scopeUnlink(p.store, { slice: "S1", reason: "x" }))).toBe("NO_LIVE_LINK");
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(code(() => scopeUnlink(p.store, { slice: "S1", reason: "  " }))).toBe("REASON_REQUIRED");
    const l = scopeUnlink(p.store, { slice: "S1", reason: "abandoned" });
    expect(l.unlink?.reason).toBe("abandoned");
    expect(linksFor(p.store, "S1")[0].unlink).not.toBeNull();
    expect(code(() => scopeUnlink(p.store, { slice: "S1", reason: "again" }))).toBe("NO_LIVE_LINK");
  });
});

describe("scopeVerify", () => {
  it("direct: records and satisfies requirement", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", mode: "direct", repoDir: p.dir });
    expect(requirement(p.store, "S1", p.dir).satisfied).toBe(false);
    expect(code(() => scopeVerify(p.store, { slice: "S1", citation: "nocolon" }))).toBe("BAD_CITATION");
    expect(code(() => scopeVerify(p.store, { slice: "S1", citation: "a.txt:x" }))).toBe("BAD_CITATION");
    scopeVerify(p.store, { slice: "S1", citation: "a.txt:1" });
    expect(requirement(p.store, "S1", p.dir).satisfied).toBe(true);
  });
  it("delegate link: refused", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(code(() => scopeVerify(p.store, { slice: "S1", citation: "a.txt:1" }))).toBe("NOT_DIRECT");
  });
  it("no live link: refused", () => {
    const p = makeParent();
    expect(code(() => scopeVerify(p.store, { slice: "S1", citation: "a.txt:1" }))).toBe("NO_LIVE_LINK");
  });
});

describe("childInit", () => {
  it("null without pointer, creates nothing", () => {
    const d = path.join(tmp, `plain${n++}`); mkdirSync(d);
    expect(childInit({ childDir: d })).toBeNull();
    expect(existsSync(path.join(d, ".groundwork"))).toBe(false);
  });
  it("direct: no child store", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", mode: "direct", repoDir: p.dir });
    expect(childInit({ childDir: c })?.status).toBe("no-child-store");
    expect(existsSync(path.join(c, ".groundwork", "work.db"))).toBe(false);
    expect(existsSync(path.join(p.dir, ".groundwork", "inbox"))).toBe(false);
  });
  it("delegate: creates child store, parent meta, inbox register that ingests", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    const l = scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    const r = childInit({ childDir: c });
    expect(r?.status).toBe("created");
    const cs = new WorkStore(path.join(c, ".groundwork", "work.db"));
    const ev = cs.getEvents(SCOPE_PARENT, "m1");
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0].payload).link_id).toBe(l.link_id);
    cs.close();
    expect(childInit({ childDir: c })?.status).toBe("exists");
    expect(ingestInbox(p.store, p.dir)).toEqual({ ingested: 1, rejected: [] });
    expect(p.store.getEvents(CHILD_REGISTER, "m1")).toHaveLength(1);
  });
  it("alias root via symlink works", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    const alias = path.join(tmp, `alias${n++}`);
    symlinkSync(p.dir, alias);
    scopeLink(p.store, { childDir: c, slice: "S2", repoDir: alias });
    expect(readPointer(c)?.root).toBe(realpathSync(p.dir));
    expect(childInit({ childDir: c })?.status).toBe("created");
    expect(ingestInbox(p.store, alias).ingested).toBe(1);
  });

  describe("no half state", () => {
    it("parent root vanished: throws, child has only the pointer", () => {
      const p = makeParent(); const c = makeChild(p.dir);
      scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
      const before = snapshot(c);
      p.store.close();
      rmSync(path.join(p.dir, ".groundwork", "work.db"));
      expect(code(() => childInit({ childDir: c }))).toBe("PARENT_UNREACHABLE");
      expect(existsSync(path.join(c, ".groundwork", "work.db"))).toBe(false);
      expect(snapshot(c)).toEqual(before);
    });
    it("inbox unwritable: throws, no child db", () => {
      const p = makeParent(); const c = makeChild(p.dir);
      scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
      writeFileSync(path.join(p.dir, ".groundwork", "inbox"), "blocker"); // a file where the dir must go
      expect(code(() => childInit({ childDir: c }))?.startsWith("other:")).toBe(true);
      expect(existsSync(path.join(c, ".groundwork", "work.db"))).toBe(false);
    });
    it("pointer from future version: throws, nothing created", () => {
      const p = makeParent(); const c = makeChild(p.dir);
      mkdirSync(path.join(c, ".groundwork"), { recursive: true });
      writeFileSync(path.join(c, ".groundwork", "parent"), JSON.stringify({ v: 9 }));
      expect(() => childInit({ childDir: c })).toThrow(/unsupported version/);
      expect(existsSync(path.join(c, ".groundwork", "work.db"))).toBe(false);
    });
    it("child store creation fails: db files rolled back", () => {
      const p = makeParent(); const c = makeChild(p.dir);
      scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
      // XDG path blocked by a file -> ensureWriteToken throws after the db was created.
      const prev = process.env.XDG_CONFIG_HOME;
      const blocker = path.join(tmp, `blocker${n++}`);
      writeFileSync(blocker, "x");
      process.env.XDG_CONFIG_HOME = blocker;
      try {
        expect(() => childInit({ childDir: c })).toThrow();
      } finally { process.env.XDG_CONFIG_HOME = prev; }
      expect(snapshot(path.join(c, ".groundwork")).filter((f) => f.startsWith("work.db"))).toEqual([]);
    });
  });
});

describe("forwardVerdict", () => {
  it("null without pointer", () => {
    const d = path.join(tmp, `plain${n++}`); mkdirSync(d);
    expect(forwardVerdict({ childDir: d, verdict: "APPROVE", citation: "a:1", base_commit: "x" })).toBeNull();
  });
  it("writes CHILD_GATE that ingests and satisfies requirement", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(forwardVerdict({ childDir: c, verdict: "APPROVE", citation: "a.txt:1", base_commit: p.head })).not.toBeNull();
    expect(ingestInbox(p.store, p.dir).ingested).toBe(1);
    expect(requirement(p.store, "S1", p.dir).satisfied).toBe(true);
  });
  it("throws on bad input and unreachable parent", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(code(() => forwardVerdict({ childDir: c, verdict: "MAYBE", citation: "a:1", base_commit: "x" }))).toBe("BAD_VERDICT");
    expect(code(() => forwardVerdict({ childDir: c, verdict: "APPROVE", citation: "", base_commit: "x" }))).toBe("BAD_CITATION");
    expect(code(() => forwardVerdict({ childDir: c, verdict: "APPROVE", citation: "a:1", base_commit: "" }))).toBe("BAD_BASE_COMMIT");
    p.store.close();
    rmSync(path.join(p.dir, ".groundwork", "work.db"));
    expect(code(() => forwardVerdict({ childDir: c, verdict: "APPROVE", citation: "a:1", base_commit: "x" }))).toBe("PARENT_UNREACHABLE");
  });
});

describe("assertCommittedForApprove", () => {
  it("no pointer or direct pointer: no-op even when dirty", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    writeFileSync(path.join(c, "x.txt"), "x");
    expect(() => assertCommittedForApprove(c)).not.toThrow();
    scopeLink(p.store, { childDir: c, slice: "S1", mode: "direct", repoDir: p.dir });
    expect(() => assertCommittedForApprove(c)).not.toThrow();
  });
  it("delegate: lists dirty paths, ignores .groundwork/", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(() => assertCommittedForApprove(c)).not.toThrow();
    writeFileSync(path.join(c, "x.txt"), "x");
    expect(code(() => assertCommittedForApprove(c))).toBe("UNCOMMITTED_WORK");
    try { assertCommittedForApprove(c); } catch (e) {
      expect((e as Error).message).toBe("cannot approve a linked child with uncommitted work — commit first:\nx.txt");
    }
  });
});

describe("childInit adopt", () => {
  const preStore = (c: string) => {
    mkdirSync(path.join(c, ".groundwork"), { recursive: true });
    const s = new WorkStore(path.join(c, ".groundwork", "work.db"));
    s.createMotive("other"); s.close();
  };
  it("existing store without SCOPE_PARENT: linked once, then exists", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    preStore(c);
    scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(childInit({ childDir: c })?.status).toBe("linked");
    expect(ingestInbox(p.store, p.dir)).toEqual({ ingested: 1, rejected: [] });
    expect(childInit({ childDir: c })?.status).toBe("exists");
    const cs = new WorkStore(path.join(c, ".groundwork", "work.db"));
    expect(cs.getEvents(SCOPE_PARENT, "m1")).toHaveLength(1);
    cs.close();
  });
  it("relinked (different link_id): records new SCOPE_PARENT + register", () => {
    const p = makeParent(); const c = makeChild(p.dir);
    const l1 = scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(childInit({ childDir: c })?.status).toBe("created");
    scopeUnlink(p.store, { slice: "S1", reason: "redo" });
    const l2 = scopeLink(p.store, { childDir: c, slice: "S1", repoDir: p.dir });
    expect(l2.link_id).not.toBe(l1.link_id);
    expect(childInit({ childDir: c })?.status).toBe("linked");
    expect(childInit({ childDir: c })?.status).toBe("exists");
    const cs = new WorkStore(path.join(c, ".groundwork", "work.db"));
    expect(cs.getEvents(SCOPE_PARENT, "m1")).toHaveLength(2);
    cs.close();
  });
});
