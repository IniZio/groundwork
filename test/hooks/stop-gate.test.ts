import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { run, checkStore, detectYield, extractBackgroundAgentIds, getCurrentHead } from "../../src/hooks/stop-gate.js";
import { WorkStore } from "../../src/store/store.js";
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

  it("MULTI-MOTIVE: completing and approving motive A does not release gate when motive B has incomplete slices", () => {
    const { db, dbPath } = makeDb("multi-motive-ab");
    const now = new Date().toISOString();

    db.run("INSERT INTO motives (id, status, created_at) VALUES ('motive-a', 'active', ?)", [now]);
    db.run("INSERT INTO motives (id, status, created_at) VALUES ('motive-b', 'active', ?)", [now]);
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at,motive_id) VALUES ('A1',1,'complete',?,?,'motive-a')",
      [now, now]);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE','{}',?,'motive-a')", [now]);
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('B1',1,'pending',?,'motive-b')", [now]);
    db.close();

    const result = run({ session_id: "t-multi" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("incomplete");
    expect(String(out.reason)).toContain("motive-b");
  });

  it("MULTI-MOTIVE: all motives complete + all have GATE_APPROVE → allow", () => {
    const { db, dbPath } = makeDb("multi-motive-both-done");
    const now = new Date().toISOString();

    db.run("INSERT INTO motives (id, status, created_at) VALUES ('alpha', 'active', ?)", [now]);
    db.run("INSERT INTO motives (id, status, created_at) VALUES ('beta', 'active', ?)", [now]);

    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at,motive_id) VALUES ('A1',1,'complete',?,?,'alpha')",
      [now, now]);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE','{}',?,'alpha')", [now]);

    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at,motive_id) VALUES ('B1',1,'complete',?,?,'beta')",
      [now, now]);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE','{}',?,'beta')", [now]);

    db.close();

    const result = run({ session_id: "t-both-done" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(out.continue).toBe(true);
  });

  it("MULTI-MOTIVE BITE-PROOF: ignoring motive scope hides B's incomplete slices — gate would falsely allow", () => {
    const { db, dbPath } = makeDb("multi-motive-bite");
    const now = new Date().toISOString();

    db.run("INSERT INTO motives (id, status, created_at) VALUES ('motive-a', 'active', ?)", [now]);
    db.run("INSERT INTO motives (id, status, created_at) VALUES ('motive-b', 'active', ?)", [now]);
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at,motive_id) VALUES ('A1',1,'complete',?,?,'motive-a')",
      [now, now]);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE','{}',?,'motive-a')", [now]);
    db.run("INSERT INTO slices (id,wave,status,created_at,motive_id) VALUES ('B1',1,'pending',?,'motive-b')", [now]);
    db.close();

    const { motiveDetails, incomplete, approved } = checkStore(dbPath);
    expect(incomplete).toBeGreaterThan(0);
    const bStatus = motiveDetails.find(m => m.motiveId === "motive-b");
    expect(bStatus).toBeDefined();
    expect(bStatus!.incomplete).toBe(1);
    expect(bStatus!.approved).toBe(false);
    const aStatus = motiveDetails.find(m => m.motiveId === "motive-a");
    expect(aStatus!.approved).toBe(true);
    expect(approved).toBe(false);
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

