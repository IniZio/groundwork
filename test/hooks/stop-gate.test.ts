import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "stop-gate.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "groundwork-stopgate-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

/** Write a ledger and run the hook against it; return the parsed stdout decision. */
function runHook(ledger: unknown, sessionId = "sess-1"): { continue?: boolean; decision?: string; reason?: string } {
	if (ledger !== undefined) {
		writeFileSync(path.join(projectDir, ".groundwork", "run.json"), JSON.stringify(ledger, null, 2));
	}
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out);
}

/** Run the hook with a transcript file whose last assistant turn is `assistantContent`. */
function runHookWithTranscript(
	ledger: unknown,
	assistantContent: unknown,
	sessionId = "sess-1",
): { continue?: boolean; decision?: string; reason?: string } {
	writeFileSync(path.join(projectDir, ".groundwork", "run.json"), JSON.stringify(ledger, null, 2));
	const transcriptPath = path.join(projectDir, "transcript.jsonl");
	const lines = [
		JSON.stringify({ type: "user", message: { role: "user", content: "go" } }),
		JSON.stringify({ type: "assistant", message: { role: "assistant", content: assistantContent } }),
	];
	writeFileSync(transcriptPath, `${lines.join("\n")}\n`);
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, transcript_path: transcriptPath });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out);
}

/** Run the hook with a `background_tasks` payload (the structured Stop-hook field). */
function runHookWithBackgroundTasks(
	ledger: unknown,
	backgroundTasks: unknown,
	sessionId = "sess-1",
): { continue?: boolean; decision?: string; reason?: string } {
	writeFileSync(path.join(projectDir, ".groundwork", "run.json"), JSON.stringify(ledger, null, 2));
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, background_tasks: backgroundTasks });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out);
}

/** Read the persisted reinforcements counter from the ledger after a run. */
function readReinforcements(): number {
	const raw = JSON.parse(readFileSync(path.join(projectDir, ".groundwork", "run.json"), "utf8"));
	return raw.reinforcements ?? 0;
}

const completeSlice = { id: "S1", status: "complete", acceptance: ["does the thing"] };

// @verifies VERIFICATION-R-001
describe("stop-gate hook — advisor verdict (object or string)", () => {
	it("allows the stop when gate.advisor is an OBJECT with verdict APPROVE and all slices complete", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [completeSlice],
			gate: {
				advisor: {
					verdict: "APPROVE",
					rubric: "groundwork-completion-v1",
					axes: { correctness: 3, completeness: 3, over_engineering: 0 },
					citation: "none",
				},
			},
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("blocks the stop when gate.advisor is an OBJECT with verdict CORRECTION (even if slices complete)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [completeSlice],
			gate: { advisor: { verdict: "CORRECTION", citation: "contact.ts:42" } },
		});
		expect(decision.decision).toBe("block");
		// The block reason renders the normalized verdict, never "[object Object]".
		expect(decision.reason).toContain("CORRECTION");
		expect(decision.reason).not.toContain("[object Object]");
	});

	it("still accepts the LEGACY string form 'APPROVE' (backward compatible)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [{ id: "S1", status: "complete" }],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
	});

	it("blocks when the verdict is APPROVE but a slice is still incomplete", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [{ id: "S1", status: "pending", acceptance: ["a", "b"] }],
			gate: { advisor: { verdict: "APPROVE" } },
		});
		expect(decision.decision).toBe("block");
		// Surfaces the acceptance-criteria count for the incomplete slice.
		expect(decision.reason).toContain("acceptance criteria");
	});

	it("fails open (allows) on a malformed ledger", () => {
		writeFileSync(path.join(projectDir, ".groundwork", "run.json"), "{ not valid json :::");
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-1" });
		const decision = JSON.parse(execFileSync("node", [HOOK], { input, encoding: "utf8" }));
		expect(decision.continue).toBe(true);
	});

	it("fails open (allows) when there is no ledger at all", () => {
		const decision = runHook(undefined);
		expect(decision.continue).toBe(true);
	});

	it("does not block a run owned by a different session", () => {
		const decision = runHook(
			{
				active: true,
				session_id: "other-session",
				reinforcements: 0,
				slices: [{ id: "S1", status: "pending" }],
				gate: { advisor: "pending" },
			},
			"sess-1",
		);
		expect(decision.continue).toBe(true);
	});
});

