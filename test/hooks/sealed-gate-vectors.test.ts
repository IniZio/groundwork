/**
 * sealed-gate-vectors.test.ts — S5: End-to-end grill of every known self-approval vector.
 *
 * Replays ALL six vectors against a freshly-sealed ledger produced by the real `ledger init`
 * CLI, then runs the real stop-gate hook and asserts each vector is closed (either the CLI
 * rejects the mutation or the stop-gate blocks release).  Also covers backward-compat
 * (legacy unsealed ledger still releases) and key-deletion fail-closed.
 *
 * @verifies S5-AC1 (six CLI/tamper vectors all blocked)
 * @verifies S5-AC2 (stale/absent seal blocks stop-gate release)
 * @verifies S5-AC3 (legacy path still releases; key deletion closes gate; ledger status works)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Ledger = {
	active?: boolean;
	write_token?: string;
	session_id?: string;
	gate?: { seal?: string; advisor?: string | { verdict: string } };
	slices?: Array<{ id: string; status: string; kind?: string }>;
	reinforcements?: number;
	progressSig?: string;
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LEDGER = path.join(REPO, "hooks", "ledger.mjs");
const STOP_GATE = path.join(REPO, "hooks", "stop-gate.mjs");

/** A session id that passes the SAFE_ID regex and is unlikely to collide. */
const TEST_SESSION = "sealed-gate-grill-001";

/** Per-session ledger: .groundwork/runs/<session>.json */
function perSessionLedgerPath(dir: string, sess = TEST_SESSION): string {
	return path.join(dir, ".groundwork", "runs", `${sess}.json`);
}

