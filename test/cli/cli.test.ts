import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EVENT_TYPES, WorkStore } from "../../src/store/store.js";

const CLI = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const STOP_GATE = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");
const FIXTURES = path.resolve(import.meta.dir, "fixtures");

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
  it("every EVENT_TYPES entry appends without error", () => {
    for (const type of EVENT_TYPES) {
      const r = run(["event", "append", "--type", type, "--msg", `test ${type}`, "--token", tok], dir);
      expect(r.exitCode).toBe(0);
    }
  });

  it("compile shows last PAUSE msg", () => {
    run(["event", "append", "--type", "PAUSE", "--msg", "stopping for handoff", "--data", '{"next_actions":"resume S2"}', "--token", tok], dir);
    const c = run(["compile"], dir);
    expect(c.stdout).toContain("stopping for handoff");
  });
});

describe("import-v1", () => {
  it("imports fixture slices and events with correct counts, skips unknown types, excludes other-motive and no-motive", () => {
    const r = run([
      "import-v1",
      "--ledger", path.join(FIXTURES, "ledger.json"),
      "--journal", path.join(FIXTURES, "journal.jsonl"),
      "--motive", "test-motive",
      "--token", tok,
    ], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("2 slices");
    expect(r.stdout).toContain("4 events");
    expect(r.stdout).toContain("skipped 2 unknown-type");
    expect(r.stdout).toContain("MOTIVE_CREATED: 1");
    expect(r.stdout).toContain("AC_COVERAGE: 1");
    expect(r.stdout).toContain("skipped 1 no-motive");

    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    expect(store.getEvents("GATE_APPROVE")).toHaveLength(1);
    store.close();
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