describe("stop-gate hook — yield-awareness (Fix B)", () => {
	const incompleteLedger = {
		active: true,
		session_id: "sess-1",
		reinforcements: 0,
		slices: [{ id: "S1", status: "pending" }],
		gate: { advisor: "pending" },
	};

	it("allows the stop (without blocking) when the last turn says 'needs input:'", () => {
		const decision = runHookWithTranscript(incompleteLedger, [{ type: "text", text: "needs input: which API key should I use?" }]);
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("does NOT burn a reinforcement when yielding for input", () => {
		runHookWithTranscript(incompleteLedger, [{ type: "text", text: "needs input: clarify scope" }]);
		expect(readReinforcements()).toBe(0);
	});

	it("allows the stop when the last turn says 'failed:'", () => {
		const decision = runHookWithTranscript(incompleteLedger, [{ type: "text", text: "failed: the target repo does not exist" }]);
		expect(decision.continue).toBe(true);
	});

	it("allows the stop when the last turn launched background delegation", () => {
		const decision = runHookWithTranscript(incompleteLedger, [
			{ type: "text", text: "Launching slices." },
			{ type: "tool_use", name: "Task", input: {} },
		]);
		expect(decision.continue).toBe(true);
	});

	it("still BLOCKS when the last turn is ordinary prose (genuine stall)", () => {
		const decision = runHookWithTranscript(incompleteLedger, [{ type: "text", text: "Okay, that looks done to me." }]);
		expect(decision.decision).toBe("block");
	});

	it("allows the stop when background_tasks shows a running subagent (authoritative payload)", () => {
		const decision = runHookWithBackgroundTasks(incompleteLedger, [
			{ id: "t1", type: "subagent", status: "running", agent_type: "general-purpose" },
		]);
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("does NOT burn a reinforcement while background_tasks reports in-flight work", () => {
		runHookWithBackgroundTasks(incompleteLedger, [{ id: "t1", type: "subagent", status: "in_progress" }]);
		expect(readReinforcements()).toBe(0);
	});

	it("BLOCKS when every background_tasks entry is terminal (completed/failed)", () => {
		const decision = runHookWithBackgroundTasks(incompleteLedger, [
			{ id: "t1", type: "subagent", status: "completed" },
			{ id: "t2", type: "subagent", status: "failed" },
		]);
		expect(decision.decision).toBe("block");
	});

	it("BLOCKS when background_tasks is an empty array (nothing in flight)", () => {
		const decision = runHookWithBackgroundTasks(incompleteLedger, []);
		expect(decision.decision).toBe("block");
	});

	/**
	 * Build a transcript with `launches` background-launch results and `completions`
	 * task-notification entries, ending on an ordinary-prose assistant turn (no
	 * Task call this turn — the partial-completion re-invocation shape).
	 */
	function runHookWithBackground(
		ledger: unknown,
		launches: number,
		completions: number,
	): { continue?: boolean; decision?: string; reason?: string } {
		writeFileSync(path.join(projectDir, ".groundwork", "run.json"), JSON.stringify(ledger, null, 2));
		const transcriptPath = path.join(projectDir, "transcript.jsonl");
		const lines: string[] = [JSON.stringify({ type: "user", message: { role: "user", content: "go" } })];
		for (let i = 0; i < launches; i++) {
			lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Task", input: {} }] } }));
			lines.push(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: `<task id="..." state="running">` }] } }));
		}
		for (let i = 0; i < completions; i++) {
			lines.push(JSON.stringify({ type: "user", message: { role: "user", content: "<task-notification>S done</task-notification>" } }));
		}
		// Final turn: plain prose, no Task call (re-yielding to await the rest).
		lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "S1 complete, still waiting." }] } }));
		writeFileSync(transcriptPath, `${lines.join("\n")}\n`);
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-1", transcript_path: transcriptPath });
		return JSON.parse(execFileSync("node", [HOOK], { input, encoding: "utf8" }));
	}

	it("allows the stop when background delegations are still in flight (partial completion, no Task this turn)", () => {
		// 5 launched, 1 completed → 4 still running. This is the bug: the last turn
		// is plain prose with no Task call, yet the orchestrator is legitimately waiting.
		const decision = runHookWithBackground(incompleteLedger, 5, 1);
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("does NOT burn a reinforcement while background tasks are in flight", () => {
		runHookWithBackground(incompleteLedger, 5, 1);
		expect(readReinforcements()).toBe(0);
	});

	it("BLOCKS once all background delegations have completed and work still remains", () => {
		// 5 launched, 5 completed → none in flight; plain-prose final turn is a real stall.
		const decision = runHookWithBackground(incompleteLedger, 5, 5);
		expect(decision.decision).toBe("block");
	});
});

