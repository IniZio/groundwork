import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "orchestrator-impl-guard.mjs");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } };

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

// @verifies ENFORCEMENT-R-001
describe("orchestrator-impl-guard — warns on direct implementation (non-blocking, edit proceeds)", () => {
	it("WARNS on orchestrator Edit of a source file while a run is active (edit still proceeds)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toContain("general-purpose");
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS on orchestrator Write and MultiEdit too (edit still proceeds)", () => {
		const cwd = makeProject(ACTIVE);
		const dWrite = runHook({ tool_name: "Write", tool_input: { file_path: `${cwd}/src/b.ts` }, cwd, session_id: "sess-1" });
		expect(dWrite.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(dWrite.hookSpecificOutput?.permissionDecision).toBeUndefined();
		const dMultiEdit = runHook({ tool_name: "MultiEdit", tool_input: { file_path: `${cwd}/src/c.ts` }, cwd, session_id: "sess-1" });
		expect(dMultiEdit.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(dMultiEdit.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS on OpenCode fast_edit (same canonical form as Edit after normalization)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toContain("general-purpose");
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS on OpenCode fast_write", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_write", tool_input: { file_path: `${cwd}/src/b.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS on OpenCode fast_multiedit", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "fast_multiedit", tool_input: { file_path: `${cwd}/src/c.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS even when there is NO ledger (trivial task / no run — removed escape valve)", () => {
		const cwd = makeProject();
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS when the ledger is inactive (active:false — not a loophole)", () => {
		const cwd = makeProject({ active: false, session_id: "sess-1", slices: [] });
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("WARNS when the active ledger is owned by a DIFFERENT session (session ownership is irrelevant now)", () => {
		const cwd = makeProject({ active: true, session_id: "other-sess", slices: [] });
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
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
// Narrow-path permit — memory files only
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

	it("orchestrator Write to a memory file → ALLOWED silently (no additionalContext)", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "groundwork-notes.md")));
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("orchestrator Write to MEMORY.md index in memory dir → ALLOWED silently (no additionalContext)", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "MEMORY.md")));
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("orchestrator fast_write to memory file → ALLOWED silently (normalization, no additionalContext)", () => {
		const d = runHook(orchestratorWrite(path.join(memDir, "cozempic_digest.md"), "fast_write"));
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("memory path missing 'memory' segment → WARNS (not a sanctioned memory path, edit proceeds with warning)", () => {
		// ~/.claude/projects/<hash>/evil.ts — not inside a memory/ subdir, so no silent passthrough
		const p = path.join(homedir(), ".claude", "projects", "abc123hash", "evil.ts");
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it("memory .. traversal escaping memory dir → WARNS (resolves outside memory/, not sanctioned)", () => {
		// Build with string concatenation so the literal ".." survives into the hook predicate.
		// path.join would collapse it at construction time and the traversal would never be exercised.
		// ~/.claude/projects/abc123/memory/../../evil.ts resolves to ~/.claude/projects/evil.ts
		// which is not at depth ≥3 under memory/, so it is not silently passed through.
		const p = homedir() + "/.claude/projects/abc123/memory/../../evil.ts";
		const d = runHook(orchestratorWrite(p));
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it("spoof: src/.claude/projects/x/memory/evil.ts → WARNS (not anchored to homedir, not sanctioned)", () => {
		// The memory permit is anchored to homedir() (~/.claude/projects/).
		// A .claude/projects/ segment buried inside a source directory resolves to
		// a path that does NOT start with the homedir() + "/.claude/projects" prefix,
		// so it is not silently passed through — a delegation warning is emitted.
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
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});
});

describe("orchestrator-impl-guard — handoff document carve-out removed", () => {
	// The handoff write-guard permit was deleted when `pause` replaced `handoff`.
	// pause writes only journal events (no doc file), so no file-write carve-out
	// is needed. All paths that previously were ALLOWED must now emit a warning
	// (non-blocking) rather than being silently passed through.
	const gwDir = "/home/newman/.local/share/groundwork/.groundwork";

	it(".groundwork/handoffs/handoff-*.md → WARNS (carve-out removed, edit proceeds with delegation nudge)", () => {
		const d = runHook(orchestratorWrite(path.join(gwDir, "handoffs", "handoff-2026-07-26-session.md")));
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it("nested-project .groundwork/handoffs/handoff-*.md → WARNS", () => {
		const d = runHook(orchestratorWrite("/tmp/some-project/.groundwork/handoffs/handoff-2026-07-26-session.md"));
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it(".groundwork/out-of-scope/foo.md → WARNS", () => {
		const d = runHook(orchestratorWrite(path.join(gwDir, "out-of-scope", "dark-mode.md")));
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});
});

describe("orchestrator-impl-guard — warn-and-allow regressions", () => {
	it("orchestrator Write to src/index.ts → WARNS (core regression: additionalContext emitted, delegation nudge contains general-purpose)", () => {
		const d = runHook(orchestratorWrite("/home/newman/.local/share/groundwork/src/index.ts"));
		expect(d.hookSpecificOutput?.additionalContext).toContain("general-purpose");
		expect(d.hookSpecificOutput?.permissionDecision).toBeUndefined();
	});

	it("missing file_path → WARNS (non-sanctioned path, edit proceeds)", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { content: "x" } });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it("null file_path → WARNS", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: null } });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
	});

	it("empty string file_path → WARNS", () => {
		const d = runHook({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "" } });
		expect(d.hookSpecificOutput?.additionalContext).toBeTruthy();
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
