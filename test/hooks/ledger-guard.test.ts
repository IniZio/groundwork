import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger-guard.mjs");
const BASH_HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger-bash-guard.mjs");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

function runHook(toolName: string, filePath: string): Decision {
	const payload = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { file_path: filePath } };
	const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
	return out.trim() ? JSON.parse(out) : {};
}

/** Run the file-access guard with optional subagent markers. */
function runHookAs(toolName: string, filePath: string, opts: { agentType?: string; transcriptPath?: string } = {}): Decision {
	const payload: Record<string, unknown> = {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { file_path: filePath },
	};
	if (opts.agentType) payload.agent_type = opts.agentType;
	if (opts.transcriptPath) payload.transcript_path = opts.transcriptPath;
	const out = execFileSync("node", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
	return out.trim() ? JSON.parse(out) : {};
}

/** Run the Bash guard with optional subagent markers. */
function runBashHook(command: string, opts: { agentType?: string; transcriptPath?: string } = {}): Decision {
	const payload: Record<string, unknown> = {
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
	};
	if (opts.agentType) payload.agent_type = opts.agentType;
	if (opts.transcriptPath) payload.transcript_path = opts.transcriptPath;
	const out = execFileSync("node", [BASH_HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
	return out.trim() ? JSON.parse(out) : {};
}

describe("ledger-guard — denies direct access to the run ledger", () => {
	it("DENIES Read of .groundwork/run.json", () => {
		const d = runHook("Read", "/home/u/proj/.groundwork/run.json");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toMatch(/\/bin\/ledger /m);
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

// ─── S4-AC1: subagent Write to ledger ────────────────────────────────────────
describe("ledger-guard — S4-AC1: subagent Write to ledger is denied", () => {
	const SUBAGENT = { agentType: "groundwork:general-purpose" };

	it("DENIES subagent Write to legacy run.json", () => {
		const d = runHookAs("Write", "/proj/.groundwork/run.json", SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent Write to per-session ledger", () => {
		const d = runHookAs("Write", "/proj/.groundwork/runs/sess-abc.json", SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("ALLOWS orchestrator Write to ledger (no agent markers)", () => {
		// No agentType/transcriptPath → orchestrator path → one-shot init stays free.
		expect(runHook("Write", "/proj/.groundwork/run.json").hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent Write to an unrelated file", () => {
		const d = runHookAs("Write", "/proj/src/index.ts", SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("subagent Write deny reason references the ledger CLI", () => {
		const reason = runHookAs("Write", "/proj/.groundwork/runs/s.json", SUBAGENT).hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toMatch(/ledger\b/);
	});
});

// ─── S4-AC2: seal key protection ─────────────────────────────────────────────
describe("ledger-guard — S4-AC2: seal key Read/Write/Edit denied for all callers", () => {
	const KEY = "/proj/.groundwork/runs/sess-abc.seal.key";
	const SUBAGENT = { agentType: "groundwork:general-purpose" };

	it("DENIES Read of seal key (orchestrator)", () => {
		expect(runHook("Read", KEY).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES Write of seal key (orchestrator)", () => {
		expect(runHook("Write", KEY).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES Edit of seal key (orchestrator)", () => {
		expect(runHook("Edit", KEY).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES MultiEdit of seal key (orchestrator)", () => {
		expect(runHook("MultiEdit", KEY).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES Read of seal key (subagent)", () => {
		expect(runHookAs("Read", KEY, SUBAGENT).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES Write of seal key (subagent)", () => {
		expect(runHookAs("Write", KEY, SUBAGENT).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("passes through a .seal.key file NOT under .groundwork/runs", () => {
		expect(runHook("Read", "/proj/dist/something.seal.key").hookSpecificOutput).toBeUndefined();
	});
});

// ─── S4-AC3: Bash guard ───────────────────────────────────────────────────────
describe("ledger-bash-guard — S4-AC3: subagent Bash mutation/exfil is denied", () => {
	const SUBAGENT = { agentType: "groundwork:general-purpose" };
	const LEDGER = "/proj/.groundwork/runs/sess.json";
	const KEY = "/proj/.groundwork/runs/sess.seal.key";

	it("DENIES subagent shell redirection into ledger", () => {
		const d = runBashHook(`echo '{}' > ${LEDGER}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent >> append into legacy run.json", () => {
		const d = runBashHook(`echo x >> /proj/.groundwork/run.json`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent sed -i on ledger", () => {
		const d = runBashHook(`sed -i 's/pending/complete/' ${LEDGER}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent cat of seal key", () => {
		const d = runBashHook(`cat ${KEY}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent head of seal key", () => {
		const d = runBashHook(`head -1 ${KEY}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger complete S1` (mutating subcommand)", () => {
		const d = runBashHook(`bin/ledger complete S1 --token abc`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger gate advisor APPROVE`", () => {
		const d = runBashHook(`bin/ledger gate advisor APPROVE --token tok`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger init` (mutating)", () => {
		const d = runBashHook(`bin/ledger init /tmp/slices.json`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("ALLOWS orchestrator `ledger complete` (no agent markers)", () => {
		// No agent markers → orchestrator → passthrough
		const d = runBashHook(`bin/ledger complete S1 --token abc`);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger status` (read-only subcommand)", () => {
		const d = runBashHook(`bin/ledger status`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger view`", () => {
		const d = runBashHook(`bin/ledger view`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger show S1`", () => {
		const d = runBashHook(`bin/ledger show S1`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent Bash on an unrelated command", () => {
		const d = runBashHook(`npm run build`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [BASH_HOOK], { input: "not json", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});
});
