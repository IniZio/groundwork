import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/** Read the persisted reinforcements counter from the ledger after a run. */
function readReinforcements(): number {
	const raw = JSON.parse(readFileSync(path.join(projectDir, ".groundwork", "run.json"), "utf8"));
	return raw.reinforcements ?? 0;
}

const completeSlice = { id: "S1", status: "complete", acceptance: ["does the thing"] };

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

	it("blocks the stop when gate.advisor is an OBJECT with verdict REVISE (even if slices complete)", () => {
		const decision = runHook({
			active: true,
			session_id: "sess-1",
			reinforcements: 0,
			slices: [completeSlice],
			gate: { advisor: { verdict: "REVISE", citation: "contact.ts:42" } },
		});
		expect(decision.decision).toBe("block");
		// The block reason renders the normalized verdict, never "[object Object]".
		expect(decision.reason).toContain("REVISE");
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
});

describe("stop-gate hook — consecutive-no-progress counter (Fix A)", () => {
	it("fails open once the cap of no-progress blocks is reached (same signature)", () => {
		// reinforcements already at the cap AND progressSig matches current state → release.
		const ledger = {
			active: true,
			session_id: "sess-1",
			reinforcements: 12,
			progressSig: JSON.stringify({ sliceState: "S1:pending", verifier: null, critic: null, advisor: null }),
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
			progressSig: JSON.stringify({ sliceState: "S1:pending,S2:pending", verifier: null, critic: null, advisor: null }),
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
