import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkStore } from "../../src/store/store.js";
import { createLink, linksFor, requirement } from "../../src/store/scope-link.js";
import { CHILD_GATE, SCOPE_UNLINK, SCOPE_VERIFY, readPointer } from "../../src/store/scope-pointer.js";

let tmp: string, repo: string, child: string, store: WorkStore, head: string;
const M = "m1";
const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "sl-")));
  repo = path.join(tmp, "repo");
  child = path.join(tmp, "child");
  mkdirSync(repo); mkdirSync(child);
  git("init", "-q");
  git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  head = git("rev-parse", "HEAD").stdout.trim();
  store = new WorkStore(path.join(tmp, "w.db"));
  store.createMotive(M);
  store.setMotiveContext(M);
  store.insertSlice({ id: "S1", wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
});
afterEach(() => { store.close(); rmSync(tmp, { recursive: true, force: true }); });

const link = (mode: "direct" | "delegate", dir = child) =>
  createLink(store, { childDir: dir, slice: "S1", mode, motive: M, repoDir: repo });
const gate = (l: { link_id: string }, verdict: string, base = head) =>
  store.appendEvent(CHILD_GATE, { link_id: l.link_id, slice: "S1", verdict, citation: "c", base_commit: base }, M);

describe("createLink", () => {
  it("writes pointer and event", () => {
    const l = link("delegate");
    const p = readPointer(child)!;
    expect(p.link_id).toBe(l.link_id);
    expect(p.root).toBe(repo);
    expect(p.worktree).toBe(child);
    expect(linksFor(store, "S1")).toHaveLength(1);
  });
  it("refuses missing slice", () => {
    expect(() => createLink(store, { childDir: child, slice: "nope", mode: "direct", motive: M, repoDir: repo })).toThrow(/not found/);
  });
  it("refuses complete slice", () => {
    store.completeSlice("S1");
    expect(() => link("direct")).toThrow(/complete/);
  });
  it("refuses foreign pointer", () => {
    const other = path.join(tmp, "other"); mkdirSync(other);
    createLink(store, { childDir: child, slice: "S1", mode: "direct", motive: M, repoDir: other });
    expect(() => link("direct")).toThrow(/different root/);
  });
  it("relink creates newer link", () => {
    const a = link("direct"); const b = link("direct");
    const ls = linksFor(store, "S1");
    expect(ls.map((l) => l.link_id)).toEqual([b.link_id, a.link_id]);
    expect(readPointer(child)!.link_id).toBe(b.link_id);
  });
});

describe("requirement", () => {
  it("no links -> satisfied", () => {
    expect(requirement(store, "S1", repo).satisfied).toBe(true);
  });
  it("delegate without gate -> unsatisfied", () => {
    link("delegate");
    expect(requirement(store, "S1", repo).satisfied).toBe(false);
  });
  it("delegate APPROVE + real commit -> satisfied", () => {
    gate(link("delegate"), "APPROVE");
    expect(requirement(store, "S1", repo).satisfied).toBe(true);
  });
  it("CORRECTION after APPROVE -> unsatisfied", () => {
    const l = link("delegate");
    gate(l, "APPROVE"); gate(l, "CORRECTION");
    const r = requirement(store, "S1", repo);
    expect(r.satisfied).toBe(false);
    expect(r.missing).toMatch(/CORRECTION/);
  });
  it("fabricated base_commit -> unsatisfied", () => {
    gate(link("delegate"), "APPROVE", "deadbeef".repeat(5));
    const r = requirement(store, "S1", repo);
    expect(r.satisfied).toBe(false);
    expect(r.missing).toMatch(/base_commit/);
  });
  it("ref-like base_commit values -> unsatisfied as not a full commit id", () => {
    git("branch", "main");
    for (const bad of ["HEAD", "main", head.slice(0, 7)]) {
      gate(link("delegate"), "APPROVE", bad);
      const r = requirement(store, "S1", repo);
      expect(r.satisfied).toBe(false);
      expect(r.missing).toBe(`base_commit ${bad} is not a full commit id`);
    }
  });
  it("direct ignores child verdicts", () => {
    gate(link("direct"), "APPROVE");
    expect(requirement(store, "S1", repo).satisfied).toBe(false);
  });
  it("direct satisfied by later SCOPE_VERIFY", () => {
    link("direct");
    store.appendEvent(SCOPE_VERIFY, { slice: "S1", citation: "c" }, M);
    expect(requirement(store, "S1", repo).satisfied).toBe(true);
  });
  it("SCOPE_VERIFY before relink does not count", () => {
    link("direct");
    store.appendEvent(SCOPE_VERIFY, { slice: "S1", citation: "c" }, M);
    link("direct");
    expect(requirement(store, "S1", repo).satisfied).toBe(false);
  });
  it("unlinked newest falls back to next newest", () => {
    const a = link("delegate"); gate(a, "APPROVE");
    const b = link("direct");
    store.appendEvent(SCOPE_UNLINK, { link_id: b.link_id, slice: "S1", reason: "abandoned" }, M);
    const r = requirement(store, "S1", repo);
    expect(r.satisfied).toBe(true);
    expect(r.evidence.join("\n")).toMatch(/abandoned/);
  });
  it("all unlinked -> satisfied", () => {
    const a = link("direct");
    store.appendEvent(SCOPE_UNLINK, { link_id: a.link_id, slice: "S1", reason: "r" }, M);
    expect(requirement(store, "S1", repo).satisfied).toBe(true);
  });
  it("linksFor carries gates newest first and unlink", () => {
    const a = link("delegate");
    gate(a, "APPROVE"); gate(a, "CORRECTION");
    store.appendEvent(SCOPE_UNLINK, { link_id: a.link_id, slice: "S1", reason: "r" }, M);
    const [l] = linksFor(store, "S1");
    expect(l.gates.map((g) => g.verdict)).toEqual(["CORRECTION", "APPROVE"]);
    expect(l.unlink?.reason).toBe("r");
  });
});
