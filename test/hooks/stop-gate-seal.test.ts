/**
 * test/hooks/stop-gate-seal.test.ts — S3 seal-verification tests for stop-gate.mjs
 *
 * Tests the tamper-evidence core: the stop-gate must fail-closed when a sealed ledger's
 * HMAC seal does not match (or the key is missing), regardless of what the ledger fields say.
 *
 * Covered ACs:
 *   S3-AC1: tampered gate.advisor=APPROVE (invalid seal) → BLOCKED
 *   S3-AC2: tampered active:false (invalid seal) → BLOCKED
 *   S3-AC3: sealed ledger, key file deleted → FAIL CLOSED
 *   S3-AC4: legacy ledger (no gate.seal) → RELEASES via old path; foreign session ignored
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import the REAL gate-seal helpers so tests exercise the actual HMAC, not a hand-rolled MAC.
import {
  SCHEMA_VERSION,
  canonicalReleaseState,
  computeSeal,
  ensureKey,
} from "../../hooks/lib/gate-seal.mjs";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "stop-gate.mjs");

let projectDir: string;
let sessionId: string;

beforeEach(() => {
  sessionId = "seal-test-sess";
  projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-seal-"));
  mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
  mkdirSync(path.join(projectDir, ".groundwork", "motives", "test-motive"), { recursive: true });
  // Write a minimal motive charter so plan-pre-gate doesn't block
  writeFileSync(
    path.join(projectDir, ".groundwork", "motives", "test-motive", "motive.md"),
    "# Test motive\n",
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** Run the stop-gate hook and return parsed stdout. */
function runHook(ledger: unknown, sid = sessionId): { continue?: boolean; decision?: string; reason?: string } {
  const runsDir = path.join(projectDir, ".groundwork", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(path.join(runsDir, `${sid}.json`), JSON.stringify(ledger, null, 2));
  const input = JSON.stringify({ cwd: projectDir, session_id: sid });
  const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
  return JSON.parse(out);
}

/** Build a sealed ledger with a valid HMAC seal for the given state. */
function buildSealedLedger(overrides: Record<string, unknown> = {}): {
  ledger: Record<string, unknown>;
  key: Buffer;
} {
  const key = ensureKey({ projectDir, sessionId });
  const baseLedger: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    session_id: sessionId,
    active: true,
    motive_ref: "test-motive",
    slices: [{ id: "S1", status: "complete" }],
    gate: {
      advisor: "APPROVE",
    },
    ...overrides,
  };
  // Compute seal over the base ledger (before merging gate overrides that would break it)
  const stateString = canonicalReleaseState(baseLedger as any);
  const seal = computeSeal(stateString, key);
  // Merge gate.seal into the ledger
  baseLedger.gate = { ...(baseLedger.gate as Record<string, unknown>), seal };
  return { ledger: baseLedger, key };
}

// ---------------------------------------------------------------------------
// S3-AC1: tampered gate.advisor — seal must block the release
// ---------------------------------------------------------------------------

describe("S3-AC1: tampered gate.advisor=APPROVE without valid seal", () => {
  it("releases when all complete + APPROVE + valid seal (baseline)", () => {
    const { ledger } = buildSealedLedger();
    const result = runHook(ledger);
    expect(result.continue).toBe(true);
  });

  it("blocks when gate.advisor flipped to APPROVE without re-sealing", () => {
    // Start from a ledger where advisor is NOT APPROVE (so seal is valid for that state)
    const key = ensureKey({ projectDir, sessionId });
    const baseLedger: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      active: true,
      motive_ref: "test-motive",
      slices: [{ id: "S1", status: "complete" }],
      gate: { advisor: "pending" }, // NOT APPROVE
    };
    const stateString = canonicalReleaseState(baseLedger as any);
    const seal = computeSeal(stateString, key);
    // Now tamper: flip advisor to APPROVE without updating the seal
    const tamperedLedger = {
      ...baseLedger,
      gate: { advisor: "APPROVE", seal }, // seal was computed over "pending", now invalid
    };
    const result = runHook(tamperedLedger);
    expect(result.decision).toBe("block");
    expect(result.reason ?? "").toMatch(/seal/i);
  });
});

// ---------------------------------------------------------------------------
// S3-AC2: tampered active:false — seal must block the release
// ---------------------------------------------------------------------------

