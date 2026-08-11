import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

// ---------------------------------------------------------------------------
// debugger — same class as general-purpose, must be denied at depth ≥ 1
// ---------------------------------------------------------------------------

describe("nesting-guard — debugger is DENIED at depth ≥ 1 (self-nesting prevention)", () => {
	it("subagent → debugger is DENIED (bare name)", () => {
		const d = runHook(agentCall({ subagent_type: "debugger", prompt: "debug it" }, "Agent", SUBAGENT));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("debugger");
	});

	it("subagent → groundwork:debugger is DENIED (prefixed name)", () => {
		const d = runHook(
			agentCall({ subagent_type: "groundwork:debugger", prompt: "debug it" }, "Agent", SUBAGENT),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("debugger");
	});

	it("subagent debugger caller → explore is ALLOWED (orientation delegation still works)", () => {
		// A debugger subagent may delegate to explore for read-only orientation.
		// Simulate: caller is a debugger subagent (agent_type=debugger), target is explore.
		const debuggerSubagent = { agent_type: "debugger", agent_id: "dbg001" };
		const d = runHook(
			agentCall({ subagent_type: "groundwork:explore", prompt: "find X" }, "Agent", debuggerSubagent),
		);
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("main orchestrator → debugger is ALLOWED (depth-0 may still dispatch debugger)", () => {
		// No agent_type / agent_id → main orchestrator context
		const d = runHook(agentCall({ subagent_type: "debugger", prompt: "debug" }));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// Depth-2 experiment — GROUNDWORK_DEPTH2_EXPERIMENT flag
// ---------------------------------------------------------------------------

describe("nesting-guard — depth-2 experiment (flag ON)", () => {
	beforeEach(() => {
		process.env.GROUNDWORK_DEPTH2_EXPERIMENT = "1";
	});
	afterEach(() => {
		delete process.env.GROUNDWORK_DEPTH2_EXPERIMENT;
	});

	// 1. general-purpose caller → junior-orchestrator : ALLOW
	it("D2-1. general-purpose caller → junior-orchestrator is ALLOWED", () => {
		const caller = { agent_type: "general-purpose", agent_id: "gp001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 2. junior-orchestrator caller → general-purpose : ALLOW
	it("D2-2. junior-orchestrator caller → general-purpose is ALLOWED", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "general-purpose", prompt: "implement" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 3. junior-orchestrator caller → junior-orchestrator : DENY
	it("D2-3. junior-orchestrator caller → junior-orchestrator is DENIED (caller-type cap)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// 4. junior-orchestrator caller → orchestrator : DENY
	it("D2-4. junior-orchestrator caller → orchestrator is DENIED (caller-type cap)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "orchestrator", prompt: "orchestrate" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// 5. junior-orchestrator caller → debugger : DENY
	it("D2-5. junior-orchestrator caller → debugger is DENIED (caller-type cap)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "debugger", prompt: "debug it" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// 6. junior-orchestrator caller → explore : ALLOW (read-only specialist)
	it("D2-6. junior-orchestrator caller → explore is ALLOWED (read-only specialist)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "groundwork:explore", prompt: "find X" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 7. absent agent_type subagent caller → junior-orchestrator : DENY (fail-closed)
	it("D2-7. absent-agent_type subagent caller → junior-orchestrator is DENIED (fail-closed)", () => {
		// agent_id present (so callerIsSubagent=true) but no agent_type → callerBare='' ≠ 'general-purpose'
		const caller = { agent_id: "unknown001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// 8. some-other-subagent (designer) caller → junior-orchestrator : DENY (fail-closed)
	it("D2-8. designer caller → junior-orchestrator is DENIED (only general-purpose may spawn junior)", () => {
		const caller = { agent_type: "designer", agent_id: "des001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// 9. junior-orchestrator caller → git-master (absent from both old deny-list and allow-list)
	it("D2-9. junior-orchestrator caller → git-master is DENIED (allow-list: git-master not in set)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "git-master", prompt: "commit" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("nesting-guard — depth-2 experiment (flag OFF — parity with pre-experiment)", () => {
	// No beforeEach — env var must be absent to prove the flag gates.

	// 9a. junior→junior with flag OFF: junior-orchestrator is not in DENIED_AT_DEPTH_1 → ALLOW
	it("D2-9a. flag OFF: junior-orchestrator caller → junior-orchestrator is NOT denied (caller-type cap inactive)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		// Depth-1 set does not include junior-orchestrator, so it passes through.
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 9b. flag OFF: general-purpose → junior-orchestrator is ALLOWED (junior not in DENIED_AT_DEPTH_1)
	it("D2-9b. flag OFF: general-purpose caller → junior-orchestrator is NOT denied (not in depth-1 set)", () => {
		const caller = { agent_type: "general-purpose", agent_id: "gp001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 9c. flag OFF: absent-agent_type → junior-orchestrator is ALLOWED (fail-open; junior not in denied set)
	it("D2-9c. flag OFF: absent-agent_type subagent → junior-orchestrator is NOT denied (fail-closed rule inactive)", () => {
		const caller = { agent_id: "unknown001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// 9d. flag OFF: junior caller → git-master is ALLOWED (caller-type cap inactive)
	it("D2-9d. flag OFF: junior-orchestrator caller → git-master is NOT denied (allow-list cap inactive)", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "git-master", prompt: "commit" }, "Agent", caller));
		// git-master is not in DENIED_AT_DEPTH_1, so depth-1 logic passes through.
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
