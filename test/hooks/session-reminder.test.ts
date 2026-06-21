import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "session-reminder.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-reminder-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

/** Run the SessionStart reminder hook; return the injected additionalContext string. */
function runReminder(ledger: unknown, sessionId = "sess-1", source = "compact"): string {
	if (ledger !== undefined) {
		writeFileSync(path.join(projectDir, ".groundwork", "run.json"), JSON.stringify(ledger, null, 2));
	}
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, source });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out).hookSpecificOutput.additionalContext as string;
}

const incompleteLedger = {
	version: 1,
	active: true,
	session_id: "sess-1",
	brief: "Build widget pipeline",
	plan_ref: ".groundwork/plans/widget.md",
	slices: [
		{ id: "S1", status: "complete", behavior: "types" },
		{ id: "S2", status: "in_progress", behavior: "core logic", acceptance: ["a", "b", "c"] },
		{ id: "S3", status: "pending", behavior: "surface + tests", acceptance: ["d", "e"] },
	],
	gate: {},
};

describe("session-reminder hook — static rulebook (always present)", () => {
	it("always emits the orchestrator rules, even with no ledger", () => {
		const ctx = runReminder(undefined, "sess-1", "startup");
		expect(ctx).toContain("Orchestrator Mode");
		expect(ctx).toContain("Run ledger & Stop-gate");
		expect(ctx).not.toContain("ACTIVE RUN");
	});

	it("includes session identity when provided", () => {
		const ctx = runReminder(undefined, "sess-1", "resume");
		expect(ctx).toContain("session_id: sess-1");
	});
});

describe("session-reminder hook — active run resurfacing (post-compact)", () => {
	it("resurfaces incomplete slices owned by this session", () => {
		const ctx = runReminder(incompleteLedger);
		expect(ctx).toContain("ACTIVE RUN — RESUME HERE");
		expect(ctx).toContain("Build widget pipeline");
		expect(ctx).toContain("2 slice(s) NOT complete");
		expect(ctx).toContain("S2 [in_progress]");
		expect(ctx).toContain("S3 [pending]");
		// Lists acceptance-criteria counts for incomplete slices.
		expect(ctx).toContain("3 acceptance criteria");
		// Re-emits a resume banner with the count.
		expect(ctx).toContain("GROUNDWORK ▸ resuming 2 incomplete slice(s)");
	});

	it("does NOT resurface a run owned by a different session", () => {
		const ctx = runReminder(incompleteLedger, "other-session");
		expect(ctx).not.toContain("ACTIVE RUN");
	});

	it("does NOT resurface an inactive (closed) run", () => {
		const ctx = runReminder({ ...incompleteLedger, active: false });
		expect(ctx).not.toContain("ACTIVE RUN");
	});

	it("tells you to record the gate when all slices complete but advisor not APPROVE", () => {
		const ctx = runReminder({
			...incompleteLedger,
			slices: [{ id: "S1", status: "complete", behavior: "x" }],
			gate: {},
		});
		expect(ctx).toContain("ACTIVE RUN");
		expect(ctx).toContain("advisor gate is not APPROVE");
	});

	it("tells you to close the run when all complete AND advisor APPROVE (object form)", () => {
		const ctx = runReminder({
			...incompleteLedger,
			slices: [{ id: "S1", status: "complete", behavior: "x" }],
			gate: { advisor: { verdict: "APPROVE", citation: "none" } },
		});
		expect(ctx).toContain("this run is finished");
		expect(ctx).toContain('"active": false');
	});

	it("accepts the legacy string advisor verdict", () => {
		const ctx = runReminder({
			...incompleteLedger,
			slices: [{ id: "S1", status: "complete", behavior: "x" }],
			gate: { advisor: "APPROVE" },
		});
		expect(ctx).toContain("this run is finished");
	});

	it("fails open (rules only, no block) on a malformed ledger", () => {
		writeFileSync(path.join(projectDir, ".groundwork", "run.json"), "{ not valid json :::");
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-1", source: "compact" });
		const ctx = JSON.parse(execFileSync("node", [HOOK], { input, encoding: "utf8" })).hookSpecificOutput
			.additionalContext as string;
		expect(ctx).toContain("Orchestrator Mode");
		expect(ctx).not.toContain("ACTIVE RUN");
	});
});
