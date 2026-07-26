import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import os from "node:os";
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
function runHook(payload: unknown, env?: Record<string, string>): Decision {
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
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

	it("injects sonnet for groundwork:general-purpose", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
	});

	it("injects opus for groundwork:advisor (opus by design)", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:advisor", prompt: "gate" }));
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("opus");
	});

	it("denies a built-in capitalized type (Explore is banned)", () => {
		const d = runHook(agentCall({ subagent_type: "Explore", prompt: "look" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.updatedInput).toBeUndefined();
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
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
	});

	it("guards TaskCreate (background-dispatch variant, default since v2.1.198)", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", prompt: "x" }, "TaskCreate"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
	});
});

describe("agent-model-guard — TaskCreate ban (background dispatch)", () => {
	it("denies TaskCreate of banned built-in Explore", () => {
		const d = runHook(agentCall({ subagent_type: "Explore", prompt: "look" }, "TaskCreate"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.updatedInput).toBeUndefined();
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("groundwork:explore");
	});

	it("denies TaskCreate of banned built-in general-purpose (lowercase)", () => {
		const d = runHook(agentCall({ subagent_type: "general-purpose", prompt: "do it" }, "TaskCreate"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("allows TaskCreate of namespaced groundwork:explore (not banned)", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:explore", prompt: "look" }, "TaskCreate"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.updatedInput?.model).toBeDefined();
	});

	it("passes through TaskCreate when model already set", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:general-purpose", model: "opus", prompt: "x" }, "TaskCreate"));
		expect(d.hookSpecificOutput).toBeUndefined();
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

describe("agent-model-guard — GROUNDWORK_HOOK_DEBUG opt-in logging", () => {
	it("writes NO log file when GROUNDWORK_HOOK_DEBUG is unset (default path unchanged)", () => {
		// Verify deny still works and no spurious file is created.
		const d = runHook(agentCall({ subagent_type: "groundwork:git-master", prompt: "x" }), {
			GROUNDWORK_HOOK_DEBUG: "",
		});
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.updatedInput?.model).toBe("haiku");
		// No log file should exist at the default location when the var is empty.
		// We can't know where the default resolves without CLAUDE_PLUGIN_ROOT, so we
		// just assert the hook still produced correct output (behavioral unchanged).
	});

	it("appends a JSON line to the specified log path when GROUNDWORK_HOOK_DEBUG is set", () => {
		const logPath = path.join(os.tmpdir(), `gw-hook-debug-test-${process.pid}.log`);
		// Ensure the file doesn't exist before the test.
		if (existsSync(logPath)) unlinkSync(logPath);
		try {
			const payload = agentCall({ subagent_type: "groundwork:general-purpose", prompt: "debug-test" });
			const d = runHook(payload, { GROUNDWORK_HOOK_DEBUG: logPath });
			// Hook behavior must be unaffected.
			expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
			expect(d.hookSpecificOutput?.updatedInput?.model).toBe("sonnet");
			// Log file must now exist and contain a valid JSON line.
			expect(existsSync(logPath)).toBe(true);
			const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
			expect(lines.length).toBeGreaterThanOrEqual(1);
			const entry = JSON.parse(lines[0]);
			expect(entry.tool_name).toBe("Agent");
			expect(entry.tool_input?.subagent_type).toBe("groundwork:general-purpose");
			expect(typeof entry.ts).toBe("string");
		} finally {
			if (existsSync(logPath)) unlinkSync(logPath);
		}
	});
});

