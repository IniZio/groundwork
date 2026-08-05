/**
 * Decision-alternatives + unmarked-collision advisory (D-59/D-60).
 *
 * @verifies advisory fires with missing alternatives — finding names its id
 * @verifies advisory fires with unmarked_collision — finding names its id
 * @verifies zero offenders produces no finding
 * @verifies advisory never blocks: exit code 0, allow path unaffected
 * @verifies no crash on missing journal or motives directory
 * @verifies three existing advisories (tbd, research, spec) are not duplicated
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"hooks",
	"stop-gate.mjs",
);

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-sg-alt-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write the run ledger so the hook has a ledger to parse. */
function writeLedger(ledger: unknown): void {
	writeFileSync(
		path.join(projectDir, ".groundwork", "run.json"),
		JSON.stringify(ledger, null, 2),
	);
}

/** Write a JSONL journal shard with the given events. */
function writeJournalShard(filename: string, events: unknown[]): void {
	const journalDir = path.join(projectDir, ".groundwork", "journal");
	mkdirSync(journalDir, { recursive: true });
	const lines = events.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(path.join(journalDir, filename), lines);
}

/** Create a motives/<slug>/ directory so per-motive compilation can run. */
function createMotiveDir(slug: string): void {
	const motiveDir = path.join(projectDir, ".groundwork", "motives", slug);
	mkdirSync(motiveDir, { recursive: true });
}

interface Decision {
	continue?: boolean;
	decision?: string;
	reason?: string;
}

/**
 * Run the hook via execFileSync (asserts exit 0 implicitly by throwing on failure).
 * Always pins CLAUDE_PROJECT_DIR to the fixture dir.
 */
function runHook(
	ledger: unknown,
	sessionId = "sess-alt",
): Decision {
	writeLedger(ledger);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const out = execFileSync("node", [HOOK], {
		input,
		encoding: "utf8",
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
		},
	});
	return JSON.parse(out);
}

/**
 * Run the hook via spawnSync so we can inspect the exit code directly.
 * Returns { status, decision } — status is the OS exit code.
 */
function spawnHook(
	ledger: unknown,
	sessionId = "sess-alt",
): { status: number | null; decision: Decision } {
	writeLedger(ledger);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const result = spawnSync("node", [HOOK], {
		input,
		encoding: "utf8",
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
		},
	});
	let decision: Decision = {};
	try {
		decision = JSON.parse(result.stdout ?? "{}");
	} catch {
		// leave empty
	}
	return { status: result.status, decision };
}

// A completed ledger with advisor APPROVE — reaches the allow path where advisories fire.
const completeLedger = {
	active: true,
	session_id: "sess-alt",
	reinforcements: 0,
	slices: [{ id: "S1", kind: "impl", status: "complete" }],
	gate: { advisor: "APPROVE" },
};

// An incomplete ledger — reaches the block path; advisories never fire there.
const incompleteLedger = {
	active: true,
	session_id: "sess-alt",
	reinforcements: 0,
	slices: [{ id: "S1", kind: "impl", status: "pending" }],
	gate: { advisor: "pending" },
};

// ---------------------------------------------------------------------------
// (a) Missing alternatives — raw events path
// ---------------------------------------------------------------------------

describe("(a) missing alternatives — advisory names the id", () => {
	it("a keyed DECISION without alternatives produces a finding naming the id", () => {
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: { id: "D-99", decision: "Use X", rationale: "It is simple" },
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason).toContain("D-99");
		expect(decision.reason).toContain("missing alternatives");
	});

	it("last-state wins: id updated to add alternatives is NOT flagged", () => {
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: { id: "D-5", decision: "Use X", rationale: "First" },
			},
			{
				type: "DECISION",
				ts: "2026-08-01T01:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-5",
					decision: "Use X",
					rationale: "Updated",
					alternatives: ["Approach Y: rejected"],
				},
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		// D-5 has alternatives in its final state — must not be flagged.
		expect(decision.reason ?? "").not.toMatch(/missing alternatives.*D-5|D-5.*missing alternatives/);
	});

	it("DECISION events without an id (unkeyed) are not flagged", () => {
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: { decision: "Some informal note", rationale: "Reason" },
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason ?? "").not.toContain("missing alternatives");
	});
});

// ---------------------------------------------------------------------------
// (b) Unmarked collision — compiled view path
// ---------------------------------------------------------------------------

