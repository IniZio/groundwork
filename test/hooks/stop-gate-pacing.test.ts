/**
 * stop-gate-pacing.test.ts — D-29 pacing / AC-10 exhaustion-release removal.
 *
 * Original D-29 criteria (pace-stopgate slice):
 *  AC1  stop-gate.ts drives behaviour from the pacing field (no re-implementation).
 *  AC2  when isExhausted is true and incomplete slices remain, the stop is ALLOWED.
 *  AC3  the released stop emits a DIRECTIVE naming remaining slice ids, MAP.md path,
 *       and the handoff skill.
 *  AC4  ordinary block still fires when pacing is not exhausted.
 *  AC5  D-13 / D-26 advisories append on the pacing allow path.
 *  AC6  absent pacing field → byte-identical block behaviour.
 *
 * AC-10 (motive phase-checkpoint-gate, T3): the wave-exhaustion release path is
 * REMOVED. AC2 and AC3 are now inverted — exhaustion no longer allows; the stop
 * blocks on the normal path.  AC5 is updated accordingly.
 */

// @verifies PACING-R-005
// @verifies PACING-R-006

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const BUN_MAIN = path.join(REPO_ROOT, "src/gw/cli/main.ts");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-sg-pacing-"));
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
// Helpers to build ledger fixtures
// ---------------------------------------------------------------------------

