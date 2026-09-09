/**
 * test/hooks/stop-gate-await-human-gw-cli.test.ts
 *
 * The `gw ledger await-human` writer must produce a hold the Stop hook actually
 * reads. Regression: the writer stored `gate.awaiting_human = {reason, set_at}`
 * while src/gw/hook/stop-gate.ts reads the top-level boolean
 * `ledger.awaiting_human === true` — so the documented hold reported success and
 * left the gate blocking, leaving an orchestrator blocked on a human decision
 * with no exit but falsifying a slice or abandoning the run.
 *
 * Both CLI and hook are driven through bin/gw-hook, the deployed invocation
 * path (bundle-backed when dist/gw.mjs is present), not by importing source.
 */

// @verifies PACING-R-010

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  canonicalReleaseState,
  computeSeal,
  ensureKey,
  verifySeal,
} from "../../hooks/lib/gate-seal.mjs";

const GW_HOOK = path.resolve(import.meta.dirname, "..", "..", "bin", "gw-hook");
const WRITE_TOKEN = "test-write-token-gw-await-human";
const MOTIVE = "test-motive";

let projectDir: string;
let sessionId: string;

beforeEach(() => {
  sessionId = "await-human-gw-cli-test";
  projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-await-human-gw-"));
  mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
  mkdirSync(path.join(projectDir, ".groundwork", "motives", MOTIVE), { recursive: true });
  writeFileSync(
    path.join(projectDir, ".groundwork", "motives", MOTIVE, "motive.md"),
    "# Test motive\n",
  );
  writeSealedLedger();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function ledgerPath(): string {
  return path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);
}

/** An active run: one incomplete slice, advisor not APPROVE — the gate must block. */
function writeSealedLedger(): void {
  const key = ensureKey({ projectDir, sessionId });
  const base: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    session_id: sessionId,
    active: true,
    motive: MOTIVE,
    motive_ref: MOTIVE,
    write_token: WRITE_TOKEN,
    reinforcements: 0,
    slices: [{ id: "f05", status: "pending", acceptance: ["needs a human click"] }],
    gate: {},
  };
  base.gate = { seal: computeSeal(canonicalReleaseState(base as never), key) };
  writeFileSync(ledgerPath(), JSON.stringify(base, null, 2));
}

function readLedger(): Record<string, unknown> {
  return JSON.parse(readFileSync(ledgerPath(), "utf8")) as Record<string, unknown>;
}

/** Invoke the real Stop hook through the deployed bin/gw-hook entry point. */
function runStopHook(): { continue?: boolean; decision?: string; reason?: string } {
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
  const out = execFileSync(GW_HOOK, ["hook", "stop-gate"], { input, encoding: "utf8" });
  return JSON.parse(out) as { continue?: boolean; decision?: string; reason?: string };
}

/** Invoke the real `gw ledger` CLI through the deployed bin/gw-hook entry point. */
function runGwLedger(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(GW_HOOK, ["ledger", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_CODE_SESSION_ID: sessionId,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("gw ledger await-human releases the stop-gate", () => {
  it("blocks with no hold, releases once the hold is set, blocks again once cleared", () => {
    expect(runStopHook().decision).toBe("block");

    const set = runGwLedger(["await-human", "--motive", MOTIVE, "--token", WRITE_TOKEN]);
    expect(set.status).toBe(0);

    // The hold must land on the key the stop-gate reads, not under `gate`.
    const held = readLedger();
    expect(held.awaiting_human).toBe(true);
    expect((held.gate as Record<string, unknown>)?.awaiting_human).toBeUndefined();

    // The release must come from a genuinely sealed hold, not from the
    // benefit-of-the-doubt path an unsealed ledger would take.
    expect(verifySeal(held, ensureKey({ projectDir, sessionId }))).toBe(true);

    const released = runStopHook();
    expect(released.decision).toBeUndefined();
    expect(released.continue).toBe(true);

    // Releasing must not falsify the run: still active, slice still pending.
    expect(held.active).toBe(true);
    expect((held.slices as Array<Record<string, unknown>>)[0].status).toBe("pending");

    const cleared = runGwLedger([
      "await-human",
      "clear",
      "--motive",
      MOTIVE,
      "--token",
      WRITE_TOKEN,
    ]);
    expect(cleared.status).toBe(0);
    expect(readLedger().awaiting_human).toBeUndefined();
    expect(runStopHook().decision).toBe("block");
  });

  it("treats the --clear flag form as a clear, never as a silent set", () => {
    runGwLedger(["await-human", "--motive", MOTIVE, "--token", WRITE_TOKEN]);
    expect(readLedger().awaiting_human).toBe(true);

    const cleared = runGwLedger([
      "await-human",
      "--clear",
      "--motive",
      MOTIVE,
      "--token",
      WRITE_TOKEN,
    ]);
    expect(cleared.status).toBe(0);
    expect(readLedger().awaiting_human).toBeUndefined();
    expect(runStopHook().decision).toBe("block");
  });
});