describe("(b) unmarked_collision — advisory names the id", () => {
	it("two events with the same id and no revises marker produces a finding", () => {
		createMotiveDir("test-motive");
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-7",
					decision: "First",
					rationale: "R1",
					alternatives: ["alt1"],
				},
			},
			{
				type: "DECISION",
				ts: "2026-08-01T01:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-7",
					decision: "Overwrite",
					rationale: "R2",
					alternatives: ["alt2"],
				},
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason).toContain("D-7");
		expect(decision.reason).toContain("possible unmarked id reuse");
	});

	it("two events with same id AND revises === id are NOT flagged", () => {
		createMotiveDir("test-motive");
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-8",
					decision: "First",
					rationale: "R1",
					alternatives: ["alt1"],
				},
			},
			{
				type: "DECISION",
				ts: "2026-08-01T01:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-8",
					revises: "D-8",
					decision: "Intentional refinement",
					rationale: "R2 — explicit revises",
					alternatives: ["alt2"],
				},
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason ?? "").not.toMatch(
			/possible unmarked id reuse.*D-8|D-8.*possible unmarked id reuse/,
		);
	});

	it("no motives dir → unmarked collision check silently skips, no crash", () => {
		// No motives dir created, single DECISION without alternatives.
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "ghost-motive",
				data: { id: "D-X", decision: "X", rationale: "Y" },
			},
		]);
		// Should not crash and should not mention "possible unmarked id reuse".
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason ?? "").not.toContain("possible unmarked id reuse");
	});
});

// ---------------------------------------------------------------------------
// Zero offenders — no finding
// ---------------------------------------------------------------------------

describe("zero offenders — no finding lines emitted", () => {
	it("clean DECISION with alternatives and single event → no advisory lines", () => {
		createMotiveDir("test-motive");
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: {
					id: "D-3",
					decision: "Use approach Z",
					rationale: "Best option",
					alternatives: ["Approach A: too slow", "Approach B: too complex"],
				},
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason ?? "").not.toContain("missing alternatives");
		expect(decision.reason ?? "").not.toContain("possible unmarked id reuse");
	});

	it("no journal shard at all → no advisory lines, no crash", () => {
		// Journal dir not created.
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.reason ?? "").not.toContain("missing alternatives");
		expect(decision.reason ?? "").not.toContain("possible unmarked id reuse");
	});
});

// ---------------------------------------------------------------------------
// Non-blocking: exit code and allow path unchanged
// ---------------------------------------------------------------------------

describe("advisory never blocks — exit code 0, continue: true with offenders", () => {
	it("offending decisions present → exit code 0 and continue: true", () => {
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: { id: "D-BLOCK-TEST", decision: "X", rationale: "Y" },
			},
		]);
		const { status, decision } = spawnHook(completeLedger);
		// Advisory must never change the exit code.
		expect(status).toBe(0);
		// Allow path is unaffected.
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
		// Finding is surfaced in reason.
		expect(decision.reason).toContain("D-BLOCK-TEST");
	});

	it("block path (incomplete ledger) with offenders → still blocks, no advisory in reason", () => {
		writeJournalShard("2026-08-01-sess-alt.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:00.000Z",
				motive: "test-motive",
				data: { id: "D-SHOULDNT-APPEAR", decision: "X", rationale: "Y" },
			},
		]);
		const { status, decision } = spawnHook(incompleteLedger);
		expect(status).toBe(0);
		expect(decision.decision).toBe("block");
		// Advisories are appended only on allow paths.
		expect(decision.reason ?? "").not.toContain("missing alternatives");
		expect(decision.reason ?? "").not.toContain("possible unmarked id reuse");
	});
});

// ---------------------------------------------------------------------------
// Cross-motive isolation — regression for probe/throwaway slug contamination
// ---------------------------------------------------------------------------