describe("stop-gate — verdict logic (T13)", () => {
  it("APPROVE then CORRECTION → gate closed (stale-verdict regression)", () => {
    const { db, dbPath } = makeDb("approve-then-correction");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_CORRECTION','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-verdict-1" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/GATE_APPROVE/i);
  });

  it("CORRECTION then APPROVE → gate open", () => {
    const { db, dbPath } = makeDb("correction-then-approve");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_CORRECTION','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-verdict-2" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
  });

  it("per-motive isolation — ONE store, two motives: CORRECTION on A doesn't affect B", () => {
    const { dbPath } = makeDb("one-store-two-motives");
    const store = new WorkStore(dbPath);
    store.createMotive("ma");
    store.createMotive("mb");

    // Complete slice for motive A; APPROVE then CORRECTION
    store.setMotiveContext("ma");
    store.insertSlice({ id: "SA", wave: 1, status: "pending", covers_ac: null, decisions: null, acceptance: null, blocked_by: null });
    store.completeSlice("SA");
    store.appendEvent("GATE_APPROVE", { citation: "src/x.ts:1" });
    store.appendEvent("GATE_CORRECTION", { citation: "src/x.ts:2" });

    store.setMotiveContext("mb");
    store.insertSlice({ id: "SB", wave: 1, status: "pending", covers_ac: null, decisions: null, acceptance: null, blocked_by: null });
    store.completeSlice("SB");
    store.appendEvent("GATE_APPROVE", { citation: "src/y.ts:1" });

    expect(store.getNewestGateVerdict("ma")?.event_type).toBe("GATE_CORRECTION");
    expect(store.getNewestGateVerdict("mb")?.event_type).toBe("GATE_APPROVE");

    store.close();

    const { approved, motiveDetails } = checkStore(dbPath);
    const ma = motiveDetails.find(m => m.motiveId === "ma");
    const mb = motiveDetails.find(m => m.motiveId === "mb");
    expect(ma?.approved).toBe(false);
    expect(mb?.approved).toBe(true);
    expect(approved).toBe(false);

    const result = run({ session_id: "t-iso-single" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("ma");
  });

  it("STOP verdict → gate closed", () => {
    const { db, dbPath } = makeDb("stop-verdict");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_STOP','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-stop" }, { GROUNDWORK_DB: dbPath });
    expect(JSON.parse(result.stdout).decision).toBe("block");
  });

  it("GAPS verdict → gate closed", () => {
    const { db, dbPath } = makeDb("gaps-verdict");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_GAPS','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-gaps" }, { GROUNDWORK_DB: dbPath });
    expect(JSON.parse(result.stdout).decision).toBe("block");
  });

  it("REPLAN verdict → gate closed", () => {
    const { db, dbPath } = makeDb("replan-verdict");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_REPLAN','{}',?)", [new Date().toISOString()]);
    db.close();
    const result = run({ session_id: "t-replan" }, { GROUNDWORK_DB: dbPath });
    expect(JSON.parse(result.stdout).decision).toBe("block");
  });

  it("checkStore verdict: CORRECTION after APPROVE → motive approved=false", () => {
    const { db, dbPath } = makeDb("newest-verdict");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [new Date().toISOString(), new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE','{}',?)", [new Date().toISOString()]);
    db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_CORRECTION','{}',?)", [new Date().toISOString()]);
    db.close();
    const { approved, motiveDetails } = checkStore(dbPath);
    // newest verdict is CORRECTION → not approved
    expect(motiveDetails[0]?.approved ?? approved).toBe(false);
    expect(approved).toBe(false);
  });
});

describe("stop-gate — HEAD binding (T14)", () => {
  let gitDir: string;
  let dbPath: string;

  function initGitRepo(): { gitDir: string; dbPath: string; initialHead: string } {
    const d = mkdtempSync(path.join(tmpdir(), "gw-head-test-"));
    spawnSync("git", ["init", "--initial-branch=main", d], { encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: d, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: d, encoding: "utf8" });
    Bun.write(path.join(d, "README.md"), "init");
    spawnSync("git", ["add", "README.md"], { cwd: d, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "init"], { cwd: d, encoding: "utf8" });
    const initialHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: d, encoding: "utf8" }).stdout.trim();
    const dbP = path.join(d, ".groundwork", "work.db");
    mkdirSync(path.join(d, ".groundwork"), { recursive: true });
    return { gitDir: d, dbPath: dbP, initialHead };
  }

  function makeCommit(d: string): string {
    Bun.write(path.join(d, `c-${Date.now()}.txt`), "change");
    spawnSync("git", ["add", "-A"], { cwd: d, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "new commit"], { cwd: d, encoding: "utf8" });
    return spawnSync("git", ["rev-parse", "HEAD"], { cwd: d, encoding: "utf8" }).stdout.trim();
  }

  function makeStoreDb(dbP: string) {
    const store_db = new Database(dbP);
    store_db.exec("PRAGMA journal_mode=WAL");
    return store_db;
  }

  afterEach(() => {
    if (gitDir && existsSync(gitDir)) rmSync(gitDir, { recursive: true, force: true });
  });

  it("approve → stop-gate allows (no new commit, no new slices)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [now, now]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), now]);
    sdb.close();
    const out = JSON.parse(run({ cwd: d, session_id: "t-head-ok" }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.continue).toBe(true);
  });

  it("approve → new commit → stop-gate blocks with 'HEAD moved'", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [now, now]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), now]);
    sdb.close();
    makeCommit(d);
    const out = JSON.parse(run({ cwd: d, session_id: "t-head-moved" }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/HEAD moved/i);
  });

  it("approve → slice added after approval → stop-gate blocks with 'slice added'", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const past = new Date(Date.now() - 5000).toISOString();
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [past, past]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), past]);
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S2',1,'complete',?,?)", [now, now]);
    sdb.close();
    const out = JSON.parse(run({ cwd: d, session_id: "t-slice-added" }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/slice.*added/i);
  });

  it("no git repo → approval honoured (HEAD binding skipped)", () => {
    const d = mkdtempSync(path.join(tmpdir(), "gw-nogit-test-"));
    gitDir = d; dbPath = path.join(d, ".groundwork", "work.db");
    mkdirSync(path.join(d, ".groundwork"), { recursive: true });
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [now, now]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: "abc123" }), now]);
    sdb.close();
    const out = JSON.parse(run({ cwd: d, session_id: "t-nogit" }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.continue).toBe(true);
  });

  it("BITE-PROOF: HEAD moved test goes red when comparison removed", () => {
    const { gitDir: d, initialHead } = initGitRepo();
    gitDir = d; dbPath = path.join(d, ".groundwork", "work.db");
    const newHead = makeCommit(d);
    expect(initialHead).not.toBe(newHead);
    const currentHead = getCurrentHead(d);
    expect(currentHead).toBe(newHead);
    expect(currentHead).not.toBe(initialHead);
  });

  it("RC1: HEAD-moved void + running background advisor → allow (yield)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [now, now]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), now]);
    sdb.close();
    makeCommit(d);
    const bgTasks = [{ id: "a1", type: "subagent", status: "running", agent_type: "groundwork:advisor" }];
    const out = JSON.parse(run({ cwd: d, session_id: "rc1-head", background_tasks: bgTasks }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.continue).toBe(true);
    expect(String(out.reason)).toMatch(/in-flight|background/i);
  });

  it("RC1: slice-added void + running background advisor → allow (yield)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const past = new Date(Date.now() - 5000).toISOString();
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [past, past]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), past]);
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S2',1,'complete',?,?)", [now, now]);
    sdb.close();
    const bgTasks = [{ id: "a1", type: "subagent", status: "running", agent_type: "groundwork:advisor" }];
    const out = JSON.parse(run({ cwd: d, session_id: "rc1-slice", background_tasks: bgTasks }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.continue).toBe(true);
    expect(String(out.reason)).toMatch(/in-flight|background/i);
  });

  it("RC2: HEAD-moved void, no background tasks — 1-3 block, 4-8 allow (sticky), new HEAD re-arms (AC3)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const now = new Date().toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [now, now]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), now]);
    sdb.close();
    makeCommit(d);
    const inp = { cwd: d, session_id: "rc2", stop_hook_active: true, background_tasks: [] };
    const r1 = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
    const r2 = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
    const r3 = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
    expect(r1.decision).toBe("block");
    expect(String(r1.reason)).toMatch(/HEAD moved/i);
    expect(r2.decision).toBe("block");
    expect(r3.decision).toBe("block");
    expect(String(r3.reason)).toMatch(/externally unresolvable|resolve store state/i);
    const r4 = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
    expect(r4.continue).toBe(true);
    expect(String(r4.reason)).toMatch(/consecutive block limit/i);
    for (let i = 5; i <= 8; i++) {
      const ri = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
      expect(ri.continue).toBe(true);
    }
    makeCommit(d);
    const r9 = JSON.parse(run(inp, { GROUNDWORK_DB: dbPath }).stdout);
    expect(r9.decision).toBe("block");
    expect(String(r9.reason)).toMatch(/HEAD moved/i);
  });

  it("AC2a: approval predates session (transcript first-entry after approval), HEAD moved → allow with notice", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const approvalTime = "2026-09-23T10:00:00.000Z";
    const sessionFirstEntry = "2026-09-23T11:00:00.000Z";
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [approvalTime, approvalTime]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), approvalTime]);
    sdb.close();
    makeCommit(d);
    const transcriptPath = path.join(d, ".groundwork", "test-transcript-a.jsonl");
    const tline = JSON.stringify({ parentUuid: null, type: "human", uuid: "u1", timestamp: sessionFirstEntry });
    Bun.write(transcriptPath, tline + "\n");
    dbFiles.push(transcriptPath);
    const out = JSON.parse(run({ cwd: d, session_id: "t-ac2a", background_tasks: [], transcript_path: transcriptPath }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.continue).toBe(true);
    expect(String(out.reason)).toMatch(/run finished|not gating/i);
  });

  it("AC2b: same-session approval (realistic timestamps: slices done before approval, HEAD moved) → blocks", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const sessionStart = new Date(Date.now() - 600000).toISOString();
    const sliceDone = new Date(Date.now() - 300000).toISOString();
    const approvalTime = new Date(Date.now() - 60000).toISOString();
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [sliceDone, sliceDone]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), approvalTime]);
    sdb.close();
    makeCommit(d);
    const transcriptPath = path.join(d, ".groundwork", "test-transcript-b.jsonl");
    const tline = JSON.stringify({ parentUuid: null, type: "human", uuid: "u1", timestamp: sessionStart });
    Bun.write(transcriptPath, tline + "\n");
    dbFiles.push(transcriptPath);
    const out = JSON.parse(run({ cwd: d, session_id: "t-ac2b", background_tasks: [], transcript_path: transcriptPath }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/HEAD moved/i);
  });

  it("AC2c: no transcript_path + HEAD moved → fail closed (blocks)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const past = "2026-09-23T10:00:00.000Z";
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [past, past]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), past]);
    sdb.close();
    makeCommit(d);
    const out = JSON.parse(run({ cwd: d, session_id: "t-ac2c", background_tasks: [] }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/HEAD moved/i);
  });

  it("AC2d: SQLite-format approval after session start → blocks (spawned TZ=Asia/Tokyo, bites without +Z normalization)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const sqliteApprovalAt = "2026-09-23 12:30:00";
    const sessionFirstEntry = "2026-09-23T12:00:00.000Z";
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)",
      [sqliteApprovalAt, sqliteApprovalAt]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), sqliteApprovalAt]);
    sdb.close();
    makeCommit(d);
    const transcriptPath = path.join(d, ".groundwork", "test-transcript-d.jsonl");
    const tline = JSON.stringify({ parentUuid: null, type: "human", uuid: "u1", timestamp: sessionFirstEntry });
    Bun.write(transcriptPath, tline + "\n");
    dbFiles.push(transcriptPath);
    const hookPath = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");
    const inp = JSON.stringify({ cwd: d, session_id: "t-ac2d", background_tasks: [], transcript_path: transcriptPath });
    const result = spawnSync("bun", ["run", hookPath], {
      input: inp,
      env: { ...process.env, GROUNDWORK_DB: dbPath, TZ: "Asia/Tokyo" },
      encoding: "utf8",
    });
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/HEAD moved/i);
  });

  it("AC2-NOTIMESTAMP: transcript with no top-level timestamp lines + old approval + HEAD moved → fail closed (blocks)", () => {
    const { gitDir: d, dbPath: db, initialHead } = initGitRepo();
    gitDir = d; dbPath = db;
    const sdb = makeStoreDb(dbPath);
    runMigrations(sdb, MIGRATIONS);
    const past = "2026-09-23T04:00:00.000Z";
    sdb.run("INSERT INTO slices (id,wave,status,created_at,completed_at) VALUES ('S1',1,'complete',?,?)", [past, past]);
    sdb.run("INSERT INTO events (event_type,payload,created_at) VALUES ('GATE_APPROVE',?,?)",
      [JSON.stringify({ citation: "src/x.ts:1", base_commit: initialHead }), past]);
    sdb.close();
    makeCommit(d);
    const transcriptPath = path.join(d, ".groundwork", "test-transcript-notimestamp.jsonl");
    Bun.write(transcriptPath, JSON.stringify({ type: "system", mode: "interactive", sessionId: "s1" }) + "\n"
      + JSON.stringify({ type: "system", subtype: "init" }) + "\n");
    dbFiles.push(transcriptPath);
    const out = JSON.parse(run({ cwd: d, session_id: "t-notimestamp", background_tasks: [], transcript_path: transcriptPath }, { GROUNDWORK_DB: dbPath }).stdout);
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toMatch(/HEAD moved/i);
  });
});

describe("stop-gate — AC1: motive-complete release", () => {
  it("AC1: all motives marked complete in DB → allow even with slices present", () => {
    const { db, dbPath } = makeDb("ac1-motive-complete");
    const now = new Date().toISOString();
    db.run("UPDATE motives SET status = 'complete' WHERE id = 'default'");
    db.run("INSERT INTO slices (id,wave,status,created_at,completed_at,motive_id) VALUES ('S1',1,'complete',?,?,'default')",
      [now, now]);
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES ('GATE_APPROVE','{}',?,?)", [now, "default"]);
    db.close();
    const result = run({ session_id: "t-ac1" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(result.stdout);
    expect(out.continue).toBe(true);
    expect(String(out.reason)).toMatch(/no active motives/i);
  });
});
