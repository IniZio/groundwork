/**
 * stop-gate-checkpoint-e2e.test.ts — T22: end-to-end phase-checkpoint gate loop.
 *
 * Drives the gate through DEPLOYED binaries with a real seal, covering the five
 * cases whose absence let two defects survive 4295 tests and 20 commits:
 *
 * 1. wave-1 hold + valid seal → stop-gate ALLOWS with DIRECTIVE   (the missing positive cell)
 * 2. plan hold + valid seal → stop-gate BLOCKS naming the phase
 * 3. APPROVE for held phase → clears hold → stop-gate releases
 * 4. Tampered checkpoint_hold (direct JSON, no token) → BLOCKS fail-closed on both tiers
 * 5. wave-plan BLOCKS; genuine wave-1 ALLOWS (proves the tier matcher)
 *
 * Bite proof: pre-fix bundle (dist/gw.mjs@eb42776) blocks valid-seal wave-1 hold
 * when gate.phases + checkpoint_hold are both present (key-order mismatch in the
 * old inlined canonicalReleaseState vs gate-seal.mjs). Current binary allows.
 *
 * Deployed path (as registered in hooks/hooks.json):
 *   Stop hook → bin/gw-hook → dist/gw.mjs → hook stop-gate
 *   bin/ledger → hooks/ledger.mjs → ledger init
 *   bin/gw-hook → dist/gw.mjs → ledger hold / checkpoint
 */

// @verifies AC-7
// @verifies AC-8
// @verifies AC-9
// @verifies AC-10
// @verifies AC-14

import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalReleaseState, computeSeal, readKey } from "../../hooks/lib/gate-seal.mjs";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const GW_HOOK = path.join(REPO_ROOT, "bin/gw-hook");
const LEDGER_BIN = path.join(REPO_ROOT, "bin/ledger");
const PRE_FIX_BUNDLE = "/tmp/gw-pre-fix-eb42776.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initLedger(
	projectDir: string,
	sessionId: string,
	brief = "e2e gate test",
	slices: unknown[] = [],
): string {
	const initFile = path.join(projectDir, "init.json");
	writeFileSync(initFile, JSON.stringify({ brief, slices }));
	const r = spawnSync(LEDGER_BIN, ["init", initFile], {
		encoding: "utf8",
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
			CLAUDE_CODE_SESSION_ID: sessionId,
		},
	});
	if (r.status !== 0)
		throw new Error(`ledger init failed (exit ${r.status}): ${r.stderr}`);
	const match = /^write_token:\s+(\S+)/m.exec(r.stdout);
	if (!match) throw new Error(`could not parse write_token from: ${r.stdout}`);
	return match[1];
}

function runLedger(
	projectDir: string,
	sessionId: string,
	args: string[],
): { exitCode: number; stdout: string; stderr: string } {
	const r = spawnSync(GW_HOOK, ["ledger", ...args], {
		encoding: "utf8",
		cwd: REPO_ROOT,
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
			CLAUDE_CODE_SESSION_ID: sessionId,
		},
	});
	return { exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runStopGate(
	projectDir: string,
	sessionId: string,
	bunPath?: string,
	bundlePath?: string,
): { continue?: boolean; decision?: string; reason?: string; exitCode: number } {
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const env = {
		...process.env,
		GW_REPO_ROOT: REPO_ROOT,
		CLAUDE_PROJECT_DIR: projectDir,
		CLAUDE_CODE_SESSION_ID: sessionId,
	};
	const r = bunPath && bundlePath
		? spawnSync(bunPath, [bundlePath, "hook", "stop-gate"], { input, encoding: "utf8", env })
		: spawnSync(GW_HOOK, ["hook", "stop-gate"], { input, encoding: "utf8", env });
	if (r.error) throw r.error;
	const parsed = JSON.parse(r.stdout ?? "{}") as {
		continue?: boolean; decision?: string; reason?: string;
	};
	return { ...parsed, exitCode: r.status ?? 0 };
}

/**
 * Build the single-field control state: checkpoint_hold sealed with NO
 * gate.phases entry. `gw ledger hold` also records a gate.phases entry for the
 * held phase, so this state is not reachable through the CLI; it is written
 * directly and re-sealed with the product's own canonical fold
 * (hooks/lib/gate-seal.mjs), never with a formula restated here.
 */
function sealHoldWithoutPhases(projectDir: string, sessionId: string, phase: string): void {
	const ledgerPath = path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);
	const led = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
	delete led["gate"];
	led["checkpoint_hold"] = phase;
	const seal = computeSeal(canonicalReleaseState(led), readKey({ projectDir, sessionId }));
	led["gate"] = { seal };
	writeFileSync(ledgerPath, JSON.stringify(led, null, 2));
}

