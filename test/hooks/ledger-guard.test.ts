import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

	it("DENIES subagent `ledger autopilot --token sct_<hex>`", () => {
		const d = runBashHook(`bin/ledger autopilot --token ${SCT}`, SUBAGENT);
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
