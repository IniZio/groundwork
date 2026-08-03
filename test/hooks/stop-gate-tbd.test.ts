/**
 * S7 — TBD gate: warn-only advisory, default OFF.
 *
 * @verifies S7-AC1 Default-off: no TBD output when GROUNDWORK_TBD_GATE is unset.
 * @verifies S7-AC2 Count line appears when enabled and open items exist.
 * @verifies S7-AC3 Allow path is not blocked by TBD items.
 * @verifies S7-AC4 Missing/corrupt charter → no crash, no line.
 * @verifies S7-AC5 Fixture dirs pinned via mkdtemp + explicit env, never reads real repo.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "stop-gate.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-stop-tbd-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeLedger(ledger: unknown): void {
	writeFileSync(
		path.join(projectDir, ".groundwork", "run.json"),
		JSON.stringify(ledger, null, 2),
	);
}

/**
 * Write a charter file with `n` TBD open items under the given motive slug.
 */
function writeCharter(slug: string, openItemCount: number): void {
	const motiveDir = path.join(projectDir, ".groundwork", "motives", slug);
	mkdirSync(motiveDir, { recursive: true });
	const items = Array.from(
		{ length: openItemCount },
		(_, i) => `- TBD-${i + 1}: Open item ${i + 1}.`,
	).join("\n");
	const content = `# motive: ${slug}\n\n## Objective\n\nTest objective.\n\n## Notes\n\n<!-- notes -->\n\n## Open items\n\n${items}\n\n## Out of scope\n\n<!-- none -->\n`;
	writeFileSync(path.join(motiveDir, "motive.md"), content);
}

interface Decision {
	continue?: boolean;
	decision?: string;
	reason?: string;
}

/**
 * Run the hook with optional extra env vars. Fixture dir is always pinned via
 * `cwd` in the input JSON and CLAUDE_PROJECT_DIR in env (AC5: never reads real repo).
 */
function runHook(
	ledger: unknown,
	opts: { sessionId?: string; env?: Record<string, string> } = {},
): Decision {
	const sessionId = opts.sessionId ?? "sess-tbd";
	writeLedger(ledger);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const out = execFileSync("node", [HOOK], {
		input,
		encoding: "utf8",
		// AC5: pin CLAUDE_PROJECT_DIR to the fixture dir so ambient env never leaks in.
		env: {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
			// Strip any ambient gate flag first; callers re-add when needed.
			GROUNDWORK_TBD_GATE: "",
			...(opts.env ?? {}),
		},
	});
	return JSON.parse(out);
}

// ---------------------------------------------------------------------------
// Shared ledgers
// ---------------------------------------------------------------------------

const incompleteLedger = {
	active: true,
	session_id: "sess-tbd",
	reinforcements: 0,
	slices: [{ id: "S1", status: "pending" }],
	gate: { advisor: "pending" },
};

const completeLedger = {
	active: true,
	session_id: "sess-tbd",
	reinforcements: 0,
	slices: [{ id: "S1", status: "complete" }],
	gate: { advisor: "APPROVE" },
};

// ---------------------------------------------------------------------------
// S7-AC1: Default OFF — no TBD output, byte-identical behavior
// ---------------------------------------------------------------------------

describe("S7-AC1: TBD gate default OFF — zero extra output", () => {
	it("blocking run without GROUNDWORK_TBD_GATE produces no 'Open items:' text", () => {
		writeCharter("my-motive", 3);
		const decision = runHook(incompleteLedger);
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toContain("Open items:");
		expect(decision.reason).not.toContain("TBD/TBR");
	});

	it("allowing run without GROUNDWORK_TBD_GATE has no TBD output (byte-identical)", () => {
		writeCharter("my-motive", 3);
		const decision = runHook(completeLedger);
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
		// Byte-identical: no reason field when gate is off.
		expect(decision.reason).toBeUndefined();
	});

	it("GROUNDWORK_TBD_GATE=0 is also treated as off", () => {
		writeCharter("my-motive", 5);
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "0" } });
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toContain("Open items:");
	});
});

// ---------------------------------------------------------------------------
// S7-AC2: Enabled + open items — count line appears
// ---------------------------------------------------------------------------

describe("S7-AC2: count line appears when GROUNDWORK_TBD_GATE=1 and open items exist", () => {
	it("block reason contains 'Open items: 3 TBD/TBR unresolved for motive my-motive'", () => {
		writeCharter("my-motive", 3);
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain("Open items: 3 TBD/TBR unresolved for motive my-motive");
	});

	it("reports correct count when there are 1 open item", () => {
		writeCharter("alpha", 1);
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.reason).toContain("Open items: 1 TBD/TBR unresolved for motive alpha");
	});

	it("emits one line per motive when multiple motives have open items", () => {
		writeCharter("motive-a", 2);
		writeCharter("motive-b", 4);
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.reason).toContain("Open items: 2 TBD/TBR unresolved for motive motive-a");
		expect(decision.reason).toContain("Open items: 4 TBD/TBR unresolved for motive motive-b");
	});

	it("does NOT add a line for a motive with zero open items", () => {
		writeCharter("empty-motive", 0);
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toContain("empty-motive");
	});
});

