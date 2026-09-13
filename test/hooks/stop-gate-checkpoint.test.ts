/**
 * stop-gate-checkpoint.test.ts — T3: per-phase deliverable verification enforcement.
 *
 * AC-7: checkpoint_hold set to a BLOCKS-tier phase with valid seal (or no seal, which
 *       checkSeal treats as null / "not false") → stop-gate blocks, names the phase
 *       key and deliverable.
 * AC-8: checkpoint_hold set with an invalid/missing seal (seal field present but key
 *       absent or hash wrong) → stop-gate blocks fail-closed, mirroring the
 *       awaiting_human precedent.
 * AC-9: checkpoint_hold set to an AUTO_ADVANCES-tier phase → stop-gate allows with a
 *       DIRECTIVE naming the recorded deliverable and remaining incomplete slice ids.
 *
 * Tests run via `bun run src/gw/cli/main.ts` — bypasses dist/gw.mjs (stale bundle,
 * T9 owns the rebuild). Source-only invocation tests the actual updated code.
 */

// @verifies AC-7
// @verifies AC-8
// @verifies AC-9

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const BUN_MAIN = path.join(REPO_ROOT, "src/gw/cli/main.ts");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-sg-checkpoint-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

function runHook(
	ledger: unknown,
	sessionId = "sess-1",
): { continue?: boolean; decision?: string; reason?: string } {
	writeFileSync(
		path.join(projectDir, ".groundwork", "run.json"),
		JSON.stringify(ledger, null, 2),
	);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const out = execFileSync("bun", ["run", BUN_MAIN, "hook", "stop-gate"], {
		input,
		encoding: "utf8",
		env: { ...process.env, GW_REPO_ROOT: REPO_ROOT },
	});
	return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Ledger with checkpoint_hold set to a BLOCKS-tier phase and no gate.seal field.
 * checkSeal returns null (no sealed regime) → the stop-gate falls through to the
 * regular hold block ("Phase checkpoint hold: ...").
 */
function blocksLedger(overrides: Record<string, unknown> = {}): unknown {
	return {
		version: 1,
		active: true,
		session_id: "sess-1",
		brief: "checkpoint test",
		checkpoint_hold: "plan",
		gate: {
			advisor: "pending",
			// No seal field — checkSeal returns null (key file absent);
			// the stop-gate treats null as "not false" and falls through to the
			// regular hold-block path.
			phases: {
				plan: {
					deliverable: "motive charter + registered slices",
					tier: "BLOCKS",
				},
			},
		},
		slices: [
			{ id: "T1", wave: 0, status: "complete", kind: "plan" },
			{ id: "T2", wave: 1, status: "pending", kind: "impl" },
		],
		...overrides,
	};
}

/**
 * Same shape as blocksLedger but with a gate.seal field whose hash is wrong.
 * checkSeal sees a seal field + no matching key file → returns false → fail-closed.
 */
function blocksLedgerWithBadSeal(overrides: Record<string, unknown> = {}): unknown {
	return {
		...(blocksLedger() as Record<string, unknown>),
		gate: {
			advisor: "pending",
			seal: "deadbeef00000000000000000000000000000000000000000000000000000000",
			phases: {
				plan: {
					deliverable: "motive charter + registered slices",
					tier: "BLOCKS",
				},
			},
		},
		...overrides,
	};
}

/**
 * Ledger with checkpoint_hold set to an AUTO_ADVANCES-tier phase.
 * The stop-gate allows and emits a checkpointDirective.
 */
function autoAdvancesLedger(overrides: Record<string, unknown> = {}): unknown {
	return {
		version: 1,
		active: true,
		session_id: "sess-1",
		brief: "auto-advances checkpoint test",
		checkpoint_hold: "wave-1",
		gate: {
			advisor: "pending",
			phases: {
				"wave-1": {
					deliverable: "wave 1 deliverable artifacts",
					tier: "AUTO_ADVANCES",
				},
			},
		},
		slices: [
			{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
			{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
			{ id: "S1b", wave: 1, status: "pending", kind: "impl" },
		],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC-7: BLOCKS tier with no seal (checkSeal → null) → block naming phase
// ---------------------------------------------------------------------------

// @verifies AC-7
describe("AC-7: BLOCKS tier with no seal → block naming phase and deliverable", () => {
	it("blocks when checkpoint_hold is set and tier is BLOCKS", () => {
		const result = runHook(blocksLedger());
		expect(result.decision).toBe("block");
	});

	it("block reason names the phase key", () => {
		const result = runHook(blocksLedger());
		expect(result.reason).toContain("plan");
	});

	it("block reason names the deliverable", () => {
		const result = runHook(blocksLedger());
		expect(result.reason).toContain("motive charter");
	});

	it("block reason does not contain DIRECTIVE (DIRECTIVE is for AUTO_ADVANCES only)", () => {
		const result = runHook(blocksLedger());
		expect(result.reason?.toUpperCase()).not.toContain("DIRECTIVE");
	});
});

// ---------------------------------------------------------------------------
// AC-8: BLOCKS tier with seal field but key missing → fail-closed
// ---------------------------------------------------------------------------

// @verifies AC-8
describe("AC-8: BLOCKS tier with invalid seal → fail-closed block", () => {
	it("blocks fail-closed when seal is invalid", () => {
		const result = runHook(blocksLedgerWithBadSeal());
		expect(result.decision).toBe("block");
	});

	it("fail-closed message mentions seal or key", () => {
		const result = runHook(blocksLedgerWithBadSeal());
		expect(
			result.reason?.toLowerCase().includes("seal") ||
				result.reason?.toLowerCase().includes("key"),
		).toBe(true);
	});

	it("fail-closed message mentions the phase key", () => {
		const result = runHook(blocksLedgerWithBadSeal());
		expect(result.reason).toContain("plan");
	});
});

// ---------------------------------------------------------------------------
// AC-9: AUTO_ADVANCES tier → allow with directive
// ---------------------------------------------------------------------------

// @verifies AC-9
describe("AC-9: AUTO_ADVANCES tier → allow with DIRECTIVE naming deliverable and incomplete slices", () => {
	it("allows when checkpoint_hold is set to an AUTO_ADVANCES-tier phase", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.continue).toBe(true);
	});

	it("allow reason contains DIRECTIVE", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.reason?.toUpperCase()).toContain("DIRECTIVE");
	});

	it("allow reason names the phase key", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.reason).toContain("wave-1");
	});

	it("allow reason names the deliverable", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.reason).toContain("wave 1 deliverable artifacts");
	});

	it("allow reason names remaining incomplete slice ids", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.reason).toContain("S1a");
		expect(result.reason).toContain("S1b");
	});

	it("allow reason does NOT list completed slices", () => {
		const result = runHook(autoAdvancesLedger());
		expect(result.reason).not.toContain("S0a");
	});

	it("a ledger with no checkpoint_hold is unaffected — normal block applies", () => {
		const ledger = {
			version: 1,
			active: true,
			session_id: "sess-1",
			brief: "no checkpoint hold",
			// No checkpoint_hold field
			gate: { advisor: "pending" },
			slices: [
				{ id: "P0", wave: 0, status: "complete", kind: "plan" },
				{ id: "S1", wave: 1, status: "pending", kind: "impl" },
			],
		};
		const result = runHook(ledger);
		expect(result.decision).toBe("block");
	});
});