// @verifies ARTIFACT-R-003
describe("stop-gate hook — skipped status is terminal", () => {
	it("allows stop when all slices are skipped and gate is APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "skipped" },
				{ id: "S2", status: "skipped" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("allows stop when slices are mixed complete+skipped and gate is APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete" },
				{ id: "S2", status: "skipped" },
				{ id: "S3", status: "complete" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("blocks when one slice is pending even if others are skipped and gate is APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "skipped" },
				{ id: "S2", status: "pending" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.decision).toBe("block");
	});

	it("blocks when all slices are skipped but gate is not APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [{ id: "S1", status: "skipped" }],
			gate: { advisor: "pending" },
		});
		expect(decision.decision).toBe("block");
	});
});

describe("stop-gate hook — kind-aware gating (kind does not change terminal logic)", () => {
	it("allows stop with mixed-kind slices all complete + gate APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete", kind: "plan" },
				{ id: "S2", status: "complete", kind: "design" },
				{ id: "S3", status: "complete", kind: "impl" },
				{ id: "S4", status: "complete", kind: "diagnose" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("allows stop with mixed-kind slices all skipped or complete + gate APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete", kind: "plan" },
				{ id: "S2", status: "skipped", kind: "design" },
				{ id: "S3", status: "complete" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("blocks when one mixed-kind item is still pending even with gate APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete", kind: "plan" },
				{ id: "S2", status: "pending", kind: "design" },
				{ id: "S3", status: "complete", kind: "impl" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.decision).toBe("block");
	});
});

describe("stop-gate hook — backward compat (no kind fields anywhere)", () => {
	it("blocks a legacy no-kind ledger with incomplete slices", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete" },
				{ id: "S2", status: "pending" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.decision).toBe("block");
	});

	it("allows a legacy no-kind ledger when all slices complete and gate is APPROVE", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [
				{ id: "S1", status: "complete" },
				{ id: "S2", status: "complete" },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});

	it("blocks a legacy no-kind ledger when gate is not APPROVE even if all slices complete", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [{ id: "S1", status: "complete" }],
			gate: { advisor: "pending" },
		});
		expect(decision.decision).toBe("block");
	});
});

describe("stop-gate hook — consecutive-no-progress counter (Fix A)", () => {
	it("fails open once the cap of no-progress blocks is reached (same signature)", () => {
		// reinforcements already at the cap AND progressSig matches current state → release.
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 12,
			progressSig: JSON.stringify({ sliceState: "S1:pending", verifier: null, advisor: null }),
			slices: [{ id: "S1", status: "pending" }],
			gate: {},
		};
		const decision = runHook(ledger);
		expect(decision.continue).toBe(true);
	});

	it("RESETS the counter when the ledger advanced since the last block (progress)", () => {
		// Counter was high, but a slice has since completed → signature differs → block again, count back to 1.
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 12,
			progressSig: JSON.stringify({ sliceState: "S1:pending,S2:pending", verifier: null, advisor: null }),
			slices: [
				{ id: "S1", status: "complete" },
				{ id: "S2", status: "pending" },
			],
			gate: { advisor: "pending" },
		};
		const decision = runHook(ledger);
		expect(decision.decision).toBe("block");
		expect(readReinforcements()).toBe(1);
	});
});