describe("S3-AC2: active:false release path", () => {
  it("releases when active:false with a valid seal", () => {
    // Build a ledger with active:false sealed correctly
    const key = ensureKey({ projectDir, sessionId });
    const ledger: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      active: false, // deliberately false — the sealed "abandon" case
      motive_ref: "test-motive",
      slices: [{ id: "S1", status: "pending" }],
      gate: { advisor: "pending" },
    };
    const stateString = canonicalReleaseState(ledger as any);
    const seal = computeSeal(stateString, key);
    (ledger.gate as Record<string, unknown>).seal = seal;
    const result = runHook(ledger);
    expect(result.continue).toBe(true);
  });

  it("blocks when active:false written directly without a valid seal (vector 4)", () => {
    // Subagent writes active:false directly — no seal update
    const key = ensureKey({ projectDir, sessionId });
    // Seal was computed over active:true
    const sealedAsActive: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      active: true,
      slices: [{ id: "S1", status: "complete" }],
      gate: { advisor: "APPROVE" },
    };
    const seal = computeSeal(canonicalReleaseState(sealedAsActive as any), key);
    // Now tamper: flip active to false without updating seal
    const tamperedLedger = {
      ...sealedAsActive,
      active: false,
      gate: { ...(sealedAsActive.gate as object), seal }, // seal invalid for active:false
    };
    const result = runHook(tamperedLedger);
    expect(result.decision).toBe("block");
    expect(result.reason ?? "").toMatch(/seal/i);
  });

  it("blocks when active:false written with wrong seal in a sealed-regime ledger (vector 5)", () => {
    // Ensure the key exists (sealed regime) but ledger has a wrong seal
    ensureKey({ projectDir, sessionId });
    const ledgerWrongSeal = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      active: false,
      slices: [],
      gate: { advisor: "APPROVE", seal: "cafebabe".repeat(8) }, // wrong seal
    };
    const result = runHook(ledgerWrongSeal);
    expect(result.decision).toBe("block");
    expect(result.reason ?? "").toMatch(/seal/i);
  });
});

// ---------------------------------------------------------------------------
// S3-AC3: key file deleted → FAIL CLOSED
// ---------------------------------------------------------------------------

describe("S3-AC3: missing key file on sealed ledger", () => {
  it("blocks when key file is deleted (fail closed)", () => {
    const { ledger } = buildSealedLedger();
    // Delete the key file
    const keyFile = path.join(projectDir, ".groundwork", "runs", `${sessionId}.seal.key`);
    unlinkSync(keyFile);
    const result = runHook(ledger);
    expect(result.decision).toBe("block");
    expect(result.reason ?? "").toMatch(/seal/i);
  });
});

// ---------------------------------------------------------------------------
// S3-AC4: legacy ledger (no gate.seal) → releases via old path
// ---------------------------------------------------------------------------

describe("S3-AC4: legacy ledger backward compatibility", () => {
  it("releases a legacy (unsealed) ledger via the old path when all complete + APPROVE", () => {
    const legacyLedger = {
      // No schema_version, no gate.seal — pre-sealed-regime ledger
      session_id: sessionId,
      active: true,
      motive_ref: "test-motive",
      slices: [{ id: "S1", status: "complete" }],
      gate: { advisor: "APPROVE" },
    };
    // Write via legacy run.json path (the hook resolves per-session first, then falls back)
    // Write directly to per-session path so hook finds it
    const result = runHook(legacyLedger);
    expect(result.continue).toBe(true);
  });

  it("ignores a foreign-session ledger (existing defensive layer)", () => {
    const foreignLedger = {
      session_id: "some-other-session",
      active: true,
      slices: [{ id: "S1", status: "pending" }],
      gate: { advisor: "pending" },
    };
    // Run hook as our sessionId but with a ledger belonging to a different session
    // The hook reads the ledger at our session's path — so write it there
    const result = runHook(foreignLedger, "seal-test-sess");
    // Foreign session_id check happens AFTER active check — but session_id in the ledger
    // doesn't match the hook's sessionId ("seal-test-sess" vs "some-other-session")
    // → hook allows (foreign session defensive layer)
    expect(result.continue).toBe(true);
  });
});
