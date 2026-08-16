/**
 * Regression tests for the wave-width NOTICE diagnostic in session-reminder.mjs.
 *
 * The diagnostic emits:
 *   "NOTICE: wave N has 1 impl slice — if this work is non-trivial, reconsider…"
 *
 * Fixed predicate: fire only when the wave's TOTAL non-exempt impl slice count is 1
 * AND that single slice is still incomplete. A wave planned wide but nearly done
 * (e.g. 4 of 5 slices complete) must NOT fire.
 *
 * Non-vacuity guarantee: every negative assertion test also checks that the hook
 * DID read and process the fixture (ACTIVE RUN is present in output), proving the
 * harness is wired to the fixture and not returning a short-circuit empty string
 * that would make `.not.toContain` trivially pass.
 *
 * Environment isolation: CLAUDE_PROJECT_DIR is deleted from the env passed to
 * execFileSync so the hook never sees the real repo tree. The hook resolves the
 * ledger from stdin's `cwd` field (the per-test tmpdir), not CLAUDE_PROJECT_DIR.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "session-reminder.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-wave-width-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

/**
 * Run the hook with the given ledger and return additionalContext.
 * Deletes CLAUDE_PROJECT_DIR from the subprocess env to prevent the hook
 * from accidentally reading the real project tree.
 */
function runReminder(ledger: unknown, sessionId = "sess-wave"): string {
	writeFileSync(
		path.join(projectDir, ".groundwork", "run.json"),
		JSON.stringify(ledger, null, 2),
	);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, source: "compact" });
	// Strip CLAUDE_PROJECT_DIR so the hook cannot fall back to the real tree.
	const env = { ...process.env };
	delete env["CLAUDE_PROJECT_DIR"];
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8", env });
	return JSON.parse(out).hookSpecificOutput.additionalContext as string;
}

/** A valid active ledger shell shared across tests. */
function baseLedger(slices: unknown[]): unknown {
	return {
		active: true,
		session_id: "sess-wave",
		brief: "Wave-width test run",
		slices,
		gate: {},
	};
}

const NOTICE_PREFIX = "NOTICE: wave";