describe("stop-gate hook — progressive block message verbosity", () => {
	const pendingSlice = { id: "S1", status: "pending" };

	it("block #1 (reinforcements=0, no prior sig) emits the full static ruleset", () => {
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [pendingSlice],
			gate: { advisor: "pending" },
		};
		const decision = runHook(ledger);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain("REMEMBER THE FAN-OUT RULES");
		expect(decision.reason).toContain("TO FINISH");
		expect(decision.reason).toContain("TO ABANDON");
		expect(decision.reason).not.toContain("Full rules were shown on the first block");
	});

	it("block #2 (reinforcements=1, same sig) emits only the compact one-liner", () => {
		// Simulate a second block on the same state: reinforcements=1, progressSig matches current.
		// Note: advisorVerdict("pending") returns "PENDING" (uppercased), so sig must match that.
		const sliceState = "S1:pending";
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 1,
			progressSig: JSON.stringify({ sliceState, verifier: null, advisor: "PENDING" }),
			slices: [pendingSlice],
			gate: { advisor: "pending" },
		};
		const decision = runHook(ledger);
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain("Full rules were shown on the first block");
		expect(decision.reason).toContain("ledger.mjs complete");
		expect(decision.reason).toContain("ledger.mjs abandon");
		expect(decision.reason).not.toContain("REMEMBER THE FAN-OUT RULES");
		expect(decision.reason).not.toContain("TO FINISH");
	});

	it("block #2 compact message still includes the dynamic slice status and gate info", () => {
		const sliceState = "S1:pending";
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 1,
			progressSig: JSON.stringify({ sliceState, verifier: null, advisor: "PENDING" }),
			slices: [pendingSlice],
			gate: { advisor: "pending" },
		};
		const decision = runHook(ledger);
		expect(decision.reason).toContain("Slices: 0/1 complete");
		expect(decision.reason).toContain("S1");
		expect(decision.reason).toContain("Completion gate");
	});
});

// ---------------------------------------------------------------------------
// Multi-session isolation — per-session ledger files
// ---------------------------------------------------------------------------

const pendingSliceMulti = { id: "M1", status: "pending", acceptance: ["does the thing"] };
const completeSliceMulti = { id: "M1", status: "complete", acceptance: ["does the thing"] };

/** Run the hook with a per-session ledger file at .groundwork/runs/<sessionId>.json */
function runHookWithPerSessionLedger(
	ledger: unknown,
	sessionId: string,
): { continue?: boolean; decision?: string; reason?: string } {
	const runsDir = path.join(projectDir, ".groundwork", "runs");
	mkdirSync(runsDir, { recursive: true });
	writeFileSync(path.join(runsDir, `${sessionId}.json`), JSON.stringify(ledger, null, 2));
	const input = JSON.stringify({ cwd: projectDir, session_id: sessionId });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out);
}

describe("stop-gate hook — per-session ledger isolation", () => {
	it("blocks on its own per-session ledger when slices incomplete", () => {
		const decision = runHookWithPerSessionLedger({
			active: true,
			session_id: "sess-aaa",
			reinforcements: 0,
			slices: [pendingSliceMulti],
			gate: { advisor: "pending" },
		}, "sess-aaa");
		expect(decision.decision).toBe("block");
	});

	it("allows when its per-session ledger shows all complete + APPROVE", () => {
		const decision = runHookWithPerSessionLedger({
			active: true,
			session_id: "sess-aaa",
			reinforcements: 0,
			slices: [completeSliceMulti],
			gate: { advisor: "APPROVE" },
		}, "sess-aaa");
		expect(decision.continue).toBe(true);
	});

	it("session bbb is not blocked by session aaa's incomplete run", () => {
		// Write aaa's ledger as incomplete
		const runsDir = path.join(projectDir, ".groundwork", "runs");
		mkdirSync(runsDir, { recursive: true });
		writeFileSync(
			path.join(runsDir, "sess-aaa.json"),
			JSON.stringify({
				active: true,
				session_id: "sess-aaa",
				reinforcements: 0,
				slices: [pendingSliceMulti],
				gate: { advisor: "pending" },
			}),
		);
		// Session bbb has no ledger — should allow (fail-open)
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-bbb" });
		const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
		const decision = JSON.parse(out);
		expect(decision.continue).toBe(true);
	});

	it("legacy path used when no per-session file exists and run.json matches session", () => {
		// Write legacy run.json with session_id: sess-legacy
		writeFileSync(
			path.join(projectDir, ".groundwork", "run.json"),
			JSON.stringify({
				active: true,
				session_id: "sess-legacy",
				reinforcements: 0,
				slices: [pendingSliceMulti],
				gate: { advisor: "pending" },
			}),
		);
		const input = JSON.stringify({ cwd: projectDir, session_id: "sess-legacy" });
		const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
		const decision = JSON.parse(out);
		// Should block because the legacy ledger is active and owned by this session
		expect(decision.decision).toBe("block");
	});
});

// ---------------------------------------------------------------------------
// New skillset contracts (R1/R3) — REPLAN non-terminal + plan_ref pre-gate
// ---------------------------------------------------------------------------

