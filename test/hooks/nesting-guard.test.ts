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
// Junior-orchestrator tier — flagless truth table
// ---------------------------------------------------------------------------

describe("nesting-guard — junior-orchestrator tier (Rule 1: spawn gate)", () => {
	// R1: top-level orchestrator → junior-orchestrator: ALLOW
	it("R1-1. top-level orchestrator → junior-orchestrator is ALLOWED", () => {
		// No agent_type / agent_id / transcript_path → main orchestrator (callerIsSubagent=false).
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// R1: general-purpose subagent → junior-orchestrator: DENY
	it("R1-2. general-purpose subagent → junior-orchestrator is DENIED", () => {
		const caller = { agent_type: "general-purpose", agent_id: "gp001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("primary orchestrator");
	});

	// R1: junior-orchestrator subagent → junior-orchestrator: DENY
	it("R1-3. junior-orchestrator subagent → junior-orchestrator is DENIED", () => {
		const caller = { agent_type: "junior-orchestrator", agent_id: "jo001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// R1: explore subagent → junior-orchestrator: DENY
	it("R1-4. explore subagent → junior-orchestrator is DENIED", () => {
		const caller = { agent_type: "explore", agent_id: "exp001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// R1: subagent with absent agent_type (only agent_id) → junior-orchestrator: DENY
	it("R1-5. absent-agent_type subagent (agent_id only) → junior-orchestrator is DENIED", () => {
		const caller = { agent_id: "unknown001" };
		const d = runHook(agentCall({ subagent_type: "junior-orchestrator", prompt: "sub-orch" }, "Agent", caller));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("nesting-guard — junior-orchestrator tier (Rule 2: caller-type cap)", () => {
	const JUNIOR = { agent_type: "junior-orchestrator", agent_id: "jo001" };

	// R2: junior-orchestrator → general-purpose: ALLOW
	it("R2-1. junior-orchestrator subagent → general-purpose is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "general-purpose", prompt: "implement" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// R2: junior-orchestrator → explore: ALLOW
	it("R2-2. junior-orchestrator subagent → explore is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:explore", prompt: "find X" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// R2: junior-orchestrator → qa: ALLOW
	it("R2-3. junior-orchestrator subagent → qa is ALLOWED", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:qa", prompt: "verify" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	// R2: junior-orchestrator → orchestrator: DENY
	it("R2-4. junior-orchestrator subagent → orchestrator is DENIED", () => {
		const d = runHook(agentCall({ subagent_type: "orchestrator", prompt: "orchestrate" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("junior-orchestrator may delegate only to");
	});

	// R2: junior-orchestrator → debugger: DENY
	it("R2-5. junior-orchestrator subagent → debugger is DENIED", () => {
		const d = runHook(agentCall({ subagent_type: "debugger", prompt: "debug it" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// R2: junior-orchestrator → git-master (not in allow-list): DENY
	it("R2-6. junior-orchestrator subagent → git-master is DENIED (not in allow-list)", () => {
		const d = runHook(agentCall({ subagent_type: "git-master", prompt: "commit" }, "Agent", JUNIOR));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
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
