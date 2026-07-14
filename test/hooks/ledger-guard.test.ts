import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger-guard.mjs");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

function runHook(toolName: string, filePath: string): Decision {
	const payload = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { file_path: filePath } };
	const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
	return out.trim() ? JSON.parse(out) : {};
}

describe("ledger-guard — denies direct access to the run ledger", () => {
	it("DENIES Read of .groundwork/run.json", () => {
		const d = runHook("Read", "/home/u/proj/.groundwork/run.json");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("ledger.mjs");
	});

	it("DENIES Edit of the ledger", () => {
		expect(runHook("Edit", "/home/u/proj/.groundwork/run.json").hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES MultiEdit of the ledger", () => {
		expect(runHook("MultiEdit", "/home/u/proj/.groundwork/run.json").hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES a relative ledger path too", () => {
		expect(runHook("Read", ".groundwork/run.json").hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("the deny reason names the status/complete/gate/abandon commands", () => {
		const reason = runHook("Read", "/p/.groundwork/run.json").hookSpecificOutput?.permissionDecisionReason ?? "";
		for (const cmd of ["status", "complete", "gate advisor", "abandon"]) expect(reason).toContain(cmd);
	});
});

describe("ledger-guard — denies access to per-session ledger files", () => {
	it("DENIES Read of .groundwork/runs/abc123.json", () => {
		const d = runHook("Read", "/home/u/proj/.groundwork/runs/abc123.json");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES Edit of .groundwork/runs/some-session.json", () => {
		const d = runHook("Edit", "/proj/.groundwork/runs/some-session.json");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES MultiEdit of per-session ledger", () => {
		const d = runHook("MultiEdit", "/a/.groundwork/runs/sess-xyz.json");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("ledger-guard — never over-reaches", () => {
	it("passes through Read of any other file", () => {
		expect(runHook("Read", "/home/u/proj/src/index.ts").hookSpecificOutput).toBeUndefined();
	});

	it("passes through a run.json NOT under .groundwork", () => {
		expect(runHook("Read", "/home/u/proj/config/run.json").hookSpecificOutput).toBeUndefined();
	});

	it("passes through Write of the ledger (one-shot init is allowed)", () => {
		// Write isn't in the matcher, but even if invoked the hook must not deny it.
		expect(runHook("Write", "/home/u/proj/.groundwork/run.json").hookSpecificOutput).toBeUndefined();
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "{ not json", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});
});
