import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "agent-model-guard.mjs");

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
	const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
	return out.trim() ? JSON.parse(out) : {};
}

/** Convenience: a PreToolUse payload for an Agent call. */
function agentCall(toolInput: Record<string, unknown>, toolName = "Agent") {
	return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput };
}

describe("agent-model-guard — injects the registry model when omitted", () => {
	it("injects haiku for groundwork:git-master", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:git-master", prompt: "commit" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("haiku");
		// Original fields are preserved (updatedInput replaces the whole object).
		expect(d.hookSpecificOutput?.updatedInput?.subagent_type).toBe("groundwork:git-master");
		expect(d.hookSpecificOutput?.updatedInput?.prompt).toBe("commit");
	});

	it("injects claude-sonnet-4-6 for groundwork:general-purpose", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("claude-sonnet-4-6");
	});

	it("injects opus for groundwork:advisor (opus by design)", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:advisor", prompt: "gate" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("opus");
	});

	it("resolves a built-in capitalized type (Explore → sonnet)", () => {
		const d = runHook(agentCall({ subagent_type: "Explore", prompt: "look" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
	});

	it("injects the cheap DEFAULT when subagent_type is absent", () => {
		const d = runHook(agentCall({ prompt: "do a thing" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("default");
	});

	it("injects the cheap DEFAULT for an unknown subagent_type (catch-all 'claude')", () => {
		const d = runHook(agentCall({ subagent_type: "claude", prompt: "anything" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
	});

	it("also guards the Task tool name", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:qa", prompt: "verify" }, "Task"));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("claude-sonnet-4-6");
	});
});

describe("agent-model-guard — never overrides / never over-reaches", () => {
	it("passes through (no output) when model is already explicit", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", model: "opus", prompt: "x" }));
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("passes through for a non-Agent/Task tool (Bash)", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "{ not json :::", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});

	it("fails open (no output) on empty stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});

	it("does not treat an empty-string model as explicit (injects instead)", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:git-master", model: "   ", prompt: "x" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("haiku");
	});
});
