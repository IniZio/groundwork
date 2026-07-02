import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("orchestrator-impl-guard — blocks direct implementation during an active run", () => {
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

	it("the deny reason offers the abandon escape valve", () => {
		const cwd = makeProject(ACTIVE);
		const reason = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("abandon");
	});
});

describe("orchestrator-impl-guard — never over-reaches", () => {
	it("PASSES a subagent Edit (agent_type present) even during an active run", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1", agent_type: "general-purpose", agent_id: "a123" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES a subagent Edit identified by agent-*.jsonl transcript (FleetView)", () => {
		const cwd = makeProject(ACTIVE);
		const d = runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1", transcript_path: "/x/projects/p/agent-deadbeef.jsonl" });
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES when there is NO ledger (trivial task / no run)", () => {
		const cwd = makeProject();
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
	});

	it("PASSES when the ledger is inactive (active:false)", () => {
		const cwd = makeProject({ active: false, session_id: "sess-1", slices: [] });
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
	});

	it("PASSES when the active ledger is owned by a DIFFERENT session", () => {
		const cwd = makeProject({ active: true, session_id: "other-sess", slices: [] });
		expect(runHook({ tool_name: "Edit", tool_input: { file_path: `${cwd}/src/a.ts` }, cwd, session_id: "sess-1" }).hookSpecificOutput).toBeUndefined();
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