function tamperLedger(projectDir: string, sessionId: string, holdValue: string): void {
	const ledgerPath = path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);
	const raw = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
	raw["checkpoint_hold"] = holdValue;
	writeFileSync(ledgerPath, JSON.stringify(raw, null, 2));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let projectDir: string;
let sessionIdx = 0;

function freshSession(): string {
	return `e2e-gate-${process.pid}-${++sessionIdx}`;
}

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-e2e-gate-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

beforeAll(() => {
	const r = spawnSync("git", ["show", "eb42776:dist/gw.mjs"], {
		cwd: REPO_ROOT,
		encoding: "buffer",
		maxBuffer: 10 * 1024 * 1024,
	});
	if (r.status === 0) writeFileSync(PRE_FIX_BUNDLE, r.stdout);
});

afterAll(() => {
	try { rmSync(PRE_FIX_BUNDLE, { force: true }); } catch { /* best-effort */ }
});

// ---------------------------------------------------------------------------
// Case 1: wave-1 hold + valid seal → ALLOW with DIRECTIVE
// ---------------------------------------------------------------------------

describe("Case 1: wave-1 hold + valid seal → stop-gate ALLOWS with DIRECTIVE", () => {
	it("returns continue:true (exit 0)", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "wave-1 allow test", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);
		expect(runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]).exitCode).toBe(0);

		const sg = runStopGate(projectDir, sessionId);
		expect(sg.exitCode).toBe(0);
		expect(sg.continue).toBe(true);
	});

	it("reason contains DIRECTIVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "directive test", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).reason?.toUpperCase()).toContain("DIRECTIVE");
	});

	it("reason names the wave-1 phase key", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "phase key test", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).reason).toContain("wave-1");
	});
});

// ---------------------------------------------------------------------------
// Case 2: plan hold + valid seal → BLOCK
// ---------------------------------------------------------------------------

describe("Case 2: plan hold + valid seal → stop-gate BLOCKS naming the phase", () => {
	it("returns decision:block (exit 0)", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "plan hold test");
		expect(runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "plan", "--token", token,
		]).exitCode).toBe(0);

		const sg = runStopGate(projectDir, sessionId);
		expect(sg.exitCode).toBe(0);
		expect(sg.decision).toBe("block");
	});

	it("block reason names the plan phase key", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "plan reason test");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "plan", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).reason).toContain("plan");
	});

	it("block reason does NOT contain DIRECTIVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "plan no directive");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "plan", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).reason?.toUpperCase()).not.toContain("DIRECTIVE");
	});
});

// ---------------------------------------------------------------------------
// Case 3: APPROVE for held phase → clears hold → stop-gate releases
// ---------------------------------------------------------------------------

describe("Case 3: checkpoint APPROVE for held phase → hold cleared → stop-gate ALLOWS", () => {
	it("blocks before checkpoint, allows after APPROVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "approve-release test");

		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "plan", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).decision).toBe("block");

		const ckpt = runLedger(projectDir, sessionId, [
			"checkpoint", "--motive", "test-e2e",
			"--phase", "plan", "--verdict", "APPROVE",
			"--verified-by", "e2e-test", "--token", token,
		]);
		expect(ckpt.exitCode).toBe(0);

		const after = runStopGate(projectDir, sessionId);
		expect(after.exitCode).toBe(0);
		expect(after.reason?.toLowerCase()).not.toContain("checkpoint_hold");
	});

	it("checkpoint stdout confirms APPROVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "ckpt stdout test");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "plan", "--token", token,
		]);
		const ckpt = runLedger(projectDir, sessionId, [
			"checkpoint", "--motive", "test-e2e",
			"--phase", "plan", "--verdict", "APPROVE",
			"--verified-by", "e2e-test", "--token", token,
		]);
		expect(ckpt.stdout).toContain("APPROVE");
	});
});

// ---------------------------------------------------------------------------
// Case 4: direct JSON tamper of checkpoint_hold → BLOCKS fail-closed (both tiers)
// ---------------------------------------------------------------------------

