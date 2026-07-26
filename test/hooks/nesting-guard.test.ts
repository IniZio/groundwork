import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "nesting-guard.mjs");

type Decision = {
	hookSpecificOutput?: {
		hookEventName?: string;
		permissionDecision?: string;
		permissionDecisionReason?: string;
		updatedInput?: Record<string, unknown>;
	};
};

/** Run the hook with a given PreToolUse stdin payload; parse stdout (or {} when empty). */
function runHook(payload: unknown): Decision {
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify(payload),
		encoding: "utf8",
	});
	return out.trim() ? JSON.parse(out) : {};
}

/**
 * Build a PreToolUse payload for an Agent/Task/TaskCreate call.
 * agentSignals simulates the in-band fields Claude Code adds for subagent calls.
 */
function agentCall(
	toolInput: Record<string, unknown>,
	toolName = "Agent",
	agentSignals: Record<string, unknown> = {},
) {
	return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, ...agentSignals };
}

/** Simulated subagent signals that prove depth ≥ 1. */
const SUBAGENT = { agent_type: "general-purpose", agent_id: "abc123" };

// ---------------------------------------------------------------------------
// 1–2. Subagent → DENIED agents
// ---------------------------------------------------------------------------

describe("nesting-guard — subagent dispatches DENIED agents", () => {
	it("1. subagent → general-purpose is DENIED", () => {
		const d = runHook(agentCall({ subagent_type: "general-purpose", prompt: "do work" }, "Agent", SUBAGENT));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("general-purpose");
		expect(d.hookSpecificOutput?.updatedInput).toBeUndefined();
	});

	it("2. subagent → orchestrator is DENIED", () => {
		const d = runHook(agentCall({ subagent_type: "orchestrator", prompt: "orchestrate" }, "Agent", SUBAGENT));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("orchestrator");
	});
});

// ---------------------------------------------------------------------------
// 3–4. Subagent → ALLOWED agents
// ---------------------------------------------------------------------------

describe("nesting-guard — subagent dispatches ALLOWED agents", () => {
	it("3. subagent → explore is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:explore", prompt: "find X" }, "Agent", SUBAGENT));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
		// Passes through (empty output) — no deny
		expect(d.hookSpecificOutput?.permissionDecision ?? "allow").toBe("allow");
	});

	it("4. subagent → qa is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:qa", prompt: "verify" }, "Agent", SUBAGENT));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// 5–6. Main orchestrator (no agent signals) → everything ALLOWED
// ---------------------------------------------------------------------------

describe("nesting-guard — main orchestrator dispatches are ALLOWED", () => {
	it("5. main orchestrator → general-purpose is ALLOWED", () => {
		// No agent_type / agent_id → main orchestrator context
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", prompt: "implement X" }));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("6. main orchestrator → orchestrator is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:orchestrator", prompt: "sub-orchestrate" }));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// 7. Ambiguous / undetectable caller → fail-open (ALLOWED)
// ---------------------------------------------------------------------------

describe("nesting-guard — fail-open on ambiguous caller", () => {
	it("7. no depth signals → ALLOWED (fail-open), even for a denied agent type", () => {
		// Payload has subagent_type=general-purpose but NO agent_type/agent_id/
		// transcript_path signals → hook cannot confirm depth ≥ 1 → must allow.
		const d = runHook(agentCall({ subagent_type: "general-purpose", prompt: "work" }));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "{ not json :::", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});

	it("fails open (no output) on empty stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// 8. groundwork: prefix and bare names behave identically
// ---------------------------------------------------------------------------

describe("nesting-guard — groundwork:-prefixed and bare names are equivalent", () => {
	it("8a. subagent → groundwork:general-purpose is DENIED (same as bare)", () => {
		const d = runHook(
			agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }, "Agent", SUBAGENT),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("8b. subagent → groundwork:orchestrator is DENIED (same as bare)", () => {
		const d = runHook(
			agentCall({ subagent_type: "groundwork:orchestrator", prompt: "x" }, "Agent", SUBAGENT),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("8c. bare 'general-purpose' and 'groundwork:general-purpose' both DENIED", () => {
		const bare = runHook(agentCall({ subagent_type: "general-purpose", prompt: "x" }, "Agent", SUBAGENT));
		const prefixed = runHook(
			agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }, "Agent", SUBAGENT),
		);
		expect(bare.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(prefixed.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("nesting-guard — TaskCreate (background dispatch) obeys same rules", () => {
	it("subagent TaskCreate → general-purpose is DENIED", () => {
		const d = runHook(
			agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }, "TaskCreate", SUBAGENT),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("subagent TaskCreate → advisor is ALLOWED", () => {
		const d = runHook(
			agentCall({ subagent_type: "groundwork:advisor", prompt: "gate" }, "TaskCreate", SUBAGENT),
		);
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

describe("nesting-guard — non-Agent tools pass through", () => {
	it("Bash calls are ignored", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

describe("nesting-guard — FleetView remote harness transcript_path signal", () => {
	it("subagent detected via transcript_path 'agent-xyz.jsonl' baseline", () => {
		const d = runHook(
			agentCall(
				{ subagent_type: "general-purpose", prompt: "x" },
				"Agent",
				{ transcript_path: "/sessions/agent-abc123.jsonl" },
			),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});
