import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { run, checkStore } from "../../src/hooks/stop-gate.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

const TMP = "/tmp/gw-stop-gate-test";
mkdirSync(TMP, { recursive: true });
let dbFiles: string[] = [];

function makeDb(label: string): { db: Database; dbPath: string } {
  const dbPath = path.join(TMP, `${label}-${Date.now()}.db`);
  dbFiles.push(dbPath);
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  runMigrations(db, MIGRATIONS);
  return { db, dbPath };
}

function cleanCountFiles(dbPath: string) {
  const dir = path.dirname(dbPath);
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("stop-gate.")) unlinkSync(path.join(dir, f));
    }
  } catch { /* ok */ }
}

afterEach(() => {
  for (const f of dbFiles) {
    try { cleanCountFiles(f); } catch { /* ok */ }
    try { unlinkSync(f); } catch { /* ok */ }
  }
  dbFiles = [];
});

describe("stop-gate — Family 3", () => {
  it("VIOLATION: incomplete slices → block with gw CLI hint", () => {
    const { db, dbPath } = makeDb("incomplete");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t1" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/incomplete/);
    expect(out.reason).toContain("$GW slice complete");
    expect(out.reason).toContain("$GW hold set");
    expect(out.reason).toContain("S1");
  });

  it("VIOLATION: no GATE_APPROVE event → block", () => {
    const { db, dbPath } = makeDb("no-gate");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t2" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/GATE_APPROVE/);
  });

  it("CLEAN: all slices complete + GATE_APPROVE → allow", () => {
    const { db, dbPath } = makeDb("clean");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t3" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });

  it("CLEAN: no db file → allow (no active run)", () => {
    const result = run({}, { GROUNDWORK_DB: "/tmp/nonexistent-gw-999.db" });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });

  it("CLEAN: embedded agent (sdk-js) → allow without reading db", () => {
    const result = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js", GROUNDWORK_DB: "/tmp/nonexistent.db" });
    expect(JSON.parse(result.stdout).continue).toBe(true);
  });

  it("CLEAN: active HOLD (no HOLD_CLEAR) → allow immediately", () => {
    const { db, dbPath } = makeDb("hold-active");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('HOLD','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-hold" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
    expect(out.reason).toContain("HOLD");
  });

  it("CLEAN: HOLD_CLEAR cancels HOLD → gate blocks normally", () => {
    const { db, dbPath } = makeDb("hold-cleared");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('HOLD','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('HOLD_CLEAR','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-cleared" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
  });

  it("COUNTER: 3rd consecutive block emits unresolvable message", () => {
    const { db, dbPath } = makeDb("counter-3");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const env = { GROUNDWORK_DB: dbPath };
    const payload = { session_id: "sess-c3" };
    const r1 = JSON.parse(run(payload, env).stdout);
    const r2 = JSON.parse(run(payload, env).stdout);
    const r3 = JSON.parse(run(payload, env).stdout);
    expect(r1.decision).toBe("block");
    expect(r2.decision).toBe("block");
    expect(r3.decision).toBe("block");
    expect(r3.reason).toContain("unresolvable");
  });

  it("COUNTER: 4th attempt allows after 3 blocks", () => {
    const { db, dbPath } = makeDb("counter-4");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const env = { GROUNDWORK_DB: dbPath };
    const payload = { session_id: "sess-c4" };
    run(payload, env);
    run(payload, env);
    run(payload, env);
    const r4 = JSON.parse(run(payload, env).stdout);
    expect(r4.continue).toBe(true);
  });

  it("COUNTER: counter resets after gate passes — count file absent, next block is count-1 (not unresolvable)", () => {
    const { db, dbPath } = makeDb("counter-reset");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.close();
    const env = { GROUNDWORK_DB: dbPath };
    const payload = { session_id: "sess-reset" };
    const cf = path.join(TMP, `stop-gate.sess-reset.count`);
    run(payload, env);
    run(payload, env);
    const db2 = new Database(dbPath);
    db2.run("UPDATE slices SET status='complete', completed_at=? WHERE id='S1'", [new Date().toISOString()]);
    db2.close();
    const pass = JSON.parse(run(payload, env).stdout);
    expect(pass.continue).toBe(true);
    expect(existsSync(cf)).toBe(false);
    const db3 = new Database(dbPath);
    db3.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S2',1,'pending',?)", [new Date().toISOString()]);
    db3.close();
    const r1 = JSON.parse(run(payload, env).stdout);
    expect(r1.decision).toBe("block");
    expect(r1.reason).not.toContain("unresolvable");
    expect(r1.reason).toContain("$GW slice complete");
  });

  it("GUARD-CAN-FAIL: checkStore with complete slices + no approval returns approved=false", () => {
    const { db, dbPath } = makeDb("can-fail");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.close();
    const { incomplete, approved } = checkStore(dbPath);
    expect(incomplete).toBe(0);
    expect(approved).toBe(false);
  });

  it("GUARD-CAN-FAIL: checkStore detects active HOLD", () => {
    const { db, dbPath } = makeDb("hold-detect");
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('HOLD','{}',?)", [new Date().toISOString()]);
    db.close();
    const { holdActive } = checkStore(dbPath);
    expect(holdActive).toBe(true);
  });
});
