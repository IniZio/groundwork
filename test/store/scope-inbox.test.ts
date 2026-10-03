import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkStore } from "../../src/store/store.js";
import { CHILD_GATE, CHILD_LINK, CHILD_REGISTER } from "../../src/store/scope-pointer.js";
import { requirement } from "../../src/store/scope-link.js";
import { spawnSync } from "node:child_process";
import { inboxDir, ingestInbox, writeInboxEvent } from "../../src/store/scope-inbox.js";

let tmp: string;
let store: WorkStore;
beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "inbox-"));
  mkdirSync(path.join(tmp, ".groundwork"), { recursive: true });
  store = new WorkStore(path.join(tmp, "work.db"));
  store.appendEvent(CHILD_LINK, {
    link_id: "L1", slice: "S-1", mode: "direct", root_realpath: tmp, worktree_realpath: tmp,
  });
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const count = (t: string) => store.getEvents(t).length;

describe("writeInboxEvent", () => {
  it("writes one intact JSON file and leaves no temp file", () => {
    const { file } = writeInboxEvent(tmp, "L1", CHILD_REGISTER, { link_id: "L1", slice: "S-1" });
    expect(JSON.parse(readFileSync(file, "utf8")).type).toBe(CHILD_REGISTER);
    expect(readdirSync(inboxDir(tmp, "L1")).filter(f => f.startsWith("."))).toEqual([]);
  });

  it("rejects path-traversing link ids", () => {
    expect(() => writeInboxEvent(tmp, "../x", CHILD_REGISTER, {})).toThrow();
  });

  it("two concurrent bun processes yield 2 intact parseable files", async () => {
    const script = path.join(tmp, "w.ts");
    writeFileSync(script, `
import { writeInboxEvent } from ${JSON.stringify(path.resolve(import.meta.dir, "../../src/store/scope-inbox.ts"))};
for (let i = 0; i < 1; i++) writeInboxEvent(${JSON.stringify(tmp)}, "L1", "CHILD_REGISTER", { link_id: "L1", slice: "S-1" });
`);
    const procs = [0, 1].map(() => Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe", env: { ...process.env } }));
    const codes = await Promise.all(procs.map(p => p.exited));
    expect(codes).toEqual([0, 0]);
    const files = readdirSync(inboxDir(tmp, "L1"));
    expect(files.length).toBe(2);
    for (const f of files) {
      expect(f.startsWith(".")).toBe(false);
      expect(JSON.parse(readFileSync(path.join(inboxDir(tmp, "L1"), f), "utf8")).type).toBe(CHILD_REGISTER);
    }
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 2, rejected: [] });
  });
});

describe("ingestInbox", () => {
  it("inserts valid events and a second ingest inserts zero rows", () => {
    writeInboxEvent(tmp, "L1", CHILD_REGISTER, { link_id: "L1", slice: "S-1" });
    writeInboxEvent(tmp, "L1", CHILD_GATE, {
      link_id: "L1", slice: "S-1", verdict: "APPROVE", citation: "a.ts:1", base_commit: "abc",
    });
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 2, rejected: [] });
    expect(count(CHILD_REGISTER)).toBe(1);
    expect(count(CHILD_GATE)).toBe(1);
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 0, rejected: [] });
    expect(count(CHILD_REGISTER)).toBe(1);
    expect(count(CHILD_GATE)).toBe(1);
  });

  it("ignores temp files and absent inbox", () => {
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 0, rejected: [] });
    mkdirSync(inboxDir(tmp, "L1"), { recursive: true });
    writeFileSync(path.join(inboxDir(tmp, "L1"), ".tmp-x"), "{not json");
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 0, rejected: [] });
  });

  it("rejects unknown link_id", () => {
    writeInboxEvent(tmp, "L9", CHILD_REGISTER, { link_id: "L9", slice: "S-1" });
    const r = ingestInbox(store, tmp);
    expect(r.ingested).toBe(0);
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0].reason).toContain("unknown link_id");
    expect(count(CHILD_REGISTER)).toBe(0);
  });

  it("rejects slice mismatch", () => {
    writeInboxEvent(tmp, "L1", CHILD_REGISTER, { link_id: "L1", slice: "S-2" });
    const r = ingestInbox(store, tmp);
    expect(r.ingested).toBe(0);
    expect(r.rejected[0].reason).toContain("slice");
    expect(count(CHILD_REGISTER)).toBe(0);
  });

  it("rejects payload link_id differing from directory name", () => {
    writeInboxEvent(tmp, "L1", CHILD_REGISTER, { link_id: "L2", slice: "S-1" });
    const r = ingestInbox(store, tmp);
    expect(r.ingested).toBe(0);
    expect(r.rejected[0].reason).toContain("directory");
  });

  it("rejects wrong event type (GATE_APPROVE) — security", () => {
    writeInboxEvent(tmp, "L1", "GATE_APPROVE", { link_id: "L1", slice: "S-1" });
    const r = ingestInbox(store, tmp);
    expect(r.ingested).toBe(0);
    expect(r.rejected[0].reason).toContain("not allowed");
    expect(count("GATE_APPROVE")).toBe(0);
  });

  it("one bad file does not stop good ones; corrupt file reported not thrown", () => {
    mkdirSync(inboxDir(tmp, "L1"), { recursive: true });
    writeFileSync(path.join(inboxDir(tmp, "L1"), "0-bad.json"), "{nope");
    writeInboxEvent(tmp, "L1", CHILD_REGISTER, { link_id: "L1", slice: "S-1" });
    const r = ingestInbox(store, tmp);
    expect(r.ingested).toBe(1);
    expect(r.rejected.length).toBe(1);
  });

  it("inserts under the slice's motive, not the active one; requirement() sees it", () => {
    store.createMotive("m1");
    store.createMotive("other");
    store.insertSlice({ id: "S-9", wave: 1, status: "pending", covers_ac: null, decisions: null, acceptance: null, blocked_by: null, motiveId: "m1" });
    store.appendEvent(CHILD_LINK, {
      link_id: "L9", slice: "S-9", mode: "delegate", root_realpath: tmp, worktree_realpath: tmp,
    }, "m1");
    store.setActiveMotive("other");
    const repo = path.resolve(import.meta.dir, "../..");
    const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"]).stdout.toString().trim();
    writeInboxEvent(tmp, "L9", CHILD_GATE, {
      link_id: "L9", slice: "S-9", verdict: "APPROVE", citation: "x.ts:1", base_commit: head,
    });
    expect(requirement(store, "S-9", repo).satisfied).toBe(false);
    expect(ingestInbox(store, tmp)).toEqual({ ingested: 1, rejected: [] });
    expect(store.getEvents(CHILD_GATE, "m1").length).toBe(1);
    expect(store.getEvents(CHILD_GATE, "other").length).toBe(0);
    expect(requirement(store, "S-9", repo).satisfied).toBe(true);
    expect(ingestInbox(store, tmp).ingested).toBe(0);
  });
});