// ---------------------------------------------------------------------------
// S7-AC3: Enabled + open items — NEVER blocks on TBD alone
// ---------------------------------------------------------------------------

describe("S7-AC3: TBD gate never blocks — allow path is unaffected", () => {
	it("an otherwise-allowing run still allows even with open TBD items", () => {
		writeCharter("my-motive", 3);
		const decision = runHook(completeLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("allowing run + GROUNDWORK_TBD_GATE=1 + open TBDs → count line surfaces in reason", () => {
		writeCharter("my-motive", 3);
		const decision = runHook(completeLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.continue).toBe(true);
		expect(decision.reason).toContain("Open items: 3 TBD/TBR unresolved for motive my-motive");
	});

	it("TBD gate does not change the exit code (hook exits 0 either way)", () => {
		writeCharter("my-motive", 3);
		// Would throw on non-zero exit; just verify it doesn't throw.
		expect(() =>
			runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } }),
		).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// S7-AC4: Missing/corrupt charter → silent no-op, no crash
// ---------------------------------------------------------------------------

describe("S7-AC4: missing or corrupt charter is a silent no-op", () => {
	it("no motives dir → no TBD line, no crash", () => {
		// motives dir never created
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toContain("Open items:");
	});

	it("corrupt charter file → no TBD line, hook exits normally", () => {
		const motiveDir = path.join(projectDir, ".groundwork", "motives", "broken");
		mkdirSync(motiveDir, { recursive: true });
		writeFileSync(path.join(motiveDir, "motive.md"), "{{{{ not valid markdown {{{{");
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.decision).toBe("block");
		// No crash — hook produced a valid JSON decision.
	});

	it("empty charter file → no TBD line, no crash", () => {
		const motiveDir = path.join(projectDir, ".groundwork", "motives", "empty");
		mkdirSync(motiveDir, { recursive: true });
		writeFileSync(path.join(motiveDir, "motive.md"), "");
		const decision = runHook(incompleteLedger, { env: { GROUNDWORK_TBD_GATE: "1" } });
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toContain("Open items:");
	});
});

// ---------------------------------------------------------------------------
// S13: Stop-gate accepts motive / motive_ref as plan-artifact alternative
// ---------------------------------------------------------------------------

describe("S13: motive/motive_ref satisfies the plan pre-gate", () => {
	// A non-trivial run: >=3 impl slices, no brief triggering trivialEscape,
	// advisor APPROVE so the only blocker can be the plan pre-gate.
	const nonTrivialBase = {
		active: true,
		session_id: "sess-tbd",
		reinforcements: 0,
		gate: { advisor: "APPROVE" },
		slices: [
			{ id: "S1", kind: "impl", status: "complete" },
			{ id: "S2", kind: "impl", status: "complete" },
			{ id: "S3", kind: "impl", status: "complete" },
		],
	};

	it("motive_ref whose charter exists on disk satisfies the gate", () => {
		writeCharter("plugin-cleanup", 0);
		const ledger = { ...nonTrivialBase, motive_ref: "plugin-cleanup" };
		const decision = runHook(ledger);
		expect(decision.reason ?? "").not.toContain("motive/motive_ref charter missing");
	});

	it("motive (not motive_ref) whose charter exists on disk satisfies the gate", () => {
		writeCharter("plugin-cleanup", 0);
		const ledger = { ...nonTrivialBase, motive: "plugin-cleanup" };
		const decision = runHook(ledger);
		expect(decision.reason ?? "").not.toContain("motive/motive_ref charter missing");
	});

	it("plan_ref pointing to existing file still satisfies the gate (backward compat)", () => {
		const planPath = path.join(projectDir, "my-plan.md");
		writeFileSync(planPath, "# plan");
		const ledger = { ...nonTrivialBase, plan_ref: planPath };
		const decision = runHook(ledger);
		expect(decision.reason ?? "").not.toContain("motive/motive_ref charter missing");
	});

	it("neither plan_ref nor motive/motive_ref nor plan-slice -> block naming both remedies", () => {
		const ledger = { ...nonTrivialBase, gate: { advisor: "pending" } };
		const decision = runHook(ledger);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain("plan_ref");
		expect(decision.reason).toContain("motive/motive_ref");
	});

	it("motive_ref with no charter file on disk is treated as unresolved", () => {
		const ledger = { ...nonTrivialBase, motive_ref: "nonexistent-slug", gate: { advisor: "pending" } };
		const decision = runHook(ledger);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain("motive/motive_ref charter missing");
	});

	it("motive_ref takes precedence over motive; charter for motive_ref exists -> passes", () => {
		writeCharter("real-motive", 0);
		const ledger = { ...nonTrivialBase, motive_ref: "real-motive", motive: "nonexistent" };
		const decision = runHook(ledger);
		expect(decision.reason ?? "").not.toContain("motive/motive_ref charter missing");
	});
});
