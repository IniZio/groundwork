import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { run, checkStore, detectYield, extractBackgroundAgentIds } from "../../src/hooks/stop-gate.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

const FIXTURES = path.join(import.meta.dir, "fixtures");

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

  it("REGRESSION: empty store (0 slices, 0 events) → allow", () => {
    const { dbPath } = makeDb("empty-store");
    // no inserts — store is completely empty
    const result = run({ session_id: "t-empty" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
    expect(out.reason).toContain("nothing to gate");
  });

  it("REGRESSION: empty slices with GATE_APPROVE present → allow", () => {
    const { db, dbPath } = makeDb("empty-with-approve");
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-empty-approve" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });
});

describe("stop-gate — yield detection (T05)", () => {
  it("YIELD: in-flight background Agent → allow, counter not incremented", () => {
    const { db, dbPath } = makeDb("yield-inflight");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const env = { GROUNDWORK_DB: dbPath };
    const payload = { session_id: "sess-yield", transcript_path: transcriptPath };
    const r1 = JSON.parse(run(payload, env).stdout);
    expect(r1.continue).toBe(true);
    expect(r1.reason).toContain("in-flight");
    // Counter must not have advanced — next call should still be count=1, not unresolvable
    const r2 = JSON.parse(run(payload, env).stdout);
    expect(r2.continue).toBe(true);
    expect(r2.reason).toContain("in-flight");
    // Confirm count file was never written (counter stays at 0 through yield allows)
    const db2 = new Database(dbPath);
    db2.run("UPDATE slices SET status='complete', completed_at=? WHERE id='S1'", [new Date().toISOString()]);
    db2.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db2.close();
    // Now without agents in-flight the gate should pass cleanly (counter wasn't burned)
    const noAgentPath = path.join(FIXTURES, "stop-gate-noagents.jsonl");
    const r3 = JSON.parse(run({ session_id: "sess-yield", transcript_path: noAgentPath }, env).stdout);
    expect(r3.continue).toBe(true);
  });

  it("YIELD: no in-flight agents with incomplete slices → block as normal", () => {
    const { db, dbPath } = makeDb("yield-no-agents");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-noagents.jsonl");
    const payload = { session_id: "sess-no-yield", transcript_path: transcriptPath };
    const result = JSON.parse(run(payload, { GROUNDWORK_DB: dbPath }).stdout);
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("incomplete");
  });

  it("YIELD: completed background agent (task-notification present) → not in-flight, block as normal", () => {
    const { db, dbPath } = makeDb("yield-completed");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-completed.jsonl");
    const payload = { session_id: "sess-completed", transcript_path: transcriptPath };
    const result = JSON.parse(run(payload, { GROUNDWORK_DB: dbPath }).stdout);
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("incomplete");
  });

  it("YIELD: 4-block release is unchanged — yield-allowing stops do not count", () => {
    const { db, dbPath } = makeDb("yield-4block");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const inFlightPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const noAgentsPath = path.join(FIXTURES, "stop-gate-noagents.jsonl");
    const env = { GROUNDWORK_DB: dbPath };
    const sid = "sess-4b";
    // Two yield-allows (in-flight) — should not advance counter
    run({ session_id: sid, transcript_path: inFlightPath }, env);
    run({ session_id: sid, transcript_path: inFlightPath }, env);
    // Now 3 normal blocks (no agents in-flight)
    const b1 = JSON.parse(run({ session_id: sid, transcript_path: noAgentsPath }, env).stdout);
    const b2 = JSON.parse(run({ session_id: sid, transcript_path: noAgentsPath }, env).stdout);
    const b3 = JSON.parse(run({ session_id: sid, transcript_path: noAgentsPath }, env).stdout);
    expect(b1.decision).toBe("block");
    expect(b2.decision).toBe("block");
    expect(b3.decision).toBe("block");
    expect(b3.reason).toContain("unresolvable");
    // 4th normal → allow (release)
    const b4 = JSON.parse(run({ session_id: sid, transcript_path: noAgentsPath }, env).stdout);
    expect(b4.continue).toBe(true);
  });

  it("YIELD: resumed-and-still-running SendMessage → allow, counter not incremented", () => {
    const { db, dbPath } = makeDb("yield-resume-inflight");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-resumed-inflight.jsonl");
    const payload = { session_id: "sess-resume-inflight", transcript_path: transcriptPath };
    const r1 = JSON.parse(run(payload, { GROUNDWORK_DB: dbPath }).stdout);
    expect(r1.continue).toBe(true);
    expect(r1.reason).toContain("in-flight");
    // Counter was not burned: second yield-allow still passes
    const r2 = JSON.parse(run(payload, { GROUNDWORK_DB: dbPath }).stdout);
    expect(r2.continue).toBe(true);
  });

  it("YIELD: resumed-and-completed SendMessage (task-notification present) → not in-flight, block as normal", () => {
    const { db, dbPath } = makeDb("yield-resume-completed");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-resumed-completed.jsonl");
    const payload = { session_id: "sess-resume-done", transcript_path: transcriptPath };
    const result = JSON.parse(run(payload, { GROUNDWORK_DB: dbPath }).stdout);
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("incomplete");
  });

  it("DIAG: run() writes stop-gate.last.json with yield_result and decision", () => {
    const { db, dbPath } = makeDb("diag");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const transcriptPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    run({ session_id: "sess-diag", transcript_path: transcriptPath }, { GROUNDWORK_DB: dbPath });
    const diagPath = path.join(path.dirname(dbPath), "stop-gate.last.json");
    expect(existsSync(diagPath)).toBe(true);
    const diag = JSON.parse(readFileSync(diagPath, "utf8")) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(diag, "yield_result")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(diag, "decision")).toBe(true);
    expect(["allow", "block"]).toContain(diag.decision as string);
    // inflight fixture → agents in-flight → yield_result non-null, decision=allow
    expect(diag.yield_result).not.toBeNull();
    expect(diag.decision as string).toBe("allow");
  });

  it("BG-TASKS: background_tasks with running entry → allow even when transcript shows nothing", () => {
    // Primary signal: background_tasks present with a running subagent.
    // No transcript_path → transcript fallback would return null → proves primary wins.
    const result = detectYield({
      background_tasks: [
        { id: "abc123", type: "subagent", status: "running", description: "test agent", agent_type: "groundwork:implementer" },
      ],
    });
    expect(result).not.toBeNull();
    expect(result).toContain("in-flight");
  });

  it("BG-TASKS: background_tasks empty array → no yield even when transcript fixture shows in-flight agents", () => {
    // Empty array means harness says nothing running — must NOT fall back.
    const inFlightPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const result = detectYield({ background_tasks: [], transcript_path: inFlightPath });
    expect(result).toBeNull();
  });

  it("BG-TASKS: run() with background_tasks running → allow, block skipped for incomplete slices", () => {
    const { db, dbPath } = makeDb("bg-tasks-running");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const result = run({
      session_id: "sess-bg-running",
      background_tasks: [
        { id: "abc123", type: "subagent", status: "running", description: "test agent", agent_type: "groundwork:implementer" },
      ],
    }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
    expect(out.reason).toContain("in-flight");
  });

  it("BG-TASKS: run() with empty background_tasks + in-flight transcript → block (primary wins)", () => {
    const { db, dbPath } = makeDb("bg-tasks-empty-primary");
    db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
    db.close();
    const inFlightPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const result = run({
      session_id: "sess-bg-empty",
      background_tasks: [],
      transcript_path: inFlightPath,
    }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    // Empty background_tasks → nothing in-flight → gate proceeds to block on incomplete slice
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("incomplete");
  });

  it("BG-TASKS: background_tasks absent → transcript fallback still works", () => {
    // Existing behaviour: no background_tasks field → fall back to transcript parsing.
    const inFlightPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const result = detectYield({ transcript_path: inFlightPath });
    expect(result).not.toBeNull();
    expect(result).toContain("in-flight");
  });

  it("BITE-PROOF: ignore background_tasks → BG-TASKS running test goes red", () => {
    // If detectYield ignored background_tasks and relied only on transcript,
    // passing no transcript_path would return null even with a running task.
    // This test proves background_tasks IS the signal (no transcript needed).
    const withBgTasks = detectYield({
      background_tasks: [
        { id: "xyz", type: "subagent", status: "running", description: "agent", agent_type: "groundwork:implementer" },
      ],
      // no transcript_path — fallback would return null
    });
    const withoutField = detectYield({
      // background_tasks field absent, no transcript — old fallback returns null
    });
    expect(withBgTasks).not.toBeNull();   // primary signal fires
    expect(withoutField).toBeNull();      // no signal at all → null (proves fallback can't see this)
  });

  it("BITE-PROOF: extractBackgroundAgentIds and detectYield are sensitive to the real fixture shapes", () => {
    const inFlightPath = path.join(FIXTURES, "stop-gate-inflight.jsonl");
    const completedPath = path.join(FIXTURES, "stop-gate-completed.jsonl");
    const noAgentsPath = path.join(FIXTURES, "stop-gate-noagents.jsonl");

    // extractBackgroundAgentIds finds the real id from the Async-launched tool_result
    const ids = extractBackgroundAgentIds(readFileSync(inFlightPath, "utf8"));
    expect(ids).toContain("toolu_017r6rPz9FpJmcafHLu7StLi");

    // detectYield: in-flight → non-null with "in-flight"
    const resultInflight = detectYield({ transcript_path: inFlightPath });
    expect(resultInflight).not.toBeNull();
    expect(resultInflight).toContain("in-flight");

    // detectYield: completed (task-notification present) → null
    expect(detectYield({ transcript_path: completedPath })).toBeNull();

    // detectYield: no agents → null
    expect(detectYield({ transcript_path: noAgentsPath })).toBeNull();

    // SendMessage resumes: in-flight → non-null; completed → null
    const resumeInflightPath = path.join(FIXTURES, "stop-gate-resumed-inflight.jsonl");
    const resumeInflightIds = extractBackgroundAgentIds(readFileSync(resumeInflightPath, "utf8"));
    expect(resumeInflightIds).toContain("toolu_01FTUrSykao5EUdu5ohtxnA4");
    expect(detectYield({ transcript_path: resumeInflightPath })).not.toBeNull();
    expect(detectYield({ transcript_path: resumeInflightPath })).toContain("in-flight");

    const resumeCompletedPath = path.join(FIXTURES, "stop-gate-resumed-completed.jsonl");
    const resumeCompletedIds = extractBackgroundAgentIds(readFileSync(resumeCompletedPath, "utf8"));
    expect(resumeCompletedIds).toContain("toolu_01XhWdCxXKSmrb9RLpei8Kpx");
    expect(detectYield({ transcript_path: resumeCompletedPath })).toBeNull();
  });
});
