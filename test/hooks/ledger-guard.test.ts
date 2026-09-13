// @verifies CHECKPOINT-R-010
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run as bashGuardRun } from "#src/gw/hook/ledger-bash-guard.js";
import type { HookResult } from "#src/gw/hook/types.js";

const GW_HOOK = path.resolve(import.meta.dirname, "..", "..", "bin", "gw-hook");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

function runHook(toolName: string, filePath: string): Decision {
	const payload = { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: { file_path: filePath } };
	const out = execFileSync(GW_HOOK, ["hook", "ledger-guard"], { input: JSON.stringify(payload), encoding: "utf8" });
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
	const out = execFileSync(GW_HOOK, ["hook", "ledger-guard"], { input: JSON.stringify(payload), encoding: "utf8" });
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
	const out = execFileSync(GW_HOOK, ["hook", "ledger-bash-guard"], { input: JSON.stringify(payload), encoding: "utf8" });
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
		const out = execFileSync(GW_HOOK, ["hook", "ledger-guard"], { input: "{ not json", encoding: "utf8" });
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
		const out = execFileSync(GW_HOOK, ["hook", "ledger-bash-guard"], { input: "not json", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});
});

// ─── S6-AC1: narrow allow — subagent ledger complete with scoped token ────────
describe("ledger-bash-guard — S6: scoped-token narrow allow for `ledger complete`", () => {
	const SUBAGENT = { agentType: "groundwork:general-purpose" };
	const SCT = "sct_f3d143ce086e4336"; // representative scoped-token shape

	// ── Allow path ───────────────────────────────────────────────────────────
	it("ALLOWS subagent `ledger complete S1 --token sct_<hex>` (bin/ledger form)", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger complete` via node invocation with scoped token", () => {
		const d = runBashHook(`node hooks/ledger.mjs complete S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger complete` via absolute-path invocation with scoped token", () => {
		const d = runBashHook(`/usr/local/bin/ledger complete S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `ledger complete` with extra whitespace and scoped token", () => {
		const d = runBashHook(`bin/ledger  complete  S1  --token  ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS orchestrator `ledger complete` without scoped token (unchanged)", () => {
		// Orchestrator has no agent markers — retains full access.
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT}`);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	// ── Deny: plain (non-scoped) token stays denied (test 30 baseline) ───────
	it("DENIES subagent `ledger complete` with plain write token (no sct_ prefix)", () => {
		const d = runBashHook(`bin/ledger complete S1 --token abc`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger complete` with no token at all", () => {
		const d = runBashHook(`bin/ledger complete S1`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Deny: other mutating subcommands stay denied even with sct_ token ───
	it("DENIES subagent `ledger gate advisor APPROVE --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger gate advisor APPROVE --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger init --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger init /tmp/s.json --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger abandon --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger abandon --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger set S1 --status complete --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger set S1 --status complete --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger rm S1 --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger rm S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Deny: scope-token issuance is orchestrator-only ──────────────────────
	it("DENIES subagent `ledger scope-token` (issuance is orchestrator-only)", () => {
		const d = runBashHook(`bin/ledger scope-token myagent --token abc`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger scope-token` even with sct_-shaped token", () => {
		const d = runBashHook(`bin/ledger scope-token myagent --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("ALLOWS orchestrator `ledger scope-token` (no agent markers)", () => {
		const d = runBashHook(`bin/ledger scope-token myagent --token abc`);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	// ── Bypass shapes — all DENIED ────────────────────────────────────────────
	it("DENIES chained: `ledger complete --token sct_x ; ledger gate advisor APPROVE`", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT}; bin/ledger gate advisor APPROVE --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES chained with &&: `ledger complete --token sct_x && ledger gate advisor APPROVE`", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT} && bin/ledger gate advisor APPROVE --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES chained with ||: `ledger complete --token sct_x || true`", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT} || true`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES piped: `ledger complete --token sct_x | cat`", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT} | cat`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES newline-separated commands", () => {
		const d = runBashHook(`bin/ledger complete S1 --token ${SCT}\nbin/ledger gate advisor APPROVE --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES command substitution $(...) in token position", () => {
		const d = runBashHook(`bin/ledger complete S1 --token $(cat /secret)`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES backtick substitution in token position", () => {
		const d = runBashHook("bin/ledger complete S1 --token `cat /secret`", SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES leading env assignment with chaining: `TOKEN=x; ledger complete --token sct_x`", () => {
		const d = runBashHook(`TOKEN=abc; bin/ledger complete S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES leading env assignment with && chaining", () => {
		const d = runBashHook(`TOKEN=abc && bin/ledger complete S1 --token ${SCT}`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Redirection bypass regression (S4-AC3 + S6 intersection) ────────────
	it("DENIES `ledger complete --token sct_<hex>` combined with > into ledger JSON", () => {
		const d = runBashHook(
			`bin/ledger complete S1 --token ${SCT} > /proj/.groundwork/runs/sess.json`,
			{ agentType: "groundwork:junior-orchestrator" },
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES `ledger complete --token sct_<hex>` combined with >> into seal.key", () => {
		const d = runBashHook(
			`bin/ledger complete S1 --token ${SCT} >> /proj/.groundwork/runs/sess.seal.key`,
			{ agentType: "groundwork:junior-orchestrator" },
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES `ledger complete --token sct_<hex>` combined with < stdin redirect", () => {
		const d = runBashHook(
			`bin/ledger complete S1 --token ${SCT} < /etc/passwd`,
			{ agentType: "groundwork:junior-orchestrator" },
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

// ─── S2: narrow allow — subagent ledger set --blocked-by (edge repair only) ──
describe("ledger-bash-guard — S2: set --blocked-by narrow allow", () => {
	const SUBAGENT = { agentType: "groundwork:planner" };

	// ── Allow path ───────────────────────────────────────────────────────────
	it("ALLOWS subagent `bin/ledger set S16 --blocked-by S14,S15`", () => {
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent via gw wrapper form `gw ledger set S16 --blocked-by S14,S15`", () => {
		// `gw ledger set` — gw is the bin/gw-hook CLI alias; the guard matches the
		// `ledger` word regardless of the preceding binary name.
		const d = runBashHook(`gw ledger set S16 --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent via node invocation `node hooks/ledger.mjs set S1 --blocked-by S2`", () => {
		const d = runBashHook(`node hooks/ledger.mjs set S1 --blocked-by S2`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS orchestrator `ledger set S1 --blocked-by S2` (no agent markers — unchanged)", () => {
		const d = runBashHook(`bin/ledger set S1 --blocked-by S2`);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	// ── Deny: --status present (terminal transition) ─────────────────────────
	it("DENIES subagent `ledger set S16 --status complete` (no --blocked-by)", () => {
		const d = runBashHook(`bin/ledger set S16 --status complete`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger set S16 --blocked-by S14 --status complete` (combination cell)", () => {
		// --blocked-by alone is allowed; adding --status makes it denied regardless.
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14 --status complete`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Deny: --token present ─────────────────────────────────────────────────
	it("DENIES subagent `ledger set S16 --blocked-by S14 --token abc`", () => {
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14 --token abc`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Deny: --blocked-by absent ────────────────────────────────────────────
	it("DENIES subagent `ledger set S16` with no --blocked-by flag (e.g. --wave only)", () => {
		const d = runBashHook(`bin/ledger set S16 --wave 2`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `ledger set S16` with no flags at all", () => {
		const d = runBashHook(`bin/ledger set S16`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── Deny: shell chaining ─────────────────────────────────────────────────
	it("DENIES `ledger set S16 --blocked-by S14 ; echo done`", () => {
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14 ; echo done`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES `ledger set S16 --blocked-by S14 && bin/ledger gate advisor APPROVE`", () => {
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14 && bin/ledger gate advisor APPROVE`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES `ledger set S16 --blocked-by S14 | tee /proj/.groundwork/runs/x.json`", () => {
		const d = runBashHook(`bin/ledger set S16 --blocked-by S14 | tee /proj/.groundwork/runs/x.json`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	// ── S5: positive allowlist — extra flags beyond --blocked-by are DENIED ───
	it("DENIES subagent `bin/ledger set S1 --blocked-by S2 --covers-ac AC1`", () => {
		const d = runBashHook(`bin/ledger set S1 --blocked-by S2 --covers-ac AC1`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `gw ledger set S1 --blocked-by S2 --covers-ac AC1` (gw form)", () => {
		const d = runBashHook(`gw ledger set S1 --blocked-by S2 --covers-ac AC1`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `bin/ledger set S1 --blocked-by S2 --wave 0`", () => {
		const d = runBashHook(`bin/ledger set S1 --blocked-by S2 --wave 0`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `bin/ledger set S1 --blocked-by S2 --desc x`", () => {
		const d = runBashHook(`bin/ledger set S1 --blocked-by S2 --desc x`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("ALLOWS subagent `bin/ledger set S1 --blocked-by S2,S3` (comma-list value, single flag)", () => {
		const d = runBashHook(`bin/ledger set S1 --blocked-by S2,S3`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	// ── S7: --motive selector alongside --blocked-by ──────────────────────────
	it("ALLOWS subagent `gw ledger set --motive m S16 --blocked-by S14,S15` (motive before id)", () => {
		const d = runBashHook(`gw ledger set --motive m S16 --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `gw ledger set S16 --motive m --blocked-by S14,S15` (motive after id)", () => {
		const d = runBashHook(`gw ledger set S16 --motive m --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `bin/ledger set --motive m S16 --blocked-by S14,S15` (bin/ledger form)", () => {
		const d = runBashHook(`bin/ledger set --motive m S16 --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `bin/gw-hook ledger set --motive m S16 --blocked-by S14,S15` (gw-hook form)", () => {
		const d = runBashHook(`bin/gw-hook ledger set --motive m S16 --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `gw ledger set S16 --motive=m --blocked-by S14,S15` (motive= form)", () => {
		const d = runBashHook(`gw ledger set S16 --motive=m --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS subagent `gw ledger set S16 --blocked-by S14,S15 --motive groundwork-hardening` (motive last)", () => {
		const d = runBashHook(`gw ledger set S16 --blocked-by S14,S15 --motive groundwork-hardening`, SUBAGENT);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("DENIES subagent `gw ledger set S16 --motive m --blocked-by S14 --wave 2` (extra flag stays denied)", () => {
		const d = runBashHook(`gw ledger set S16 --motive m --blocked-by S14 --wave 2`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `gw ledger set S16 --motive m --blocked-by S14 --covers-ac AC1` (extra flag stays denied)", () => {
		const d = runBashHook(`gw ledger set S16 --motive m --blocked-by S14 --covers-ac AC1`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `gw ledger set --motive --blocked-by S14,S15` (motive with no value)", () => {
		// --motive immediately followed by a flag → treated as no-value → denied
		const d = runBashHook(`gw ledger set S16 --motive --blocked-by S14,S15`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES subagent `gw ledger set --motive= S16 --blocked-by S14` (motive= with empty value)", () => {
		const d = runBashHook(`gw ledger set S16 --motive= --blocked-by S14`, SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

// ─── S2-AC3: deny-message / bash-guard consistency ────────────────────────────
describe("ledger-guard subagent Write deny-message / ledger-bash-guard consistency", () => {
	it("every ledger command line advertised in the subagent Write deny reason passes ledger-bash-guard", () => {
		const SUBAGENT = { agentType: "groundwork:planner" };
		const d = runHookAs("Write", "/proj/.groundwork/runs/s.json", SUBAGENT);
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";

		// Extract lines that include an absolute /ledger invocation.
		const cmdLines = reason.split('\n')
			.map(l => l.trim())
			.filter(l => /\/ledger\s+[a-z]/.test(l));

		// Sanity: the message must advertise at least one ledger command.
		expect(cmdLines.length).toBeGreaterThan(0);

		for (const line of cmdLines) {
			// Isolate the command portion (before an em-dash separator).
			const cmdPart = line.split(/\s+—\s+/)[0].trim();
			// Normalize absolute bin path → relative bin/ledger for the guard call.
			let cmd = cmdPart.replace(/^.*\/bin\/ledger/, 'bin/ledger');
			// Strip optional [...] groups.
			cmd = cmd.replace(/\[.*?\]/g, '');
			// Fill concrete example values for placeholders.
			cmd = cmd.replace(/<id>/g, 'S1');
			cmd = cmd.replace(/sct_<hex>/g, 'sct_f3d143ce086e4336');
			cmd = cmd.replace(/<id>\[,<id>…\]/g, 'S2,S3');
			cmd = cmd.replace(/<list>/g, 'S2,S3');
			cmd = cmd.replace(/…/g, '');
			cmd = cmd.replace(/\s+/g, ' ').trim();

			const result = runBashHook(cmd, SUBAGENT);
			expect(
				result.hookSpecificOutput?.permissionDecision,
				`advertised command must pass ledger-bash-guard: ${cmd}`,
			).not.toBe("deny");
		}
	});
});

function parseBashGuardDecision(result: HookResult): { permissionDecision?: string; permissionDecisionReason?: string } {
	if (!result.stdout.trim()) return {};
	const parsed: { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } = JSON.parse(result.stdout);
	return parsed.hookSpecificOutput ?? {};
}

describe("ledger-bash-guard — AC-15: checkpoint guarded, autopilot removed (source unit tests)", () => {
	const SUBAGENT_ENV = { agent_type: "groundwork:general-purpose" };

	function subagentInput(cmd: string) {
		return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: cmd }, ...SUBAGENT_ENV };
	}

	function orchInput(cmd: string) {
		return { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: cmd } };
	}

	it("DENIES subagent `ledger checkpoint` — phase verdict requires orchestrator authority", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger checkpoint --phase planning --verdict pass --token abc"), {}));
		expect(d.permissionDecision).toBe("deny");
	});

	it("deny reason names `checkpoint` and the write-token requirement", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger checkpoint --phase planning --verdict pass --token abc"), {}));
		expect(d.permissionDecisionReason).toMatch(/checkpoint/);
		expect(d.permissionDecisionReason).toMatch(/write token|orchestrator/i);
	});

	it("ALLOWS orchestrator `ledger checkpoint` — positive control, no agent markers", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(orchInput("bin/ledger checkpoint --phase planning --verdict pass --token abc"), {}));
		expect(d.permissionDecision).toBeUndefined();
	});

	it("autopilot is no longer in the guarded set — subagent invocation falls through to CLI", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger autopilot --token abc"), {}));
		expect(d.permissionDecision).toBeUndefined();
	});

	it("DENIES subagent `ledger hold` — checkpoint-phase hold requires orchestrator authority", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger hold --phase planning --token abc"), {}));
		expect(d.permissionDecision).toBe("deny");
	});

	it("deny reason names `hold` and the write-token requirement", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger hold --phase planning --token abc"), {}));
		expect(d.permissionDecisionReason).toMatch(/hold/);
		expect(d.permissionDecisionReason).toMatch(/write token|orchestrator/i);
	});

	it("POSITIVE CONTROL: orchestrator `ledger hold` passes — no agent markers", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(orchInput("bin/ledger hold --phase planning --token abc"), {}));
		expect(d.permissionDecision).toBeUndefined();
	});

	it("DENIES subagent `ledger hold clear` — positional-clear form is still mutating", async () => {
		const d = parseBashGuardDecision(await bashGuardRun(subagentInput("bin/ledger hold clear --token abc"), {}));
		expect(d.permissionDecision).toBe("deny");
	});
});

// ─── T10: binary-path coverage ───────────────────────────────────────────────

const DIST_GW = path.resolve(import.meta.dirname, "..", "..", "dist", "gw.mjs");

function findBun(): string {
	const home = process.env.HOME ?? "/root";
	const candidates = [
		process.env.GW_BUN,
		`${home}/.local/share/mise/installs/bun/latest/bin/bun`,
		`${home}/.bun/bin/bun`,
		`${home}/.local/bin/bun`,
		"/usr/local/bin/bun",
		"/opt/homebrew/bin/bun",
	].filter(Boolean) as string[];
	for (const c of candidates) {
		const r = spawnSync(c, ["--version"], { encoding: "utf8" });
		if (r.status === 0) return c;
	}
	const r = spawnSync("which", ["bun"], { encoding: "utf8", shell: true });
	if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
	throw new Error("bun not found; cannot run binary-path tests");
}

describe("ledger-bash-guard — AC-15: checkpoint guarded (BINARY PATH T10)", () => {
	const SUBAGENT = { agentType: "groundwork:general-purpose" };

	it("bin/gw-hook is executable and exits 0 on malformed input (not 126)", () => {
		const r = spawnSync(GW_HOOK, ["hook", "ledger-bash-guard"], {
			input: "{ not json }",
			encoding: "utf8",
		});
		expect(r.status).toBe(0);
		expect(r.stdout?.trim()).toBe("");
	});

	it("dist/gw.mjs has executable bit set", () => {
		const stat = fs.statSync(DIST_GW);
		expect(stat.mode & 0o111).toBeGreaterThan(0);
	});

	it("DENY: subagent `ledger checkpoint` denied via binary path — printed decision", () => {
		const d = runBashHook("bin/ledger checkpoint --phase planning --verdict APPROVE --token abc", SUBAGENT);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENY: deny reason names checkpoint and orchestrator authority — binary path", () => {
		const d = runBashHook("bin/ledger checkpoint --phase planning --verdict APPROVE --token abc", SUBAGENT);
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toMatch(/checkpoint/);
		expect(reason).toMatch(/write token|orchestrator/i);
	});

	it("POSITIVE CONTROL: orchestrator `ledger checkpoint` passes via binary path", () => {
		const d = runBashHook("bin/ledger checkpoint --phase planning --verdict APPROVE --token abc", {});
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});
});

// ─── T10: bite proof ─────────────────────────────────────────────────────────

describe("ledger-bash-guard — AC-15 binary bite proof (T10)", () => {
	const BITE_MJS = "/tmp/gw-bite-t10.mjs";
	const BITE_SHIM = "/tmp/gw-bite-t10-shim.sh";
	let bun: string;

	beforeAll(() => {
		bun = findBun();
		const src = fs.readFileSync(DIST_GW, "utf8");
		const patched = src.replace(/\|checkpoint/g, "");
		expect(patched).not.toBe(src);
		fs.writeFileSync(BITE_MJS, patched, { mode: 0o755 });
		fs.writeFileSync(BITE_SHIM, `#!/bin/sh\nexec ${bun} "${BITE_MJS}" "$@"\n`, { mode: 0o755 });
	});

	afterAll(() => {
		fs.rmSync(BITE_MJS, { force: true });
		fs.rmSync(BITE_SHIM, { force: true });
	});

	it("mutated binary does NOT deny subagent checkpoint — proves the denial test bites", () => {
		const payload = JSON.stringify({
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "bin/ledger checkpoint --phase planning --verdict APPROVE --token abc" },
			agent_type: "groundwork:general-purpose",
		});
		const r = spawnSync(BITE_SHIM, ["hook", "ledger-bash-guard"], { input: payload, encoding: "utf8" });
		const decision: Decision = r.stdout?.trim() ? JSON.parse(r.stdout) : {};
		expect(decision.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});
});

// ─── T28: hold bite proof (SOURCE perturbation — dist-independent) ───────────

/**
 * Proves the `ledger hold` denial is load-bearing: the same guard code run
 * twice, differing only by `hold` removed from MUTATING_LEDGER_CMD_RE.
 *
 * The perturbation is applied to a COPY of the guard SOURCE written outside the
 * repository — never to dist/gw.mjs and never to a tracked file. The earlier
 * form string-patched the live bundle, which made the proof depend on the
 * bundle's byte content and broke on the next routine rebuild.
 *
 * src/gw/hook/ledger-bash-guard.ts has one runtime import (node:path) plus a
 * type-only import, so a standalone copy runs unchanged under bun.
 */

describe("ledger-bash-guard — AC-15 hold bite proof (T28)", () => {
	const GUARD_SRC = path.resolve(import.meta.dirname, "..", "..", "src", "gw", "hook", "ledger-bash-guard.ts");
	const HOLD_PAYLOAD = JSON.stringify({
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command: "bin/ledger hold --phase planning --token abc" },
		agent_type: "groundwork:general-purpose",
	});

	let bun: string;
	let tmpDir: string;
	let pristineGuard: string;
	let noHoldGuard: string;
	let driver: string;

	beforeAll(() => {
		bun = findBun();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-bite-t28-"));

		const src = fs.readFileSync(GUARD_SRC, "utf8").replace(/^import type .*\n/m, "");
		const patched = src.replace(/(const MUTATING_LEDGER_CMD_RE = [^\n]*?)\|hold\b/, "$1");
		// Fails loudly if `hold` ever leaves the guarded alternation — that is a
		// guard regression, not a proof-scaffolding problem.
		expect(patched, "MUTATING_LEDGER_CMD_RE no longer lists `hold`").not.toBe(src);

		pristineGuard = path.join(tmpDir, "guard-pristine.ts");
		noHoldGuard = path.join(tmpDir, "guard-no-hold.ts");
		driver = path.join(tmpDir, "driver.ts");
		fs.writeFileSync(pristineGuard, src);
		fs.writeFileSync(noHoldGuard, patched);
		fs.writeFileSync(
			driver,
			[
				"const [modPath, payload] = process.argv.slice(2);",
				"const mod = await import(modPath);",
				"const r = await mod.run(JSON.parse(payload), {});",
				"process.stdout.write(r.stdout ?? '');",
				"",
			].join("\n"),
		);
	});

	afterAll(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function decideVia(guardPath: string): Decision["hookSpecificOutput"] {
		const r = spawnSync(bun, [driver, guardPath, HOLD_PAYLOAD], { encoding: "utf8" });
		if (r.status !== 0) throw new Error(`bite driver failed (exit ${r.status}): ${r.stderr}`);
		const decision: Decision = r.stdout?.trim() ? JSON.parse(r.stdout) : {};
		return decision.hookSpecificOutput;
	}

	it("RED — guard source with `hold` removed from the pattern does NOT deny subagent `ledger hold`", () => {
		expect(decideVia(noHoldGuard)?.permissionDecision).toBeUndefined();
	});

	it("GREEN — unmodified guard source DENIES subagent `ledger hold` (fix proven)", () => {
		const d = decideVia(pristineGuard);
		expect(d?.permissionDecision).toBe("deny");
		expect(d?.permissionDecisionReason).toMatch(/hold/);
	});
});
