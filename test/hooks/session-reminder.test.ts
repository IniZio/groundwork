import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

	it("names the motive MAP.md as the human read path before any CLI enumeration", () => {
		// Create a real per-motive MAP.md so the hook enumerates it.
		const motiveDir = path.join(projectDir, ".groundwork", "motives", "test-motive");
		mkdirSync(motiveDir, { recursive: true });
		writeFileSync(path.join(motiveDir, "MAP.md"), "# MAP\n");
		const expectedMapPath = path.join(motiveDir, "MAP.md");

		const ctx = runReminder(undefined, "sess-1", "startup");
		// Absolute motive MAP path derived from the actual writer location must be present.
		expect(ctx).toContain(expectedMapPath);
		// MAP pointer must appear before the CLI tools block.
		const mapIdx = ctx.indexOf(expectedMapPath);
		const cliIdx = ctx.indexOf("Groundwork CLI tools");
		expect(mapIdx).toBeGreaterThanOrEqual(0);
		expect(cliIdx).toBeGreaterThanOrEqual(0);
		expect(mapIdx).toBeLessThan(cliIdx);
	});

	it("falls back to generic motive path wording when no MAP.md files exist yet", () => {
		const ctx = runReminder(undefined, "sess-1", "startup");
		expect(ctx).toContain(".groundwork/motives/<slug>/MAP.md");
		// The MAP pointer must not reference the old runs/<session_id>/MAP.md path.
		expect(ctx).not.toContain("runs/sess-1/MAP.md");
		expect(ctx).not.toContain("runs/<session_id>/MAP.md");
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

// ---------------------------------------------------------------------------
// Embedded-agent guard (CLAUDE_CODE_ENTRYPOINT)

describe("session-reminder hook — embedded-agent guard", () => {
	/** Run the hook with a given CLAUDE_CODE_ENTRYPOINT value; return raw stdout. */
	function runWithEntrypoint(entrypoint: string | undefined): string {
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-1", source: "startup" });
		const env = { ...process.env };
		if (entrypoint !== undefined) env.CLAUDE_CODE_ENTRYPOINT = entrypoint;
		else delete env.CLAUDE_CODE_ENTRYPOINT;
		return execFileSync("node", [HOOK], { input, encoding: "utf8", env });
	}

	it("produces NO output (empty stdout) when CLAUDE_CODE_ENTRYPOINT=sdk-py", () => {
		const out = runWithEntrypoint("sdk-py");
		expect(out).toBe("");
	});

	it("produces NO output (empty stdout) when CLAUDE_CODE_ENTRYPOINT=sdk-js", () => {
		const out = runWithEntrypoint("sdk-js");
		expect(out).toBe("");
	});

	it("produces normal injection when CLAUDE_CODE_ENTRYPOINT=cli", () => {
		const out = runWithEntrypoint("cli");
		const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
		expect(ctx).toContain("Orchestrator Mode");
	});

	it("produces normal injection when CLAUDE_CODE_ENTRYPOINT is unset", () => {
		const out = runWithEntrypoint(undefined);
		const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
		expect(ctx).toContain("Orchestrator Mode");
	});
});

// ---------------------------------------------------------------------------
// CLAUDE_ENV_FILE export

describe("session-reminder hook — CLAUDE_ENV_FILE export", () => {
	it("appends CLAUDE_CODE_SESSION_ID=<sessionId> to CLAUDE_ENV_FILE when set", () => {
		const envFile = path.join(projectDir, "session.env");
		const input = JSON.stringify({ cwd: projectDir, session_id: "test-sess-xyz", source: "startup" });
		execFileSync("node", [HOOK], {
			input,
			encoding: "utf8",
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_ENV_FILE: envFile },
		});
		const contents = readFileSync(envFile, "utf8");
		expect(contents).toContain("CLAUDE_CODE_SESSION_ID=test-sess-xyz");
		// Must be a bare KEY=value line — no "export" keyword
		expect(contents).not.toMatch(/export\s+CLAUDE_CODE_SESSION_ID/);
	});

	it("does not duplicate the line on a second invocation", () => {
		const envFile = path.join(projectDir, "session.env");
		const input = JSON.stringify({ cwd: projectDir, session_id: "test-sess-xyz", source: "startup" });
		const opts = {
			input,
			encoding: "utf8" as const,
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_ENV_FILE: envFile },
		};
		execFileSync("node", [HOOK], opts);
		execFileSync("node", [HOOK], opts);
		const contents = readFileSync(envFile, "utf8");
		const matches = contents.split("\n").filter((l) => l.trim() === "CLAUDE_CODE_SESSION_ID=test-sess-xyz");
		expect(matches).toHaveLength(1);
	});

	it("does not write to CLAUDE_ENV_FILE when session_id is absent from stdin", () => {
		const envFile = path.join(projectDir, "session.env");
		const input = JSON.stringify({ cwd: projectDir, source: "startup" }); // no session_id
		execFileSync("node", [HOOK], {
			input,
			encoding: "utf8",
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_ENV_FILE: envFile },
		});
		// File should not be created at all
		let contents: string | undefined;
		try { contents = readFileSync(envFile, "utf8"); } catch { /* expected */ }
		if (contents !== undefined) {
			expect(contents).not.toContain("CLAUDE_CODE_SESSION_ID");
		}
	});
});