/** Key file: .groundwork/runs/<session>.seal.key */
function sealKeyPath(dir: string, sess = TEST_SESSION): string {
	return path.join(dir, ".groundwork", "runs", `${sess}.seal.key`);
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-sealed-gate-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run any ledger CLI command; always returns exitCode + stdout + stderr. */
function runLedger(
	args: string[],
	extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
	const result = spawnSync("node", [LEDGER, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
			CLAUDE_CODE_SESSION_ID: TEST_SESSION,
			...extraEnv,
		},
	});
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/**
 * Init a fresh sealed ledger with two pending slices (S1, S2).
 * Returns the write_token extracted from the CLI output.
 */
function initSealedLedger(): string {
	const initFile = path.join(projectDir, "init.json");
	writeFileSync(
		initFile,
		JSON.stringify({
			slices: [
				{ id: "S1", status: "pending", desc: "test slice 1" },
				{ id: "S2", status: "pending", desc: "test slice 2" },
			],
		}),
	);
	const r = runLedger(["init", initFile]);
	if (r.exitCode !== 0) throw new Error(`ledger init failed: ${r.stderr}\n${r.stdout}`);
	const m = r.stdout.match(/write_token:\s*(\S+)/);
	if (!m) throw new Error(`write_token not found in init output: ${r.stdout}`);
	return m[1];
}

/** Read the per-session ledger JSON. */
function readLedger(): Ledger {
	return JSON.parse(readFileSync(perSessionLedgerPath(projectDir), "utf8")) as Ledger;
}

/** Run the stop-gate hook and return the parsed JSON decision. */
function runStopGate(sessionId = TEST_SESSION): { continue?: boolean; decision?: string; reason?: string } {
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const result = spawnSync("node", [STOP_GATE], {
		input,
		encoding: "utf8",
		env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
	});
	if (result.status !== 0) throw new Error(`stop-gate exited ${result.status}: ${result.stderr}`);
	return JSON.parse(result.stdout.trim());
}

// ---------------------------------------------------------------------------
// S5-AC1 — Six CLI/tamper vectors, each must FAIL to release
// ---------------------------------------------------------------------------

describe("S5-AC1 — six vectors each must FAIL to release", () => {
	it("V1: init --no-token over active tokened run is rejected (flag retired, active-run check fires)", () => {
		initSealedLedger();
		const before = readLedger();

		// --no-token is a retired flag; it is silently ignored but the active-run guard still fires
		const reinitFile = path.join(projectDir, "reinit.json");
		writeFileSync(reinitFile, JSON.stringify({ slices: [] }));
		const r = runLedger(["init", reinitFile, "--no-token"]);

		expect(r.exitCode).not.toBe(0);
		// Ledger must be identical (no overwrite)
		const after = readLedger();
		expect(after.write_token).toBe(before.write_token);
		expect(after.active).toBe(true);
		expect(after.gate?.seal).toBe(before.gate?.seal);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
	});

	it("V2: plain init re-init over active tokened run without --token is rejected", () => {
		initSealedLedger();
		const before = readLedger();

		const reinitFile = path.join(projectDir, "reinit.json");
		writeFileSync(reinitFile, JSON.stringify({ slices: [] }));
		const r = runLedger(["init", reinitFile]);

		expect(r.exitCode).not.toBe(0);
		const after = readLedger();
		expect(after.write_token).toBe(before.write_token);
		expect(after.active).toBe(true);
		expect(after.gate?.seal).toBe(before.gate?.seal);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
	});

	it("V3: set --status complete tokenless is rejected; slice stays pending; seal unchanged", () => {
		initSealedLedger();
		const before = readLedger();

		// No --token supplied
		const r = runLedger(["set", "S1", "--status", "complete"]);

		expect(r.exitCode).not.toBe(0);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
		const after = readLedger();
		const s1 = after.slices?.find((s) => s.id === "S1");
		expect(s1?.status).toBe("pending");
		expect(after.gate?.seal).toBe(before.gate?.seal);
	});

	it("V4a: abandon tokenless is rejected; run stays active; seal unchanged", () => {
		initSealedLedger();
		const before = readLedger();

		const r = runLedger(["abandon"]);

		expect(r.exitCode).not.toBe(0);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
		const after = readLedger();
		expect(after.active).toBe(true);
		expect(after.gate?.seal).toBe(before.gate?.seal);
	});

	it("V4b: abandon --session <id> tokenless is rejected; run stays active", () => {
		initSealedLedger();
		const before = readLedger();

		const r = runLedger(["abandon", "--session", TEST_SESSION]);

		expect(r.exitCode).not.toBe(0);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
		const after = readLedger();
		expect(after.active).toBe(true);
		expect(after.gate?.seal).toBe(before.gate?.seal);
	});

	it("V5: direct file tamper (APPROVE + all-complete, stale seal) → stop-gate BLOCKS with seal reason", () => {
		initSealedLedger();

		// Tamper: set advisor APPROVE + all slices complete, but do NOT re-seal
		const current = readLedger();
		const tampered: Ledger = {
			...current,
			gate: { ...current.gate, advisor: "APPROVE" },
			slices: current.slices?.map((s) => ({ ...s, status: "complete" })),
			// gate.seal left as-is (stale)
		};
		writeFileSync(perSessionLedgerPath(projectDir), JSON.stringify(tampered, null, 2));

		const decision = runStopGate();
		expect(decision.continue).not.toBe(true);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toMatch(/[Ss]eal verification failed/);
	});

	it("V6: rm of incomplete slice tokenless is rejected; slice survives; seal unchanged", () => {
		initSealedLedger();
		const before = readLedger();

		const r = runLedger(["rm", "S1"]);

		expect(r.exitCode).not.toBe(0);
		// Stop-gate must still block: work remains
		expect(runStopGate().continue).not.toBe(true);
		const after = readLedger();
		const s1 = after.slices?.find((s) => s.id === "S1");
		expect(s1).toBeDefined();
		expect(after.gate?.seal).toBe(before.gate?.seal);
	});
});

// ---------------------------------------------------------------------------
// S5-AC2 — Tamper-evidence: stale / absent seal blocks stop-gate release
// ---------------------------------------------------------------------------

describe("S5-AC2 — stale or absent seal blocks stop-gate release", () => {
	it("directly-written APPROVE + all-complete with stale seal → stop-gate BLOCKS with seal reason", () => {
		initSealedLedger();
		const current = readLedger();
		const tampered: Ledger = {
			...current,
			gate: { ...current.gate, advisor: "APPROVE" },
			slices: current.slices?.map((s) => ({ ...s, status: "complete" })),
			// gate.seal left stale
		};
		writeFileSync(perSessionLedgerPath(projectDir), JSON.stringify(tampered, null, 2));

		const decision = runStopGate();
		expect(decision.continue).not.toBe(true);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toMatch(/[Ss]eal verification failed/);
	});

	it("directly-written active:false with stale seal → stop-gate BLOCKS on abandon path with seal reason", () => {
		initSealedLedger();
		const current = readLedger();
		// Set active:false WITHOUT going through the CLI (no re-seal)
		const tampered: Ledger = { ...current, active: false };
		writeFileSync(perSessionLedgerPath(projectDir), JSON.stringify(tampered, null, 2));

		const decision = runStopGate();
		expect(decision.continue).not.toBe(true);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toMatch(/[Ss]eal verification failed/);
	});
});

// ---------------------------------------------------------------------------
// S5-AC3 — Backward-compat & non-regression
// ---------------------------------------------------------------------------

describe("S5-AC3 — backward-compat & non-regression", () => {
	it("legacy unsealed ledger (no gate.seal, no key file) with all-complete + APPROVE releases via old path", () => {
		const legacySess = "legacy-sess-grill-001";
		// Write a hand-crafted legacy ledger to the legacy run.json path
		const legacyLedger = {
			active: true,
			session_id: legacySess,
			slices: [{ id: "S1", status: "complete" }],
			gate: { advisor: "APPROVE" },
			// No gate.seal, no write_token, no schema_version
		};
		writeFileSync(
			path.join(projectDir, ".groundwork", "run.json"),
			JSON.stringify(legacyLedger, null, 2),
		);
		// No key file created — resolveLedgerPath falls back to run.json

		const decision = runStopGate(legacySess);
		expect(decision.continue).toBe(true);
	});

	it("sealed ledger with key file deleted → stop-gate FAILS CLOSED on all-complete + APPROVE path", () => {
		const token = initSealedLedger();

		// Complete all slices and record APPROVE legitimately
		const rc = runLedger(["complete", "S1", "S2", "--token", token]);
		if (rc.exitCode !== 0) throw new Error(`complete failed: ${rc.stderr}`);
		const rg = runLedger(["gate", "advisor", "APPROVE", "--token", token]);
		if (rg.exitCode !== 0) throw new Error(`gate failed: ${rg.stderr}`);

		// Sanity: with the key present, the ledger is in a releasable state
		const ledger = readLedger();
		expect(ledger.gate?.advisor).toBe("APPROVE");
		const s1 = ledger.slices?.find((s) => s.id === "S1");
		expect(s1?.status).toBe("complete");

		// Positive control: valid seal + key present → stop-gate releases
		expect(runStopGate().continue).toBe(true);

		// Delete the key file
		unlinkSync(sealKeyPath(projectDir));

		// Stop-gate must now FAIL CLOSED (seal present but key missing)
		const decision = runStopGate();
		expect(decision.continue).not.toBe(true);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toMatch(/[Ss]eal verification failed/);
	});

	it("ledger read-only paths (status) work on a sealed ledger without modification", () => {
		initSealedLedger();

		const r = runLedger(["status"]);

		expect(r.exitCode).toBe(0);
		// Status output should mention the slices
		expect(r.stdout).toMatch(/S1|S2|pending/i);
	});
});