describe("Case 4: direct JSON tamper of checkpoint_hold → BLOCKS fail-closed", () => {
	it("BLOCKS tier tamper (plan) → block fail-closed", () => {
		const sessionId = freshSession();
		initLedger(projectDir, sessionId, "tamper blocks test");
		tamperLedger(projectDir, sessionId, "plan");

		const sg = runStopGate(projectDir, sessionId);
		expect(sg.exitCode).toBe(0);
		expect(sg.decision).toBe("block");
	});

	it("BLOCKS tier tamper reason mentions seal or key", () => {
		const sessionId = freshSession();
		initLedger(projectDir, sessionId, "tamper seal msg test");
		tamperLedger(projectDir, sessionId, "plan");

		const r = runStopGate(projectDir, sessionId).reason?.toLowerCase() ?? "";
		expect(r.includes("seal") || r.includes("key")).toBe(true);
	});

	it("AUTO_ADVANCES tier tamper (wave-1) → block fail-closed", () => {
		const sessionId = freshSession();
		initLedger(projectDir, sessionId, "tamper auto-advances test");
		tamperLedger(projectDir, sessionId, "wave-1");

		const sg = runStopGate(projectDir, sessionId);
		expect(sg.exitCode).toBe(0);
		expect(sg.decision).toBe("block");
	});

	it("AUTO_ADVANCES tier tamper reason mentions seal or key", () => {
		const sessionId = freshSession();
		initLedger(projectDir, sessionId, "tamper auto seal msg");
		tamperLedger(projectDir, sessionId, "wave-1");

		const r = runStopGate(projectDir, sessionId).reason?.toLowerCase() ?? "";
		expect(r.includes("seal") || r.includes("key")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Case 5: tier matcher — wave-1 allows, wave-plan blocks
// ---------------------------------------------------------------------------

describe("Case 5: tier matcher — wave-1 allows, wave-plan blocks", () => {
	it("wave-1 (genuine wave phase) → ALLOW with DIRECTIVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "wave-1 matcher", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]);
		const sg = runStopGate(projectDir, sessionId);
		expect(sg.continue).toBe(true);
		expect(sg.reason?.toUpperCase()).toContain("DIRECTIVE");
	});

	it("wave-plan (non-digit suffix) → BLOCK", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "wave-plan matcher");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-plan", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).decision).toBe("block");
	});

	it("wave-plan block reason does NOT contain DIRECTIVE", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "wave-plan no directive");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-plan", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).reason?.toUpperCase()).not.toContain("DIRECTIVE");
	});

	it("wave-1 decision is not block", () => {
		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "wave-1 not block");
		runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]);
		expect(runStopGate(projectDir, sessionId).decision).not.toBe("block");
	});
});

// ---------------------------------------------------------------------------
// Bite proof: pre-fix binary (eb42776) blocks valid-seal wave-1 hold;
// current binary allows it.
//
// Root cause: stop-gate.ts@eb42776 serialised gate_phases before checkpoint_hold;
// gate-seal.mjs serialises checkpoint_hold before gate_phases. When both fields
// are present the HMAC strings diverge → fail-closed → BLOCK instead of ALLOW.
//
// Trigger: init → checkpoint plan (adds gate.phases) → hold wave-1
//          (sets checkpoint_hold; both fields now present in the sealed ledger).
// ---------------------------------------------------------------------------

describe("Bite proof: pre-fix binary (eb42776) blocks valid-seal wave-1 hold", () => {
	let bunPath: string;

	beforeAll(() => {
		for (const c of [
			"bun",
			`${process.env["HOME"]}/.bun/bin/bun`,
			"/usr/local/bin/bun",
			"/opt/homebrew/bin/bun",
		]) {
			if (spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0) {
				bunPath = c;
				break;
			}
		}
	});

	it("pre-fix binary BLOCKS; current binary ALLOWS (gate.phases + checkpoint_hold both present)", () => {
		if (!bunPath) { console.warn("bun not found — bite proof skipped"); return; }

		const sessionId = freshSession();
		const token = initLedger(projectDir, sessionId, "bite proof", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);

		expect(runLedger(projectDir, sessionId, [
			"checkpoint", "--motive", "test-e2e",
			"--phase", "plan", "--verdict", "APPROVE",
			"--verified-by", "e2e-test", "--token", token,
		]).exitCode).toBe(0);

		expect(runLedger(projectDir, sessionId, [
			"hold", "--motive", "test-e2e", "--phase", "wave-1", "--token", token,
		]).exitCode).toBe(0);

		expect(runStopGate(projectDir, sessionId, bunPath, PRE_FIX_BUNDLE).decision).toBe("block");
		const current = runStopGate(projectDir, sessionId);
		expect(current.continue).toBe(true);
		expect(current.reason?.toUpperCase()).toContain("DIRECTIVE");
	});

	it("checkpoint_hold sealed WITHOUT gate.phases — pre-fix allows, isolates defect 1 scope", () => {
		if (!bunPath) { console.warn("bun not found — bite proof skipped"); return; }

		const sessionId = freshSession();
		initLedger(projectDir, sessionId, "bite proof scope", [
			{ id: "S1", wave: 1, status: "pending", kind: "impl" },
		]);
		sealHoldWithoutPhases(projectDir, sessionId, "wave-1");

		expect(runStopGate(projectDir, sessionId, bunPath, PRE_FIX_BUNDLE).continue).toBe(true);
		expect(runStopGate(projectDir, sessionId).continue).toBe(true);
	});
});
