/**
 * test/hooks/ah-03-legacy-clear-flag.test.ts
 *
 * AH-03 regression: hooks/ledger.mjs await-human --clear flag form INVERTED.
 *
 * Root cause: `clearing` was derived from `positionals[0] === 'clear'` only.
 * The --clear flag lands in flags.clear=true while positionals stays empty,
 * so clearing=false and the command SET the hold while printing "hold set".
 *
 * Fix: accept flags.clear===true as equivalent to positionals[0]==='clear'.
 *
 * Tests drive hooks/ledger.mjs directly via `node`, the real legacy entry point.
 */

// @verifies AH-03

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  canonicalReleaseState,
  computeSeal,
  ensureKey,
} from "../../hooks/lib/gate-seal.mjs";

const LEDGER_MJS = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");
const WRITE_TOKEN = "ah03-test-token";
const MOTIVE = "ah03-motive";

let projectDir: string;
let sessionId: string;

beforeEach(() => {
  sessionId = "ah03-test";
  projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-ah03-"));
  mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
  mkdirSync(path.join(projectDir, ".groundwork", "motives", MOTIVE), { recursive: true });
  writeFileSync(
    path.join(projectDir, ".groundwork", "motives", MOTIVE, "motive.md"),
    "# AH-03 test motive\n",
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function ledgerFilePath(): string {
  return path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);
}

function writeBaseLedger(): void {
  const key = ensureKey({ projectDir, sessionId });
  const base: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    session_id: sessionId,
    active: true,
    motive_ref: MOTIVE,
    write_token: WRITE_TOKEN,
    reinforcements: 0,
    slices: [{ id: "S1", status: "pending", acceptance: ["human decides"] }],
    gate: {},
  };
  const stateString = canonicalReleaseState(base as never);
  const seal = computeSeal(stateString, key);
  base.gate = { seal };
  writeFileSync(ledgerFilePath(), JSON.stringify(base, null, 2));
}

function runLedger(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [LEDGER_MJS, ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId },
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// AH-03: --clear flag form must clear, not set
// ---------------------------------------------------------------------------

describe("AH-03: hooks/ledger.mjs await-human --clear flag form", () => {
  it("--clear flag form clears the hold and prints 'cleared' (not 'set')", () => {
    writeBaseLedger();

    // Set the hold via the established positional form
    const setResult = runLedger(["await-human", "--token", WRITE_TOKEN]);
    expect(setResult.status).toBe(0);
    const held = JSON.parse(readFileSync(ledgerFilePath(), "utf8")) as Record<string, unknown>;
    expect(held.awaiting_human).toBe(true);

    // Clear with the flag form — before the fix this re-set the hold and printed "hold set"
    const clearResult = runLedger(["await-human", "--clear", "--token", WRITE_TOKEN]);
    expect(clearResult.status, `--clear should exit 0; stderr: ${clearResult.stderr}`).toBe(0);
    expect(clearResult.stdout, "--clear must print 'cleared', not 'set'").toMatch(/cleared|enforcement/i);
    expect(clearResult.stdout, "--clear must not print 'hold set'").not.toMatch(/hold set/i);

    const after = JSON.parse(readFileSync(ledgerFilePath(), "utf8")) as Record<string, unknown>;
    expect(after.awaiting_human, "--clear must remove awaiting_human").toBeFalsy();
  });

  it("positional 'clear' form still works after the fix", () => {
    writeBaseLedger();
    runLedger(["await-human", "--token", WRITE_TOKEN]);
    const result = runLedger(["await-human", "clear", "--token", WRITE_TOKEN]);
    expect(result.status).toBe(0);
    const after = JSON.parse(readFileSync(ledgerFilePath(), "utf8")) as Record<string, unknown>;
    expect(after.awaiting_human).toBeFalsy();
  });

  it("--clear on a ledger with no hold exits 0 and leaves awaiting_human absent", () => {
    writeBaseLedger();
    const result = runLedger(["await-human", "--clear", "--token", WRITE_TOKEN]);
    // Clearing an already-clear ledger must not error
    expect(result.status).toBe(0);
    const after = JSON.parse(readFileSync(ledgerFilePath(), "utf8")) as Record<string, unknown>;
    expect(after.awaiting_human).toBeFalsy();
  });
});
