/**
 * Tests for the bare-name prefix warning in agent-model-guard.mjs.
 *
 * Bare (unprefixed) groundwork agent names (other than the BANNED_BUILTINS —
 * explore, general-purpose — which are denied outright) emit a prefix warning
 * and allow. The warning tells the caller to use the "groundwork:" prefixed
 * form for correct role-prompt and model-registry routing.
 *
 * Four groups:
 *   (a) bare groundwork name → prefix warning (permissionDecision "allow" + reason)
 *   (b) correctly-prefixed name → no prefix warning (just model injection)
 *   (c) unknown/unrelated subagent_type → no prefix warning (just model injection)
 *   (d) malformed input → fails open (no output)
 *
 * Plus:
 *   (g) another plugin's namespaced name → no prefix warning (just model injection)
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GW_HOOK = path.resolve(import.meta.dirname, "..", "..", "bin", "gw-hook");

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
	const out = execFileSync(GW_HOOK, ["hook", "agent-model-guard"], {
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

// ---------------------------------------------------------------------------
// (a) Bare groundwork name → warn-and-allow
// ---------------------------------------------------------------------------
describe("prefix-guard — unprefixed groundwork agent name emits prefix warning", () => {
	it("(a1) bare 'advisor' produces an allow with a prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "advisor", prompt: "review this" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prefix-guard");
		expect(reason).toContain("groundwork:advisor");
	});

	it("(a2) bare 'Planner' produces a warning (case-insensitive: 'Planner')", () => {
		const d = runHook(agentCall({ subagent_type: "Planner", prompt: "plan" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prefix-guard");
		expect(reason).toContain("groundwork:planner");
	});

	it("(a3) bare 'DEBUGGER' produces a warning (all-caps, case-insensitive)", () => {
		const d = runHook(agentCall({ subagent_type: "DEBUGGER", prompt: "debug" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prefix-guard");
		expect(reason).toContain("harness");
	});

	it("(a4) warning is still emitted when an explicit model is already set", () => {
		const d = runHook(agentCall({ subagent_type: "designer", model: "sonnet", prompt: "style" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prefix-guard");
	});
});

// ---------------------------------------------------------------------------
// (b) Correctly-prefixed name → no prefix warning (just model injection)
// ---------------------------------------------------------------------------
describe("prefix-guard — prefixed groundwork name produces no prefix warning", () => {
	it("(b1) 'groundwork:advisor' gets model injected, no prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:advisor", prompt: "review" }));
		// subagent_type is UNTOUCHED — already prefixed
		expect(d.hookSpecificOutput?.updatedInput?.subagent_type).toBe("groundwork:advisor");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});

	it("(b2) 'groundwork:planner' gets model injected, no prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:planner", prompt: "plan" }));
		expect(d.hookSpecificOutput?.updatedInput?.subagent_type).toBe("groundwork:planner");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});

	it("(b3) 'groundwork:git-master' gets model injected, no prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "groundwork:git-master", prompt: "commit" }));
		expect(d.hookSpecificOutput?.updatedInput?.subagent_type).toBe("groundwork:git-master");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});
});

// ---------------------------------------------------------------------------
// (c) Unknown / unrelated subagent_type → no prefix warning (just model injection)
// ---------------------------------------------------------------------------
describe("prefix-guard — unrelated subagent_type produces no prefix warning", () => {
	it("(c1) 'statusline-setup' (harness-only agent) gets default model, no prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "statusline-setup", prompt: "setup" }));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});

	it("(c2) 'claude' (harness catch-all) gets default model, no prefix warning", () => {
		const d = runHook(agentCall({ subagent_type: "claude", prompt: "do stuff" }));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});

	it("(c3) absent subagent_type gets default model, no prefix warning", () => {
		const d = runHook(agentCall({ prompt: "no subagent type here" }));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});
});

// ---------------------------------------------------------------------------
// (d) Malformed input → guard fails open
// ---------------------------------------------------------------------------
describe("prefix-guard — fails open on bad input", () => {
	it("(d1) malformed JSON produces no output (passthrough)", () => {
		const out = execFileSync(GW_HOOK, ["hook", "agent-model-guard"], {
			input: "{ not json :::bad",
			encoding: "utf8",
		});
		expect(out.trim()).toBe("");
	});

	it("(d2) empty stdin produces no output (passthrough)", () => {
		const out = execFileSync(GW_HOOK, ["hook", "agent-model-guard"], {
			input: "",
			encoding: "utf8",
		});
		expect(out.trim()).toBe("");
	});

	it("(d3) null tool_input produces no output (passthrough)", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: null });
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// (g) Another plugin's namespaced name (foo:bar) → no prefix warning, just model
// ---------------------------------------------------------------------------
describe("prefix-guard — another plugin's namespaced name is untouched", () => {
	it("(g1) 'foo:bar' (unknown namespace) gets default model but subagent_type is NOT warned", () => {
		const d = runHook(agentCall({ subagent_type: "foo:bar", prompt: "x" }));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		// subagent_type must NOT be rewritten — namespaced names skip the prefix check
		expect(d.hookSpecificOutput?.updatedInput?.subagent_type).toBe("foo:bar");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prefix-guard");
	});
});