/** Wave-paced ledger: wave 0 fully resolved (budget consumed), wave 1 still pending. */
function exhaustedLedger(overrides: Record<string, unknown> = {}): unknown {
	return {
		version: 1,
		active: true,
		session_id: "sess-1",
		brief: "pacing test run",
		pacing: { policy: "wave", budget: 1, exempt_kinds: [] },
		gate: { advisor: "pending", verifier: "n/a" },
		slices: [
			{ id: "P0", wave: 0, status: "complete", kind: "plan" },
			{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
			{ id: "S0b", wave: 0, status: "complete", kind: "impl" },
			{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
			{ id: "S1b", wave: 1, status: "pending", kind: "impl" },
		],
		...overrides,
	};
}

/** Same as exhaustedLedger but wave 1 has an in_progress slice → isExhausted = false. */
function inFlightLedger(): unknown {
	return {
		version: 1,
		active: true,
		session_id: "sess-1",
		brief: "pacing in-flight test",
		pacing: { policy: "wave", budget: 1, exempt_kinds: [] },
		gate: { advisor: "pending", verifier: "n/a" },
		slices: [
			{ id: "P0", wave: 0, status: "complete", kind: "plan" },
			{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
			{ id: "S0b", wave: 0, status: "complete", kind: "impl" },
			{ id: "S1a", wave: 1, status: "in_progress", kind: "impl" },
			{ id: "S1b", wave: 1, status: "pending", kind: "impl" },
		],
	};
}

/** Ledger with NO pacing field — pre-pacing back-compat. */
function noPacingLedger(): unknown {
	return {
		version: 1,
		active: true,
		session_id: "sess-1",
		brief: "no pacing",
		gate: { advisor: "pending", verifier: "n/a" },
		slices: [
			{ id: "P0", wave: 0, status: "complete", kind: "plan" },
			{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
			{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
		],
	};
}

// ---------------------------------------------------------------------------
// AC1+AC2: isExhausted → stop is ALLOWED
// ---------------------------------------------------------------------------

describe("AC1+AC2: exhaustion no longer releases the stop — blocks (AC-10)", () => {
	it("blocks when pacing is exhausted and incomplete slices remain", () => {
		const result = runHook(exhaustedLedger());
		expect(result.decision).toBe("block");
		expect(result.continue).toBeUndefined();
	});

	it("continue field is absent (not an allow) on pacing exhaustion", () => {
		const result = runHook(exhaustedLedger());
		expect(result.continue).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// AC3: DIRECTIVE content — slice ids, MAP.md path, handoff skill
// ---------------------------------------------------------------------------

describe("AC3: block reason (buildReason) lists incomplete slice ids (exhaustion-directive gone)", () => {
	it("reason contains the pending slice ids", () => {
		const result = runHook(exhaustedLedger());
		expect(result.reason).toContain("S1a");
		expect(result.reason).toContain("S1b");
	});

	it("reason does NOT contain completed slice ids (only incomplete)", () => {
		const result = runHook(exhaustedLedger());
		expect(result.reason).not.toContain("S0a");
		expect(result.reason).not.toContain("S0b");
	});

	it("block reason does NOT contain /groundwork:pause (exhaustion directive removed)", () => {
		const result = runHook(exhaustedLedger());
		expect(result.reason).not.toContain("/groundwork:pause");
	});

	it("block reason does NOT contain DIRECTIVE (exhaustion directive removed)", () => {
		const result = runHook(exhaustedLedger());
		expect(result.reason?.toUpperCase()).not.toContain("DIRECTIVE");
	});
});

// ---------------------------------------------------------------------------
// AC4: ordinary block still fires when pacing is not exhausted
// ---------------------------------------------------------------------------

describe("AC4: ordinary block when pacing is not exhausted or absent", () => {
	it("blocks when pacing is not exhausted (wave 1 still in_progress)", () => {
		const result = runHook(inFlightLedger());
		expect(result.decision).toBe("block");
		expect(result.continue).toBeUndefined();
	});

	it("blocks when budget is not yet consumed (only one wave resolved, budget=2)", () => {
		const ledger = exhaustedLedger({
			pacing: { policy: "wave", budget: 2, exempt_kinds: [] },
		});
		const result = runHook(ledger);
		expect(result.decision).toBe("block");
		expect(result.continue).toBeUndefined();
	});

	it("block reason for in-flight mentions incomplete slices", () => {
		const result = runHook(inFlightLedger());
		expect(result.reason).toContain("GROUNDWORK STOP-GATE");
	});
});

// ---------------------------------------------------------------------------
// AC5: D-13 and D-26 advisories still append on the pacing allow path
// ---------------------------------------------------------------------------

describe("AC5: exhaustion allow path gone — exhausted ledger blocks (AC-10)", () => {
	it("blocks when exhausted (allow path removed)", () => {
		const result = runHook(exhaustedLedger());
		expect(result.decision).toBe("block");
		expect(typeof result.reason).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// AC6: no pacing field → byte-identical behaviour (block as before)
// ---------------------------------------------------------------------------

describe("AC6: absent pacing field → unchanged block behaviour", () => {
	it("blocks when no pacing field and incomplete slices remain", () => {
		const result = runHook(noPacingLedger());
		expect(result.decision).toBe("block");
		expect(result.continue).toBeUndefined();
	});

	it("no pacing exhaustion directive appears in block reason", () => {
		const result = runHook(noPacingLedger());
		expect(result.reason).not.toContain("/groundwork:pause");
		expect(result.reason).toContain("GROUNDWORK STOP-GATE");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("allows when all slices are complete and advisor approved (normal completion)", () => {
		const ledger = {
			version: 1,
			active: true,
			session_id: "sess-1",
			brief: "done",
			pacing: { policy: "wave", budget: 1, exempt_kinds: [] },
			gate: { advisor: "APPROVE", verifier: "n/a" },
			slices: [
				{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
			],
		};
		mkdirSync(path.join(projectDir, ".groundwork", "journal"), { recursive: true });
		const result = runHook(ledger);
		expect(result.continue).toBe(true);
	});

	it("blocks when pacing exhausted with grant (exhaustion release removed)", () => {
		const ledger = exhaustedLedger({
			pacing: { policy: "wave", budget: 1, exempt_kinds: [], grant: { range: 0 } },
		});
		const result = runHook(ledger);
		expect(result.decision).toBe("block");
	});

	it("exhausted ledger with grant blocks — no grant summary in block reason", () => {
		const ledger = {
			version: 1,
			active: true,
			session_id: "sess-1",
			brief: "pacing grant present",
			pacing: {
				policy: "wave",
				budget: 1,
				exempt_kinds: [],
				grant: { range: 0, reason: "operator approved extra waves", granted_by: "sess-op", granted_at: new Date().toISOString() },
			},
			gate: { advisor: "pending", verifier: "n/a" },
			slices: [
				{ id: "P0", wave: 0, status: "complete", kind: "plan" },
				{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
				{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
			],
		};
		const result = runHook(ledger);
		expect(result.decision).toBe("block");
		expect(result.reason).not.toContain("Autopilot grant");
	});

	it("exhausted ledger with grant blocks — no grant detail in block reason", () => {
		const exhaustedWithGrant = {
			version: 1,
			active: true,
			session_id: "sess-1",
			brief: "pacing grant test",
			pacing: {
				policy: "wave",
				budget: 1,
				exempt_kinds: [],
				grant: { range: 0, reason: "operator approved", granted_by: "sess-op", granted_at: new Date().toISOString() },
			},
			gate: { advisor: "pending", verifier: "n/a" },
			slices: [
				{ id: "P0", wave: 0, status: "complete", kind: "plan" },
				{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
				{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
			],
		};
		const result = runHook(exhaustedWithGrant);
		expect(result.decision).toBe("block");
		expect(result.reason).not.toContain("Autopilot grant");
	});

	it("no grant summary when pacing.grant is absent", () => {
		const result = runHook(exhaustedLedger());
		expect(result.reason).not.toContain("Autopilot grant");
	});

	it("pacing ledger with exempt kinds still blocks (exhaustion release removed)", () => {
		const ledger = {
			version: 1,
			active: true,
			session_id: "sess-1",
			brief: "exempt test",
			pacing: { policy: "wave", budget: 1, exempt_kinds: ["plan"] },
			gate: { advisor: "pending", verifier: "n/a" },
			slices: [
				{ id: "P0", wave: 0, status: "complete", kind: "plan" },
				{ id: "S0a", wave: 0, status: "complete", kind: "impl" },
				{ id: "S1a", wave: 1, status: "pending", kind: "impl" },
			],
		};
		const result = runHook(ledger);
		expect(result.decision).toBe("block");
	});
});