describe("stop-gate — new skillset contracts (R1/R3)", () => {
	it("REPLAN is non-terminal: blocks with interview/vertical-slice guidance", () => {
		// ≤2 slices, no kind:impl → trivial escape so pre-gate does not swallow REPLAN reason
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "feature work mid-flight",
			slices: [{ id: "S1", status: "pending", acceptance: ["still open"] }],
			gate: { advisor: "REPLAN" },
		});
		expect(decision.decision).toBe("block");
		expect(decision.continue).not.toBe(true);
		expect(decision.reason).toContain("REPLAN");
		expect(decision.reason).toMatch(/interview|vertical-slice/);
	});

	it("REPLAN does not release even when all slices are terminal", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "feature work mid-flight",
			slices: [
				{ id: "S1", status: "complete", acceptance: ["done"] },
				{ id: "S2", status: "complete", acceptance: ["also done"] },
			],
			gate: { advisor: "REPLAN" },
		});
		expect(decision.decision).toBe("block");
		expect(decision.continue).not.toBe(true);
		expect(decision.reason).toContain("REPLAN");
		expect(decision.reason).toMatch(/interview|vertical-slice/);
	});

	it("plan_ref pre-gate blocks a non-trivial run lacking a plan artifact", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "multi-slice feature implementation",
			slices: [
				{ id: "S1", kind: "impl", status: "pending", acceptance: ["a"] },
				{ id: "S2", kind: "impl", status: "pending", acceptance: ["b"] },
				{ id: "S3", kind: "impl", status: "pending", acceptance: ["c"] },
			],
			gate: { advisor: "pending" },
		});
		expect(decision.decision).toBe("block");
		expect(decision.reason).toMatch(/plan artifact/i);
	});

	it("plan_ref pre-gate passes when plan_ref points at a real file (falls through to incomplete-slices)", () => {
		const planDir = mkdtempSync(path.join(tmpdir(), "gw-plan-"));
		const planPath = path.join(planDir, "plan.md");
		writeFileSync(planPath, "# plan\n\nDo the feature.\n");
		try {
			const decision = runHook({
				active: true,
				session_id: "sess-1",
				reinforcements: 0,
				brief: "multi-slice feature implementation",
				plan_ref: planPath,
				slices: [
					{ id: "S1", kind: "impl", status: "pending", acceptance: ["a"] },
					{ id: "S2", kind: "impl", status: "pending", acceptance: ["b"] },
					{ id: "S3", kind: "impl", status: "pending", acceptance: ["c"] },
				],
				gate: { advisor: "pending" },
			});
			expect(decision.decision).toBe("block");
			// Pre-gate did not fire — normal incomplete-slices path
			expect(decision.reason).not.toMatch(/plan artifact/i);
			expect(decision.reason).toContain("Incomplete slices");
		} finally {
			rmSync(planDir, { recursive: true, force: true });
		}
	});

	it("plan_ref pre-gate passes when a plan slice is complete (falls through to incomplete-slices)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "multi-slice feature implementation",
			slices: [
				{ id: "P0", kind: "plan", status: "complete", acceptance: ["plan written"] },
				{ id: "S1", kind: "impl", status: "pending", acceptance: ["a"] },
				{ id: "S2", kind: "impl", status: "pending", acceptance: ["b"] },
			],
			gate: { advisor: "pending" },
		});
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toMatch(/plan artifact/i);
		expect(decision.reason).toContain("Incomplete slices");
	});

	it("trivial escape skips plan_ref pre-gate (block reason is incomplete-slices, not plan artifact)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "config tweak",
			slices: [
				{ id: "S1", status: "pending", acceptance: ["flip flag"] },
				{ id: "S2", status: "pending", acceptance: ["document"] },
			],
			gate: { advisor: "pending" },
		});
		expect(decision.decision).toBe("block");
		expect(decision.reason).not.toMatch(/plan artifact/i);
		expect(decision.reason).toContain("Incomplete slices");
	});

	it("complete+APPROVE with no plan_ref is ALLOWED (pre-gate must not fire on done runs)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			brief: "multi-slice feature implementation",
			slices: [
				{ id: "S1", kind: "impl", status: "complete", acceptance: ["a"] },
				{ id: "S2", kind: "impl", status: "complete", acceptance: ["b"] },
				{ id: "S3", kind: "impl", status: "complete", acceptance: ["c"] },
			],
			gate: { advisor: "APPROVE" },
		});
		expect(decision.continue).toBe(true);
		expect(decision.decision).toBeUndefined();
	});
});

