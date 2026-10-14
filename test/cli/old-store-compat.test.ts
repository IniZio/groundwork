import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";

const CLI = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const HOLD_REASON = "H2 needs human approval: x";

function run(args: string[], cwd: string) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("CLAUDE_") || k === "GW" || k.startsWith("GROUNDWORK")) delete env[k];
  }
  const r = Bun.spawnSync(["bun", CLI, ...args], { cwd, env: env as Record<string, string> });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode ?? 0 };
}

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "gw-oldstore-")));
  expect(run(["init"], dir).exitCode).toBe(0);
  // Old-store shape: APPROVE_* events (no longer in EVENT_TYPES) inserted raw, as the removed `gw approve` wrote them.
  const db = new Database(path.join(dir, ".groundwork", "work.db"));
  const rec = JSON.stringify({ hash: "deadbeef", files: ["charter.md"], by: "human", created_at: "2026-01-01T00:00:00.000Z" });
  const ins = db.query("INSERT INTO events (event_type, payload, created_at, motive_id) VALUES (?, ?, ?, 'default')");
  ins.run("APPROVE_CHARTER", rec, "2026-01-01T00:00:00.000Z");
  ins.run("APPROVE_SPEC", rec, "2026-01-01T00:00:01.000Z");
  db.close();
  // Real HOLD writer, reason prefixed as the old H2 gate wrote it.
  expect(run(["hold", "set", "--reason", HOLD_REASON], dir).exitCode).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const INTENT_LINE = /\bH1\b|H2 spec|intent gates/;

describe("old store with APPROVE_* events and an H2 hold", () => {
  it("compile exits 0 with no intent-gate output; hold is present (positive control)", () => {
    const c = run(["compile"], dir);
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain(`hold: awaiting human — ${HOLD_REASON}`);
    expect(c.stdout).not.toMatch(INTENT_LINE);
    expect(c.stderr).not.toMatch(/token/i);
  });

  it("slice status exits 0 and shows the hold", () => {
    const s = run(["slice", "status"], dir);
    expect(s.exitCode).toBe(0);
    expect(s.stdout).toContain(HOLD_REASON);
  });

  it("plain hold clear (no --token) exits 0 and removes the hold", () => {
    const k = run(["hold", "clear"], dir);
    expect(k.exitCode).toBe(0);
    expect(k.stdout).toContain("hold cleared");
    const c = run(["compile"], dir);
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain("hold: none");
    expect(c.stdout).not.toContain(HOLD_REASON);
    expect(c.stdout).not.toMatch(INTENT_LINE);
    const s = run(["slice", "status"], dir);
    expect(s.exitCode).toBe(0);
    expect(s.stdout).not.toContain(HOLD_REASON);
    expect(s.stdout).toContain("hold: none");
  });
});
