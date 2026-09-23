import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EVENT_TYPES } from "../../src/store/store.js";

const CLI = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const STOP_GATE = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");

function run(args: string[], cwd: string, env?: Record<string, string>) {
  const result = Bun.spawnSync(["bun", CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 0,
  };
}

function stopGate(testDir: string, sessionId = "seam-test"): Record<string, unknown> {
  const r = Bun.spawnSync(["bun", STOP_GATE], {
    cwd: testDir,
    stdin: Buffer.from(JSON.stringify({ cwd: testDir, session_id: sessionId })),
    env: { ...process.env },
  });
  try { return JSON.parse(r.stdout.toString().trim()) as Record<string, unknown>; }
  catch { return {}; }
}

function initRepo(d: string): string {
  const r = run(["init"], d);
  const m = r.stdout.match(/token: (\S+)/);
  if (!m) throw new Error(`init produced no token: ${r.stdout} ${r.stderr}`);
  return m[1];
}

let dir: string;
let tok: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gw-test-"));
  tok = initRepo(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("slice lifecycle", () => {
  it("add → status 0/1 → complete → 1/1", () => {
    const add = run(["slice", "add", "S-1", "--desc", "test slice", "--token", tok], dir);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("S-1 added");

    const before = run(["slice", "status"], dir);
    expect(before.stdout).toContain("0/1");

    const done = run(["slice", "complete", "S-1", "--token", tok], dir);
    expect(done.exitCode).toBe(0);

    const after = run(["slice", "status"], dir);
    expect(after.stdout).toContain("1/1");
  });
});

describe("gate approve", () => {
  it("refuses without a file:line citation", () => {
    const r = run(["gate", "approve", "--citation", "no-line-ref", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("file:line");
  });

  it("accepts a valid file:line citation", () => {
    const r = run(["gate", "approve", "--citation", "src/store/store.ts:42", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("GATE_APPROVE");
  });
});

describe("gate verdicts (T13)", () => {
  it("correction requires citation", () => {
    const r = run(["gate", "correction", "--citation", "no-line-ref", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("file:line");
  });

  it("correction without citation rejected", () => {
    const r = run(["gate", "correction", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
  });

  it("correction with valid citation records GATE_CORRECTION", () => {
    const r = run(["gate", "correction", "--citation", "src/foo.ts:10", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("GATE_CORRECTION");
  });

  it("stop with valid citation records GATE_STOP", () => {
    const r = run(["gate", "stop", "--citation", "src/bar.ts:5", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("GATE_STOP");
  });

  it("gaps with valid citation records GATE_GAPS", () => {
    const r = run(["gate", "gaps", "--citation", "src/baz.ts:1", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("GATE_GAPS");
  });

  it("replan with valid citation records GATE_REPLAN", () => {
    const r = run(["gate", "replan", "--citation", "src/qux.ts:7", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("GATE_REPLAN");
  });

  it("APPROVE then CORRECTION → stop-gate closed", () => {
    run(["slice", "add", "V1", "--token", tok], dir);
    run(["slice", "complete", "V1", "--token", tok], dir);
    run(["gate", "approve", "--citation", "src/x.ts:1", "--token", tok], dir);
    run(["gate", "correction", "--citation", "src/x.ts:2", "--token", tok], dir);
    const result = stopGate(dir, "verdict-seam-1");
    expect(result.decision).toBe("block");
  });

  it("CORRECTION then APPROVE → stop-gate open", () => {
    run(["slice", "add", "V2", "--token", tok], dir);
    run(["slice", "complete", "V2", "--token", tok], dir);
    run(["gate", "correction", "--citation", "src/x.ts:2", "--token", tok], dir);
    run(["gate", "approve", "--citation", "src/x.ts:1", "--token", tok], dir);
    const result = stopGate(dir, "verdict-seam-2");
    expect(result.continue).toBe(true);
  });

  it("unknown verdict rejected", () => {
    const r = run(["gate", "badverdict", "--citation", "src/x.ts:1", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
  });
});

describe("hold state", () => {
  it("hold set appears in status; hold clear removes it", () => {
    run(["hold", "set", "--reason", "blocked on review", "--token", tok], dir);
    const onHold = run(["slice", "status"], dir);
    expect(onHold.stdout).toContain("blocked on review");

    run(["hold", "clear", "--token", tok], dir);
    const cleared = run(["slice", "status"], dir);
    expect(cleared.stdout).toContain("hold: none");
  });
});

describe("event append", () => {
  it("every non-gate EVENT_TYPES entry appends without error", () => {
    for (const type of EVENT_TYPES) {
      if (type.startsWith("GATE_")) continue;
      const r = run(["event", "append", "--type", type, "--msg", `test ${type}`, "--token", tok], dir);
      expect(r.exitCode).toBe(0);
    }
  });

  it("GATE_APPROVE via event append exits non-zero naming gate approve command", () => {
    const r = run(["event", "append", "--type", "GATE_APPROVE", "--token", tok], dir);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("gate approve");
  });

  it("all GATE_* types rejected by event append", () => {
    for (const type of ["GATE_APPROVE", "GATE_CORRECTION", "GATE_STOP", "GATE_GAPS", "GATE_REPLAN"]) {
      const r = run(["event", "append", "--type", type, "--token", tok], dir);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("gate");
    }
  });

  it("compile shows last PAUSE msg", () => {
    run(["event", "append", "--type", "PAUSE", "--msg", "stopping for handoff", "--data", '{"next_actions":"resume S2"}', "--token", tok], dir);
    const c = run(["compile"], dir);
    expect(c.stdout).toContain("stopping for handoff");
  });
});

describe("DECISION events in compile (regression: decisions (0))", () => {
  it("two DECISION events appear in compile output", () => {
    run(["event", "append", "--type", "DECISION", "--msg", "use SQLite for storage", "--token", tok], dir);
    run(["event", "append", "--type", "DECISION", "--msg", "events are append-only", "--token", tok], dir);
    const c = run(["compile"], dir);
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain("decisions (2)");
    expect(c.stdout).toContain("use SQLite for storage");
    expect(c.stdout).toContain("events are append-only");
  });

  it("BITE PROOF: compile currently reads events table — removing the events breaks the count", () => {
    // Append 2 DECISION events
    run(["event", "append", "--type", "DECISION", "--msg", "decision A", "--token", tok], dir);
    run(["event", "append", "--type", "DECISION", "--msg", "decision B", "--token", tok], dir);
    const c = run(["compile"], dir);
    // Confirm we see them; if the old decisions table (empty) were used, count would be 0
    expect(c.stdout).not.toContain("decisions (0)");
    expect(c.stdout).toContain("decisions (2)");
  });
});

describe("OBJECTIVE event in compile", () => {
  it("OBJECTIVE event set via event append appears in compile", () => {
    run(["event", "append", "--type", "OBJECTIVE", "--msg", "ship parity recovery", "--token", tok], dir);
    const c = run(["compile"], dir);
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain("ship parity recovery");
  });

  it("gw init --objective appends OBJECTIVE event and it appears in compile", () => {
    // Re-init with objective (idempotent — token already set)
    const r = run(["init", "--objective", "deliver v2 parity"], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("objective set");
    const c = run(["compile"], dir);
    expect(c.stdout).toContain("deliver v2 parity");
  });

  it("newest OBJECTIVE event wins when multiple are appended", () => {
    run(["event", "append", "--type", "OBJECTIVE", "--msg", "old goal", "--token", tok], dir);
    run(["event", "append", "--type", "OBJECTIVE", "--msg", "new goal", "--token", tok], dir);
    const c = run(["compile"], dir);
    expect(c.stdout).toContain("new goal");
    expect(c.stdout).not.toContain("old goal");
  });
});

describe("migration v4 — dead tables dropped on existing store", () => {
  it("store seeded with v1-v3 schema keeps events and slices after v4 migration", () => {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const { runMigrations } = require("../../src/store/migrations.js") as typeof import("../../src/store/migrations.js");
    const { MIGRATIONS } = require("../../src/store/schema.js") as typeof import("../../src/store/schema.js");

    // Build a store at v3 (no v4)
    const migsV3 = MIGRATIONS.filter((m: { version: number }) => m.version <= 3);
    const db = new Database(":memory:");
    runMigrations(db, migsV3);

    // Seed data into old tables
    db.run("INSERT INTO slices (id, wave, status, created_at) VALUES ('S-old', 1, 'pending', '2024-01-01')");
    db.run("INSERT INTO events (event_type, payload, created_at) VALUES ('DECISION', '{\"msg\":\"keep me\"}', '2024-01-01')");
    db.run("INSERT INTO decisions (id, status, kind, decision, created_at) VALUES ('D-old', 'proposed', 'DECISION', 'old row', '2024-01-01')");

    // Apply v4
    runMigrations(db, MIGRATIONS);

    // Slices and events survive
    const slices = db.query<{ id: string }, []>("SELECT id FROM slices").all();
    expect(slices.some((s: { id: string }) => s.id === "S-old")).toBe(true);
    const events = db.query<{ payload: string }, []>("SELECT payload FROM events WHERE event_type = 'DECISION'").all();
    expect(events).toHaveLength(1);

    // Dead tables are gone
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: { name: string }) => r.name);
    expect(tables).not.toContain("decisions");
    expect(tables).not.toContain("charter");

    db.close();
  });
});


describe("slice rm", () => {
  it("rm on a completed slice is refused with D-12 trigger message", () => {
    run(["slice", "add", "S-del", "--token", tok], dir);
    run(["slice", "complete", "S-del", "--token", tok], dir);
    const r = run(["slice", "rm", "S-del", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("D-12");
  });

  it("rm on a pending slice succeeds", () => {
    run(["slice", "add", "S-pend", "--token", tok], dir);
    const r = run(["slice", "rm", "S-pend", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
  });
});

describe("token guard", () => {
  it("mutation without --token is refused", () => {
    const r = run(["slice", "add", "S-noauth", "--desc", "x"], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--token");
  });

  it("mutation with wrong token is refused", () => {
    const r = run(["slice", "add", "S-bad", "--token", "wrongtoken"], dir);
    expect(r.exitCode).toBe(1);
  });
});

describe("multi-motive CLI", () => {
  it("--motive scopes slice add and compile to that motive", () => {
    run(["--motive", "default", "motive", "add", "alpha", "--use", "--token", tok], dir);
    run(["--motive", "alpha", "slice", "add", "A-1", "--token", tok], dir);
    run(["--motive", "default", "slice", "add", "D-1", "--token", tok], dir);

    const ca = run(["--motive", "alpha", "compile"], dir);
    expect(ca.stdout).toContain("A-1");
    expect(ca.stdout).not.toContain("D-1");

    const cd = run(["--motive", "default", "compile"], dir);
    expect(cd.stdout).toContain("D-1");
    expect(cd.stdout).not.toContain("A-1");
  });

  it("compile shows the active motive name", () => {
    const c = run(["compile"], dir);
    expect(c.stdout).toContain("motive:");
    expect(c.stdout).toContain("default");
  });

  it("motive list shows all motives with active marker", () => {
    run(["motive", "add", "work", "--token", tok], dir);
    const r = run(["motive", "list"], dir);
    expect(r.stdout).toContain("default");
    expect(r.stdout).toContain("work");
    expect(r.stdout).toMatch(/\* default/);
  });

  it("motive use switches active motive", () => {
    run(["motive", "add", "next", "--token", tok], dir);
    run(["motive", "use", "next", "--token", tok], dir);
    const r = run(["motive", "list"], dir);
    expect(r.stdout).toMatch(/\* next/);
  });

  it("migration v5: old-schema store (pre-motives) migrates with counts preserved", () => {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const { runMigrations } = require("../../src/store/migrations.js") as typeof import("../../src/store/migrations.js");
    const { MIGRATIONS } = require("../../src/store/schema.js") as typeof import("../../src/store/schema.js");

    const migsV4 = MIGRATIONS.filter((m: { version: number }) => m.version <= 4);
    const db = new Database(":memory:");
    runMigrations(db, migsV4);

    db.run("INSERT INTO slices (id, wave, status, created_at) VALUES ('S-old', 1, 'pending', '2024-01-01')");
    db.run("INSERT INTO events (event_type, payload, created_at) VALUES ('DECISION', '{\"msg\":\"keep\"}', '2024-01-01')");

    runMigrations(db, MIGRATIONS);

    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: { name: string }) => r.name);
    expect(tables).toContain("motives");

    const slices = db.query<{ id: string; motive_id: string }, []>("SELECT id, motive_id FROM slices").all();
    expect(slices).toHaveLength(1);
    expect(slices[0].id).toBe("S-old");
    expect(slices[0].motive_id).toBe("default");

    const events = db.query<{ motive_id: string }, []>("SELECT motive_id FROM events WHERE event_type='DECISION'").all();
    expect(events).toHaveLength(1);
    expect(events[0].motive_id).toBe("default");

    const motives = db.query<{ id: string }, []>("SELECT id FROM motives").all();
    expect(motives.some((m: { id: string }) => m.id === "default")).toBe(true);

    db.close();
  });
});

describe("stop-gate seam", () => {
  it("incomplete slice → block with gw slice complete hint", () => {
    run(["slice", "add", "SG-1", "--token", tok], dir);
    const result = stopGate(dir, "seam-1");
    expect(result.decision).toBe("block");
    expect(String(result.reason ?? "")).toContain("$GW slice complete");
  });

  it("complete + approved → continue", () => {
    run(["slice", "add", "SG-2", "--token", tok], dir);
    run(["slice", "complete", "SG-2", "--token", tok], dir);
    run(["gate", "approve", "--citation", "src/x.ts:1", "--token", tok], dir);
    const result = stopGate(dir, "seam-2");
    expect(result.continue).toBe(true);
  });

  it("hold active → continue regardless of incomplete slices", () => {
    run(["slice", "add", "SG-3", "--token", tok], dir);
    run(["hold", "set", "--reason", "waiting for review", "--token", tok], dir);
    const result = stopGate(dir, "seam-3");
    expect(result.continue).toBe(true);
  });

  it("hold clear → block (incomplete slice, hold lifted)", () => {
    run(["slice", "add", "SG-4", "--token", tok], dir);
    run(["hold", "set", "--reason", "waiting", "--token", tok], dir);
    run(["hold", "clear", "--token", tok], dir);
    const result = stopGate(dir, "seam-4");
    expect(result.decision).toBe("block");
  });
});