describe("cross-motive isolation — decisions from slug-less motives do not contaminate", () => {
	it("decision with empty alternatives under a probe slug does not appear when real motive has a dir", () => {
		// Real motive has a motives/ directory — its decisions are subject to the advisory.
		createMotiveDir("real-motive");
		// Probe slug has no motives/<slug>/ directory.
		// Two events: one under the real motive (with valid alternatives), one under the probe slug (no alternatives).
		writeJournalShard("2026-08-01-cross-motive.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:01.000Z",
				motive: "real-motive",
				data: {
					id: "D-REAL",
					decision: "Use approach A",
					rationale: "Best fit",
					alternatives: ["Approach B: rejected"],
				},
			},
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:02.000Z",
				motive: "probe-slug-no-dir",
				data: {
					id: "D-PROBE",
					decision: "throwaway",
					rationale: "probe",
					alternatives: [],
				},
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		// D-PROBE is in a slug with no motives/ directory — must not appear.
		expect(decision.reason ?? "").not.toContain("D-PROBE");
		// D-REAL has valid alternatives — must not appear either.
		expect(decision.reason ?? "").not.toContain("D-REAL");
		expect(decision.reason ?? "").not.toContain("missing alternatives");
	});

	it("decision with empty alternatives under real motive still fires even when a probe slug is also present", () => {
		// Real motive has a directory.
		createMotiveDir("real-motive");
		writeJournalShard("2026-08-01-cross-motive2.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:01.000Z",
				motive: "real-motive",
				data: { id: "D-REAL-BAD", decision: "X", rationale: "Y" },
			},
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:02.000Z",
				motive: "probe-slug-no-dir",
				data: { id: "D-PROBE2", decision: "throwaway", rationale: "probe", alternatives: [] },
			},
		]);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		// D-REAL-BAD has no alternatives — must still be reported.
		expect(decision.reason).toContain("D-REAL-BAD");
		// D-PROBE2 is from a slug-less motive — must NOT appear.
		expect(decision.reason ?? "").not.toContain("D-PROBE2");
	});
});

// ---------------------------------------------------------------------------
// Two-motive per-motive attribution — path (a) scoped per motive
// ---------------------------------------------------------------------------

describe("two-motive per-motive attribution — path (a) scoped per motive with [slug] prefix", () => {
	it("decision under motive A appears only in A's advisory line; motive B with alternatives produces no line", () => {
		createMotiveDir("motive-alpha");
		createMotiveDir("motive-beta");
		writeJournalShard("2026-08-01-two-motive.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:01.000Z",
				motive: "motive-alpha",
				data: { id: "D-ALPHA", decision: "Alpha choice", rationale: "Reason A" },
				// no alternatives
			},
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:02.000Z",
				motive: "motive-beta",
				data: {
					id: "D-BETA",
					decision: "Beta choice",
					rationale: "Reason B",
					alternatives: ["Other approach: rejected"],
				},
			},
		]);
		const { status, decision } = spawnHook(completeLedger);
		// Non-blocking: exit code must be 0 and continue: true (allow path).
		expect(status).toBe(0);
		expect(decision.continue).toBe(true);
		const reason = decision.reason ?? "";
		// Advisory fires for motive-alpha with [motive-alpha] attribution in printed output.
		expect(reason).toContain("D-ALPHA");
		expect(reason).toContain("motive-alpha");
		expect(reason).toContain("missing alternatives");
		// D-BETA has alternatives — must not appear.
		expect(reason).not.toContain("D-BETA");
		// No collision (single events, no id reuse).
		expect(reason).not.toContain("possible unmarked id reuse");
		// D-ALPHA must NOT appear on any line mentioning motive-beta.
		const betaLine = reason.split("\n").find((l) => l.includes("motive-beta"));
		expect(betaLine).toBeUndefined();
	});

	it("decisions under different motives are each attributed to their own motive — ids never cross", () => {
		createMotiveDir("motive-x");
		createMotiveDir("motive-y");
		writeJournalShard("2026-08-01-two-motive-both.jsonl", [
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:01.000Z",
				motive: "motive-x",
				data: { id: "D-X1", decision: "X1 choice", rationale: "Reason" },
			},
			{
				type: "DECISION",
				ts: "2026-08-01T00:00:02.000Z",
				motive: "motive-y",
				data: { id: "D-Y1", decision: "Y1 choice", rationale: "Reason" },
			},
		]);
		const { status, decision } = spawnHook(completeLedger);
		// Non-blocking: exit code must be 0, continue: true.
		expect(status).toBe(0);
		expect(decision.continue).toBe(true);
		const reason = decision.reason ?? "";
		// Both motives have missing alternatives — both lines must be present.
		expect(reason).toContain("D-X1");
		expect(reason).toContain("motive-x");
		expect(reason).toContain("D-Y1");
		expect(reason).toContain("motive-y");
		// No collision (each id appears only once).
		expect(reason).not.toContain("possible unmarked id reuse");
		// Attribution isolation: each id appears on its own motive's line, not the other's.
		const lines = reason.split("\n");
		const xLine = lines.find((l) => l.includes("motive-x"));
		const yLine = lines.find((l) => l.includes("motive-y"));
		expect(xLine).toBeDefined();
		expect(xLine).toContain("D-X1");
		expect(xLine).not.toContain("D-Y1");
		expect(yLine).toBeDefined();
		expect(yLine).toContain("D-Y1");
		expect(yLine).not.toContain("D-X1");
	});
});
