/**
 * test/hooks/ah-04-remediation-text.test.ts
 *
 * AH-04 regression: stop-gate remediation for an invalid awaiting_human seal
 * named `bin/ledger await-human --clear` — which inverts via AH-03 — and used
 * the legacy bin/ledger CLI instead of gw ledger.
 *
 * Drives bin/gw-hook hook stop-gate as a subprocess and asserts the emitted
 * reason text, matching how this repo has been burned by guards that compute
 * the right answer and discard it before output.
 *
 * NOTE: dist/gw.mjs is rebuilt by a separate consolidation slice. Until that
 * rebuild this test is RED in the repo against the stale bundle.
 * Green proof runs against a /tmp copy with a freshly built bundle.
 */

// @verifies AH-04

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  canonicalReleaseState,
  computeSeal,
  ensureKey,
} from "../../hooks/lib/gate-seal.mjs";

const GW_HOOK = path.resolve(import.meta.dirname, "..", "..", "bin", "gw-hook");

let projectDir: string;
let sessionId: string;

beforeEach(() => {
  sessionId = "ah04-test";
  projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-ah04-"));
  mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
  mkdirSync(path.join(projectDir, ".groundwork", "motives", "test-motive"), { recursive: true });
  writeFileSync(
    path.join(projectDir, ".groundwork", "motives", "test-motive", "motive.md"),
    "# AH-04 test motive\n",
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function runStopGate(): { continue?: boolean; decision?: string; reason?: string } {
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
  const out = execFileSync(GW_HOOK, ["hook", "stop-gate"], { input, encoding: "utf8" });
  return JSON.parse(out) as { continue?: boolean; decision?: string; reason?: string };
}

/**
 * Build a ledger sealed WITHOUT awaiting_human, then inject awaiting_human:true
 * without re-sealing. checkSeal returns false, triggering the remediation branch.
 */
function buildTamperedHoldLedger(): Record<string, unknown> {
  const key = ensureKey({ projectDir, sessionId });
  const base: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    session_id: sessionId,
    active: true,
    motive_ref: "test-motive",
    write_token: "ah04-write-token",
    reinforcements: 0,
    slices: [{ id: "S1", status: "pending", acceptance: ["human decides"] }],
    gate: {},
  };
  const seal = computeSeal(canonicalReleaseState(base as never), key);
  base.gate = { seal };
  return { ...base, awaiting_human: true };
}

function writeLedger(ledger: Record<string, unknown>): void {
  writeFileSync(
    path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  );
}

describe("AH-04: stop-gate emitted remediation text for invalid await-human hold", () => {
  it("positive control — tampered hold blocks and emits non-empty reason", () => {
    writeLedger(buildTamperedHoldLedger());
    const result = runStopGate();
    expect(result.decision, "tampered hold must block").toBe("block");
    expect(result.reason, "reason must be non-empty so subsequent assertions are not vacuous").toBeTruthy();
  });

  it("reason names 'gw ledger await-human clear', not the inverting 'await-human --clear' form", () => {
    writeLedger(buildTamperedHoldLedger());
    const result = runStopGate();
    expect(result.reason, "must name the working release command").toMatch(/gw ledger await-human clear/);
    expect(result.reason, "must not name the inverting --clear flag form").not.toMatch(/await-human --clear/);
  });
});
