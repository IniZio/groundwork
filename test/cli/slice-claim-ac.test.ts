import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkStore } from "../../src/store/store.js";

const CLI = path.resolve(import.meta.dir, "../../src/cli/main.ts");

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

function initRepo(d: string): string {
  const r = run(["init"], d);
  const m = r.stdout.match(/token: (\S+)/);
  if (!m) throw new Error(`init produced no token: ${r.stdout} ${r.stderr}`);
  return m[1];
}

let dir: string;
let tok: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gw-claim-test-"));
  tok = initRepo(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("slice claim", () => {
  it("claim sets status in_progress and records claimed_by", () => {
    run(["slice", "add", "C-1", "--token", tok], dir);
    const r = run(["slice", "claim", "C-1", "--by", "agent-x", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("claimed by agent-x");

    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    const s = store.getSlice("C-1");
    expect(s?.status).toBe("in_progress");
    expect(s?.claimed_by).toBe("agent-x");
    store.close();
  });

  it("double claim of same slice is refused with clear error", () => {
    run(["slice", "add", "C-2", "--token", tok], dir);
    run(["slice", "claim", "C-2", "--by", "agent-x", "--token", tok], dir);
    const r = run(["slice", "claim", "C-2", "--by", "agent-y", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("already claimed");
  });

  // Bite proof: removing the double-claim check in store would make this test red.
  // The test above relies on claimSlice() throwing when claimed_by is set.
  // Without that guard, agent-y would succeed and exitCode would be 0.

  it("claim → complete path works", () => {
    run(["slice", "add", "C-3", "--token", tok], dir);
    run(["slice", "claim", "C-3", "--by", "agent-z", "--token", tok], dir);
    const r = run(["slice", "complete", "C-3", "--token", tok], dir);
    expect(r.exitCode).toBe(0);

    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    const s = store.getSlice("C-3");
    expect(s?.status).toBe("complete");
    store.close();
  });

  it("slice complete works from pending (no claim required)", () => {
    run(["slice", "add", "C-4", "--token", tok], dir);
    const r = run(["slice", "complete", "C-4", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
  });

  it("claim missing --by flag gives usage error", () => {
    run(["slice", "add", "C-5", "--token", tok], dir);
    const r = run(["slice", "claim", "C-5", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--by");
  });

  it("claim on non-existent slice fails", () => {
    const r = run(["slice", "claim", "no-such-slice", "--by", "agent-x", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not found");
  });
});

describe("covers_ac — slice add and set-ac", () => {
  it("slice add --covers-ac stores the value", () => {
    run(["slice", "add", "AC-slice-1", "--covers-ac", "AC-1,AC-3", "--token", tok], dir);
    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    const s = store.getSlice("AC-slice-1");
    expect(s?.covers_ac).toBe("AC-1,AC-3");
    store.close();
  });

  it("slice set-ac updates covers_ac on an existing slice", () => {
    run(["slice", "add", "AC-slice-2", "--token", tok], dir);
    const r = run(["slice", "set-ac", "AC-slice-2", "--covers-ac", "AC-2", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("AC-2");

    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    const s = store.getSlice("AC-slice-2");
    expect(s?.covers_ac).toBe("AC-2");
    store.close();
  });

  it("compile reports AC coverage count and slice mapping", () => {
    // Seed a real-shaped fixture: two slices covering different ACs
    run(["slice", "add", "S-a", "--covers-ac", "AC-1,AC-2", "--token", tok], dir);
    run(["slice", "add", "S-b", "--covers-ac", "AC-3", "--token", tok], dir);
    run(["slice", "add", "S-c", "--token", tok], dir); // no AC

    const r = run(["compile"], dir);
    expect(r.exitCode).toBe(0);
    // 3 unique ACs covered by 2 slices (S-a and S-b; S-c has none)
    expect(r.stdout).toContain("3 ACs covered by 2 slice(s)");
    expect(r.stdout).toContain("AC-1:");
    expect(r.stdout).toContain("AC-2:");
    expect(r.stdout).toContain("AC-3:");
  });

  it("compile with no AC links reports 'ac coverage: none'", () => {
    run(["slice", "add", "S-noac", "--token", tok], dir);
    const r = run(["compile"], dir);
    expect(r.stdout).toContain("ac coverage: none");
  });

  it("compile --json includes ac_coverage map", () => {
    run(["slice", "add", "S-j", "--covers-ac", "AC-1", "--token", tok], dir);
    const r = run(["compile", "--json"], dir);
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(r.stdout) as Record<string, unknown>;
    expect((json.ac_coverage as Record<string, unknown>)["AC-1"]).toEqual(["S-j"]);
  });

  it("set-ac on non-existent slice fails", () => {
    const r = run(["slice", "set-ac", "no-such", "--covers-ac", "AC-1", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not found");
  });

  it("set-ac missing --covers-ac gives usage error", () => {
    run(["slice", "add", "S-missing-ac", "--token", tok], dir);
    const r = run(["slice", "set-ac", "S-missing-ac", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--covers-ac");
  });
});

describe("--wave validation", () => {
  it("--wave with a non-numeric string gives usage error and exits non-zero", () => {
    const r = run(["slice", "add", "W-1", "--wave", "abc", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--wave");
    expect(r.stderr).not.toContain("NOT NULL"); // no SQLite crash
  });

  it("--wave with a missing value (next arg is a flag) gives usage error", () => {
    // --wave with no value: the next token is --token, which is not numeric
    const r = run(["slice", "add", "W-2", "--wave", "--token", tok], dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--wave");
  });

  it("--wave with a valid integer is accepted", () => {
    const r = run(["slice", "add", "W-3", "--wave", "2", "--token", tok], dir);
    expect(r.exitCode).toBe(0);
    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    expect(store.getSlice("W-3")?.wave).toBe(2);
    store.close();
  });

  it("missing --wave defaults to 0", () => {
    run(["slice", "add", "W-4", "--token", tok], dir);
    const store = new WorkStore(path.join(dir, ".groundwork", "work.db"));
    expect(store.getSlice("W-4")?.wave).toBe(0);
    store.close();
  });
});