describe("session-reminder — wave-width NOTICE diagnostic", () => {
	// (a) A wave whose ONLY impl slice is incomplete → NOTICE fires.
	it("(a) emits NOTICE when the wave's single impl slice is incomplete", () => {
		const ledger = baseLedger([
			{ id: "S1", wave: 1, status: "pending", behavior: "sole slice", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		// Sanity: confirm the hook processed the fixture (non-vacuity anchor).
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).toContain(NOTICE_PREFIX);
		expect(ctx).toContain("NOTICE: wave 1 has 1 impl slice");
	});

	// (b) A wave with 2+ incomplete impl slices → no NOTICE.
	it("(b) does NOT emit NOTICE when the wave has 2+ incomplete impl slices", () => {
		const ledger = baseLedger([
			{ id: "S1", wave: 1, status: "pending", behavior: "slice one", kind: "impl" },
			{ id: "S2", wave: 1, status: "in_progress", behavior: "slice two", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		// Harness is reading the fixture: ACTIVE RUN must appear.
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).not.toContain(NOTICE_PREFIX);
	});

	// (c) THE PART-1 FIX: a wave planned with 5 impl slices where 4 are complete
	// and 1 is incomplete → NO NOTICE.
	// Under the OLD predicate (incomplete-only waveMap), this scenario would emit
	// a spurious NOTICE because only 1 incomplete slice remains in the map.
	// Under the NEW predicate (total count per wave must be 1), total=5 ≠ 1 → silent.
	it("(c) does NOT emit NOTICE for a wide wave that is nearly finished (4 of 5 complete)", () => {
		const ledger = baseLedger([
			{ id: "S1", wave: 2, status: "complete", behavior: "slice one", kind: "impl" },
			{ id: "S2", wave: 2, status: "complete", behavior: "slice two", kind: "impl" },
			{ id: "S3", wave: 2, status: "complete", behavior: "slice three", kind: "impl" },
			{ id: "S4", wave: 2, status: "complete", behavior: "slice four", kind: "impl" },
			{ id: "S5", wave: 2, status: "in_progress", behavior: "slice five", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		// Harness is reading the fixture: ACTIVE RUN + remaining incomplete slice must appear.
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).toContain("S5");
		// No spurious NOTICE despite only 1 incomplete slice remaining.
		expect(ctx).not.toContain(NOTICE_PREFIX);
	});

	// (d) A wave whose single impl slice is COMPLETE → no NOTICE.
	it("(d) does NOT emit NOTICE when the wave's single impl slice is complete", () => {
		const ledger = baseLedger([
			{ id: "S1", wave: 3, status: "complete", behavior: "finished slice", kind: "impl" },
			// Add a second incomplete slice in a different wave so ACTIVE RUN fires.
			{ id: "S2", wave: 4, status: "pending", behavior: "other wave", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		// Wave 3 (single but complete) must not fire; only wave 4 is a single-incomplete wave.
		expect(ctx).toContain("NOTICE: wave 4 has 1 impl slice");
		expect(ctx).not.toContain("NOTICE: wave 3");
	});

	// (e) A wave with a single exempt-kind slice (plan/diagnose/design/fog) → no NOTICE.
	it("(e) does NOT emit NOTICE for a single exempt-kind slice (plan)", () => {
		const ledger = baseLedger([
			{ id: "P1", wave: 1, status: "pending", behavior: "planning phase", kind: "plan" },
			// Incomplete non-exempt slice in wave 2 to ensure ACTIVE RUN fires.
			{ id: "S1", wave: 2, status: "pending", behavior: "impl work", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		// Wave 1 is a plan slice — exempt, must not fire.
		expect(ctx).not.toContain("NOTICE: wave 1");
		// Wave 2 is a single impl slice and should fire.
		expect(ctx).toContain("NOTICE: wave 2 has 1 impl slice");
	});

	it("(e-diagnose) does NOT emit NOTICE for a single 'diagnose' kind slice", () => {
		const ledger = baseLedger([
			{ id: "D1", wave: 1, status: "pending", behavior: "diagnose root cause", kind: "diagnose" },
			{ id: "S1", wave: 2, status: "pending", behavior: "impl work", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).not.toContain("NOTICE: wave 1");
	});

	it("(e-design) does NOT emit NOTICE for a single 'design' kind slice", () => {
		const ledger = baseLedger([
			{ id: "D1", wave: 1, status: "pending", behavior: "design phase", kind: "design" },
			{ id: "S1", wave: 2, status: "pending", behavior: "impl work", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).not.toContain("NOTICE: wave 1");
	});

	it("(e-fog) does NOT emit NOTICE for a single 'fog' kind slice", () => {
		const ledger = baseLedger([
			{ id: "F1", wave: 1, status: "pending", behavior: "fog of war", kind: "fog" },
			{ id: "S1", wave: 2, status: "pending", behavior: "impl work", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).not.toContain("NOTICE: wave 1");
	});

	// (f) Malformed / corrupt ledger → no throw, hook still returns normally.
	it("(f-bad-json) does not throw on corrupt ledger JSON — hook returns normally", () => {
		// Write corrupt JSON directly (bypass runReminder helper).
		writeFileSync(
			path.join(projectDir, ".groundwork", "run.json"),
			"{ this is not : valid json :::}",
		);
		const input = JSON.stringify({
			cwd: projectDir,
			session_id: "sess-wave",
			source: "compact",
		});
		const env = { ...process.env };
		delete env["CLAUDE_PROJECT_DIR"];
		// Must not throw — hook exits 0 and still returns the rulebook.
		const out = execFileSync("node", [HOOK], { input, encoding: "utf8", env });
		const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
		expect(ctx).toContain("Orchestrator Mode");
		// Fails open — no ACTIVE RUN block, no throw.
		expect(ctx).not.toContain("ACTIVE RUN");
		expect(ctx).not.toContain(NOTICE_PREFIX);
	});

	it("(f-slices-not-array) does not throw when slices is not an array", () => {
		const ledger = {
			active: true,
			session_id: "sess-wave",
			brief: "Bad slices run",
			slices: "not an array",
			gate: {},
		};
		const ctx = runReminder(ledger);
		// Hook still emits the active-run block (ledger is otherwise valid).
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).not.toContain(NOTICE_PREFIX);
	});

	it("(f-null-slice-entry) does not throw when a slice entry is null", () => {
		const ledger = baseLedger([
			null,
			{ id: "S1", wave: 1, status: "pending", behavior: "good slice", kind: "impl" },
		]);
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");
		// The null entry is ignored; the real single-incomplete slice should still fire.
		expect(ctx).toContain("NOTICE: wave 1 has 1 impl slice");
	});
});

describe("session-reminder — verbatim-survival: stop-gate and pacing clauses", () => {
	// Compression-regression guard: any reword of the stop-gate clause changes
	// the mechanical enforcement contract and must be deliberately chosen.
	it("stop-gate clause survives verbatim in static reminder (no active run)", () => {
		// Run the hook without an active ledger — only the static reminder is emitted.
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-verbatim", source: "compact" });
		const env = { ...process.env };
		delete env["CLAUDE_PROJECT_DIR"];
		const out = execFileSync("node", [HOOK], { input, encoding: "utf8", env });
		const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;

		// No active ledger → no ACTIVE RUN block.
		expect(ctx).not.toContain("ACTIVE RUN");

		// The stop-gate paragraph must be present verbatim.
		expect(ctx).toContain(
			"A `Stop` hook reads this ledger on every attempt to end the session and BLOCKS the stop — re-injecting the fan-out rules — while any slice is not `complete` or while `gate.advisor` is not `APPROVE`. This is what makes the workflow stick; the rules above are not optional suggestions you can drop as context grows.",
		);
	});

	// The pacing exhausted clauses must survive verbatim in the active-run block
	// when the budget is consumed. These are the enforceable lines the orchestrator
	// reads to understand the pacing block is policy, not a bug.
	it("pacing budget-exhausted clauses survive verbatim in active-run block", () => {
		// Build an exhausted ledger:
		//   pacing budget=1, wave policy
		//   wave 1: 1 complete non-exempt slice  → 1 resolved unit (= budget)
		//   wave 2: 1 pending non-exempt slice   → remaining work, no in_progress → isExhausted=true
		const ledger = {
			active: true,
			session_id: "sess-wave",
			brief: "Pacing verbatim test",
			slices: [
				{ id: "W1S1", wave: 1, status: "complete", behavior: "done slice", kind: "impl" },
				{ id: "W2S1", wave: 2, status: "pending", behavior: "blocked slice", kind: "impl" },
			],
			gate: {},
			pacing: { policy: "wave", budget: 1, exempt_kinds: [] },
		};
		const ctx = runReminder(ledger);
		expect(ctx).toContain("ACTIVE RUN");

		// Verbatim budget-exhausted clause.
		expect(ctx).toContain(
			"⚠ Budget exhausted — `ledger claim` and `ledger set --status in_progress` will exit 1 for new units. This is the pacing policy, not a bug.",
		);

		// Verbatim sanctioned-overage fixed suffix (LEDGER_BIN is machine-specific; assert the stable tail).
		expect(ctx).toContain(
			"(orchestrator-only; NEVER pass token to subagents).",
		);
	});
});
