import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkStore } from "../../src/store/store.js";
import { CHILD_GATE, CHILD_LINK, SCOPE_VERIFY, serializePointer } from "../../src/store/scope-pointer.js";
import { writeInboxEvent } from "../../src/store/scope-inbox.js";
import { completionGuard, gateStatus } from "../../src/cli/gate-status.js";

const git = (cwd: string, ...a: string[]) =>
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });

let tmp: string;
let store: WorkStore;
let sha: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gs-")));
  git(tmp, "init", "-q");
  git(tmp, "commit", "--allow-empty", "-q", "-m", "init");
  sha = git(tmp, "rev-parse", "HEAD").stdout.trim();
  mkdirSync(path.join(tmp, ".groundwork"), { recursive: true });
  store = new WorkStore(path.join(tmp, ".groundwork", "work.db"));
  store.insertSlice({ id: "S-1", wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const link = (mode: "direct" | "delegate", id = "L1") =>
  store.appendEvent(CHILD_LINK, { link_id: id, slice: "S-1", mode, root_realpath: tmp, worktree_realpath: tmp });
const gate = (verdict: string, base = sha, id = "L1") =>
  store.appendEvent(CHILD_GATE, { link_id: id, slice: "S-1", verdict, citation: "a.ts:1", base_commit: base });
const guard = () => completionGuard(store, { slice: "S-1", repoDir: tmp });

describe("completionGuard", () => {
  it("no links -> ok", () => {
    expect(guard().ok).toBe(true);
  });

  it("delegate with no gate verdict refuses naming the link", () => {
    link("delegate");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("newest child link L1 has no APPROVE");
  });

  it("delegate APPROVE ok", () => {
    link("delegate");
    gate("APPROVE");
    const r = guard();
    expect(r.ok).toBe(true);
    expect(r.evidence.join("\n")).toContain(sha);
  });

  it("CORRECTION after APPROVE refuses", () => {
    link("delegate");
    gate("APPROVE");
    gate("CORRECTION");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("latest child verdict is CORRECTION, not APPROVE");
  });

  it("missing base_commit refuses", () => {
    link("delegate");
    gate("APPROVE", "deadbeef".repeat(5));
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("base_commit deadbeef");
  });

  it("direct without verify refuses; with verify ok", () => {
    link("direct");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("direct mode: no host verification recorded after link L1; run gw scope verify");
    store.appendEvent(SCOPE_VERIFY, { slice: "S-1", citation: "a.ts:1" });
    expect(guard().ok).toBe(true);
  });

  it("inbox file not yet ingested: guard ingests then passes", () => {
    link("delegate");
    writeInboxEvent(tmp, "L1", CHILD_GATE, { link_id: "L1", slice: "S-1", verdict: "APPROVE", citation: "a.ts:1", base_commit: sha });
    expect(store.getEvents(CHILD_GATE)).toHaveLength(0);
    expect(guard().ok).toBe(true);
    expect(store.getEvents(CHILD_GATE)).toHaveLength(1);
  });
});

describe("gateStatus", () => {
  it("root: main worktree, no pointer", () => {
    store.completeSlice("S-1");
    store.appendEvent("GATE_APPROVE", { citation: "a.ts:1", created_at: "2026-01-01T00:00:00.000Z" });
    const s = gateStatus({ cwd: tmp });
    expect(s).toEqual({
      v: 1, scope: "root", slices: { open: 0, complete: 1 }, gate: "APPROVE", approved_at: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("root with open slice and no gate", () => {
    const s = gateStatus({ cwd: tmp });
    expect(s.slices).toEqual({ open: 1, complete: 0 });
    expect(s.gate).toBe("none");
    expect(s.approved_at).toBeUndefined();
  });

  it("child: pointer present, no store", () => {
    const child = path.join(tmp, "child");
    mkdirSync(path.join(child, ".groundwork"), { recursive: true });
    writeFileSync(path.join(child, ".groundwork", "parent"), serializePointer({
      v: 1, motive: "m", slice: "S-1", link_id: "L1", mode: "delegate", root: tmp, created: "2026-01-01T00:00:00Z",
    }));
    const s = gateStatus({ cwd: child });
    expect(s.scope).toBe("child");
    expect(s.mode).toBe("delegate");
    expect(s.parent).toEqual({ motive: "m", slice: "S-1", link_id: "L1", root: tmp });
    expect(s.slices).toEqual({ open: 0, complete: 0 });
    expect(s.gate).toBe("none");
  });

  it("orphan: linked git worktree without pointer", () => {
    const wt = path.join(tmp, "wt");
    expect(git(tmp, "worktree", "add", "-q", wt, "-b", "b").status).toBe(0);
    expect(gateStatus({ cwd: wt }).scope).toBe("orphan");
  });

  it("orphan: non-git dir", () => {
    const d = realpathSync(mkdtempSync(path.join(tmpdir(), "gs-ng-")));
    try {
      const s = gateStatus({ cwd: d });
      expect(s.scope).toBe("orphan");
      expect(s.slices).toEqual({ open: 0, complete: 0 });
      expect(s.gate).toBe("none");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
