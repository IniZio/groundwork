import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { run, checkStore } from "../../src/hooks/stop-gate.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import { ensureSealKey, computeSeal } from "../../src/store/key-store.js";

const TMP = "/dev/shm/gw-stop-gate-seal-test";
mkdirSync(TMP, { recursive: true });
let dbFiles: string[] = [];
let tmpDirs: string[] = [];

function makeDb(label: string): { db: Database; dbPath: string; dir: string } {
  const dir = mkdtempSync(path.join(TMP, `${label}-`));
  tmpDirs.push(dir);
  const dbPath = path.join(dir, ".groundwork", "work.db");
  mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
  dbFiles.push(dbPath);
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  runMigrations(db, MIGRATIONS);
  return { db, dbPath, dir };
}

function cleanUp() {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
  }
  dbFiles = [];
  tmpDirs = [];
}

afterEach(cleanUp);

describe("stop-gate HMAC seal — Family 3", () => {
  it("VIOLATION: forged GATE_APPROVE (no seal) → stop-gate blocks with seal-rejected message", () => {
    const { db, dbPath, dir } = makeDb("forged");
    ensureSealKey(dir);
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('S1',1,'complete',datetime('now'),'default')");
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE',?,datetime('now'),'default')",
      [JSON.stringify({ citation: "src/foo.ts:1", base_commit: "abc1234" })]);
    db.close();
    const result = run({ session_id: "t-forged" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout) as { decision: string; reason: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/seal|forged/i);
  });

  it("CLEAN: GATE_APPROVE with valid HMAC seal → stop-gate allows", () => {
    const { db, dbPath, dir } = makeDb("valid");
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('S1',1,'complete',datetime('now'),'default')");
    const sealKey = ensureSealKey(dir);
    const createdAt = new Date().toISOString();
    const fields = {
      citation: "src/foo.ts:1",
      created_at: createdAt,
      event_type: "GATE_APPROVE",
      motive_id: "default",
      base_commit: null,
    };
    const seal = computeSeal(sealKey, fields);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE',?,?,?)",
      [JSON.stringify({ citation: "src/foo.ts:1", created_at: createdAt, seal }), createdAt, "default"]);
    db.close();
    const result = run({ session_id: "t-valid" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout) as { continue: boolean };
    expect(out.continue).toBe(true);
  });

  it("VIOLATION: GATE_APPROVE with tampered citation → stop-gate blocks", () => {
    const { db, dbPath, dir } = makeDb("tampered");
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('S1',1,'complete',datetime('now'),'default')");
    const sealKey = ensureSealKey(dir);
    const createdAt = new Date().toISOString();
    const fields = {
      citation: "src/foo.ts:1",
      created_at: createdAt,
      event_type: "GATE_APPROVE",
      motive_id: "default",
      base_commit: null,
    };
    const seal = computeSeal(sealKey, fields);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE',?,?,?)",
      [JSON.stringify({ citation: "src/EVIL.ts:999", created_at: createdAt, seal }), createdAt, "default"]);
    db.close();
    const result = run({ session_id: "t-tampered" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout) as { decision: string };
    expect(out.decision).toBe("block");
  });

  it("BITE PROOF: with seal key present, forged (no-seal) GATE_APPROVE is rejected (sealRejected=true, approved=false)", () => {
    const { db, dbPath, dir } = makeDb("bite");
    ensureSealKey(dir);
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('S1',1,'complete',datetime('now'),'default')");
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE',?,datetime('now'),'default')",
      [JSON.stringify({ citation: "src/foo.ts:1" })]);
    db.close();
    const { motiveDetails } = checkStore(dbPath);
    const m = motiveDetails.find(x => x.motiveId === "default")!;
    expect(m.sealRejected).toBe(true);
    expect(m.approved).toBe(false);
  });
});
