import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "orchestrator-impl-guard.mjs");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Make a project dir; if `ledger` is given, write `.groundwork/run.json`. */
function makeProject(ledger?: Record<string, unknown>): string {
	const dir = mkdtempSync(path.join(tmpdir(), "gw-impl-guard-"));
	tmpRoots.push(dir);
	if (ledger) {
		mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
		writeFileSync(path.join(dir, ".groundwork", "run.json"), JSON.stringify(ledger));
	}
	return dir;
}

function runHook(payload: Record<string, unknown>): Decision {
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify({ hook_event_name: "PreToolUse", ...payload }),
		encoding: "utf8",
	});
	return out.trim() ? JSON.parse(out) : {};
}

const ACTIVE = { active: true, session_id: "sess-1", slices: [] };

describe("orchestrator-impl-guard — blocks direct implementation always (no ledger precondition)", () => {
	it("DENIES orchestrator Edit of a source file while a run is active", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("general-purpose");
	});

	it("DENIES orchestrator Write and MultiEdit too", () => {
		const cwd = makeProject(ACTIVE);
		expect(runHook({ tool_name: "Write", tool_input: { file_path: `${cwd}/src/b.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(runHook({ tool_name: "MultiEdit", tool_input: { file_path: `${cwd}/src/c.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES OpenCode fast_edit (same canonical form as Edit after normalization)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("general-purpose");
	});

	it("DENIES OpenCode fast_write", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_write", tool_input: { file_path: `${cwd}/src/b.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES OpenCode fast_multiedit", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_multiedit", tool_input: { file_path: `${cwd}/src/c.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES even when there is NO ledger (trivial task / no run — removed escape valve)", () => {
		const cwd = makeProject();
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES when the ledger is inactive (active:false — not a loophole)", () => {
		const cwd = makeProject({ active: false, session_id: "sess-1", slices: [] });
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("DENIES when the active ledger is owned by a DIFFERENT session (session ownership is irrelevant now)", () => {
		const cwd = makeProject({ active: true, session_id: "other-sess", slices: [] });
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("orchestrator-impl-guard — never over-reaches", () => {
	it("PASSES a subagent Edit (agent_type present) even during an active run", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1", agent_type: "general-purpose", agent_id: "a123" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES a subagent fast_edit (subagents may use any tool variant)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1", agent_type: "general-purpose", agent_id: "a124" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES a subagent fast_write (subagents may use any tool variant)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_write", tool_input: { file_path: `${cwd}/src/b.ts` }, cwd, session_id: "sess-1", agent_type: "general-purpose", agent_id: "a125" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES a subagent Edit identified by agent-*.jsonl transcript (FleetView)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1", transcript_path: "/x/projects/p/agent-deadbeef.jsonl" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES the one-shot init Write of the ledger itself", () => {
		const cwd = makeProject(ACTIVE);
		expect(runHook({ tool_name: "Write", tool_input: { file_path: `${cwd}/.groundwork/run.json` }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
	});

	it("PASSES Bash (not in the guarded set — ledger CLI must stay runnable)", () => {
		const cwd = makeProject(ACTIVE);
		expect(runHook({ tool_name: "Bash", tool_input: { command: "echo hi" }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
	});

	it("PASSES Read (not in the guarded set)", () => {
		const cwd = makeProject(ACTIVE);
		expect(runHook({ tool_name: "Read", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "{ not json", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Narrow-path permit — memory files and handoff documents
// ---------------------------------------------------------------------------

/** Build a PreToolUse Write payload for a given path (no subagent signals). */
function orchestratorWrite(filePath: string, toolName = "Write"): Record<string, unknown> {
	return {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { file_path: filePath, content: "x" },
		// No agent_type / agent_id / transcript_path → orchestrator identity
	};
}

describe("orchestrator-impl-guard — memory file permit", () => {
	const memDir = path.join(homedir(), ".claude", "projects", "abc123hash", "memory");

	it("orchestrator Write to a memory file → ALLOWED", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "groundwork-notes.md")));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("orchestrator Write to MEMORY.md index in memory dir → ALLOWED", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "MEMORY.md")));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("orchestrator fast_write to memory file → ALLOWED (normalization)", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "cozempic_digest.md"), "fast_write"));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("memory path missing 'memory' segment → BLOCKED (only ~/.claude/projects/<hash>/memory/ qualifies)", () => {
		// ~/.claude/projects/<hash>/evil.ts — not inside a memory/ subdir
		const p = path.join(homedir(), ".claude", "projects", "abc123hash", "evil.ts");
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("memory .. traversal escaping memory dir → BLOCKED", () => {
		// Build with string concatenation so the literal ".." survives into the hook predicate.
		// path.join would collapse it at construction time and the traversal would never be exercised.
		// ~/.claude/projects/abc123/memory/../../evil.ts resolves to ~/.claude/projects/evil.ts
		// which is not at depth ≥3 under memory/, so it is correctly blocked.
		const p = homedir() + "/.claude/projects/abc123/memory/../../evil.ts";
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("spoof: src/.claude/projects/x/memory/evil.ts → BLOCKED", () => {
		// Decision: NOT permitted. The memory permit is anchored to homedir()
		// (~/.claude/projects/). A .claude/projects/ segment buried inside a
		// source directory resolves to a path that does NOT start with the
		// homedir() + "/.claude/projects" prefix, so it is correctly rejected.
		// Allowing it would let an attacker-controlled filename bypass the guard.
		const p = path.join(
			"/home/newman/.local/share/groundwork",
			"src",
			".claude",
			"projects",
			"x",
			"memory",
			"evil.ts",
		);
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("orchestrator-impl-guard — handoff document permit", () => {
	const gwDir = "/home/newman/.local/share/groundwork/.groundwork";

	it("orchestrator Write to .groundwork/handoff-YYYY-MM-DD-desc.md → ALLOWED", () => {
		const d = runHook(orchestratorWrite(path.join(gwDir, "handoff-2026-07-26-memory-permit.md")));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("orchestrator Write to nested-project .groundwork/handoff-*.md → ALLOWED", () => {
		const d = runHook(orchestratorWrite("/tmp/some-project/.groundwork/handoff-2026-07-26-session.md"));
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("non-.md file with handoff- prefix → BLOCKED (must end in .md)", () => {
		const d = runHook(orchestratorWrite(path.join(gwDir, "handoff-2026-07-26.ts")));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("handoff file outside .groundwork/ → BLOCKED (must be inside a .groundwork dir)", () => {
		const d = runHook(orchestratorWrite("/home/newman/handoff-2026-07-26.md"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it(".groundwork/out-of-scope/foo.md → BLOCKED (deliberate exclusion from permit)", () => {
		// out-of-scope/ is under .groundwork/ but is NOT a handoff-*.md file.
		// The exclusion is deliberate: out-of-scope writes carry KB content that
		// must go through delegation to ensure correctness.
		const d = runHook(orchestratorWrite(path.join(gwDir, "out-of-scope", "dark-mode.md")));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("handoff .. traversal escaping .groundwork → BLOCKED", () => {
		// Build with string concatenation so the literal ".." survives into the hook predicate.
		// path.join would collapse it at construction time and the traversal would never be exercised.
		// ".groundwork/handoff-x.md/../../src/index.ts" resolves basename to
		// "index.ts", which does not match handoff-*.md → BLOCKED
		const p = gwDir + "/handoff-x.md/../../src/index.ts";
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("orchestrator-impl-guard — narrow-permit blocked regressions", () => {
	it("orchestrator Write to src/index.ts → BLOCKED (core regression)", () => {
		const d = runHook(orchestratorWrite("/home/newman/.local/share/groundwork/src/index.ts"));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("missing file_path → BLOCKED (malformed path is fail-safe)", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { content: "x" } });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("null file_path → BLOCKED", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: null } });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("empty string file_path → BLOCKED", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "" } });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});
});

describe("orchestrator-impl-guard — subagent passthrough regressions (line 112)", () => {
	it("subagent Write to src/index.ts → ALLOWED (line 112 passthrough intact)", () => {
		const d = runHook({
			...orchestratorWrite("/home/newman/.local/share/groundwork/src/index.ts"),
			agent_type: "general-purpose",
			agent_id: "abc123",
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("fork-shaped input (agent-*.jsonl transcript, no agent_type) → ALLOWED", () => {
		// Retrospective forks have an agent-*.jsonl transcript_path but no agent_type.
		// They must remain permitted so the retrospective skill continues to work.
		const d = runHook({
			...orchestratorWrite("/home/newman/.local/share/groundwork/src/index.ts"),
			transcript_path: "/sessions/agent-retro-fork.jsonl",
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});
