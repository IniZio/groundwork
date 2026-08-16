/**
 * Tests for prose-negation-guard.mjs (TOKEN-ECONOMY-R-004).
 *
 * Four groups:
 *   (a) RED  — negation word removed → guard must fire (advisory allow + reason)
 *   (b) GREEN — negation word preserved → guard must NOT fire
 *   (c) GREEN — non-Edit tool (Bash) → passthrough
 *   (d) GREEN — env var escape hatch GROUNDWORK_PROSE_NEGATION_GUARD=0 → passthrough
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "prose-negation-guard.mjs");

// Real line from agents-src/junior-orchestrator.md (line 12)
const REAL_LINE_WITH_NOT =
	"**You MUST NOT delegate your task wholesale to a single child agent.**";
// Same line with "NOT " stripped — negation removed
const REAL_LINE_NOT_STRIPPED =
	"**You MUST delegate your task wholesale to a single child agent.**";

const REAL_FILE_PATH =
	"/home/newman/.local/share/groundwork/agents-src/junior-orchestrator.md";

type Decision = {
	hookSpecificOutput?: {
		hookEventName?: string;
		permissionDecision?: string;
		permissionDecisionReason?: string;
	};
};

function runHook(payload: unknown, env?: Record<string, string>): Decision {
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify(payload),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return out.trim() ? JSON.parse(out) : {};
}

function editPayload(oldString: string, newString: string, filePath = REAL_FILE_PATH) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Edit",
		tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
	};
}

// ---------------------------------------------------------------------------
// (a) RED — negation word removed → guard fires
// ---------------------------------------------------------------------------
describe("prose-negation-guard — negation word removed (guard fires)", () => {
	it("(a1) 'NOT' removed from MUST NOT → advisory reason mentions prose-negation-guard and 'not'", () => {
		const d = runHook(editPayload(REAL_LINE_WITH_NOT, REAL_LINE_NOT_STRIPPED));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-negation-guard");
		expect(reason.toLowerCase()).toContain("not");
	});

	it("(a2) 'never' removed → advisory reason mentions 'never'", () => {
		const d = runHook(
			editPayload(
				"This hook will never block the write.",
				"This hook will block the write.",
			),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-negation-guard");
		expect(reason.toLowerCase()).toContain("never");
	});

	it("(b1-ev2) sentence 1 loses 'NOT', sentence 2 keeps 'not' → advisory fires (sentence-aligned)", () => {
		const d = runHook(
			editPayload(
				"You MUST NOT implement. You must not skip the gate.",
				"You MUST implement. You must not skip the gate.",
				REAL_FILE_PATH,
			),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-negation-guard");
		expect(reason.toLowerCase()).toContain("not");
	});
});

// ---------------------------------------------------------------------------
// (b) GREEN — negation word preserved → guard does NOT fire
// ---------------------------------------------------------------------------
describe("prose-negation-guard — negation word preserved (passthrough)", () => {
	it("(b2) old_string has no negation word → no advisory", () => {
		const d = runHook(editPayload("The hook proceeds.", "The hook fires."));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prose-negation-guard");
	});

	it("(b3) sentence survives with 'not' intact (only phrasing changes) → no advisory", () => {
		const d = runHook(
			editPayload(
				REAL_LINE_WITH_NOT,
				"**You MUST NOT forward the whole task 1:1 to a single child agent.**",
				REAL_FILE_PATH,
			),
		);
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prose-negation-guard");
	});
});

// ---------------------------------------------------------------------------
// (c) GREEN — non-Edit tool → passthrough (no output at all)
// ---------------------------------------------------------------------------
describe("prose-negation-guard — non-Edit/Write/MultiEdit tool → passthrough", () => {
	it("(c1) Bash tool → empty output (passthrough)", () => {
		const d = runHook({
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "echo hello" },
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// (e) GREEN — non-prose file type → passthrough
// ---------------------------------------------------------------------------
describe("prose-negation-guard — non-prose file type (passthrough)", () => {
	it("(e1) .ts file edit → no advisory even when 'not' is removed", () => {
		const d = runHook(
			editPayload(
				"// does not apply when cache is cold",
				"// applies when cache is cold",
				"/home/newman/.local/share/groundwork/src/lib/foo.ts",
			),
		);
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// (d) GREEN — escape hatch env var
// ---------------------------------------------------------------------------
describe("prose-negation-guard — escape hatch disables guard", () => {
	it("(d1) GROUNDWORK_PROSE_NEGATION_GUARD=0 → passthrough even when negation removed", () => {
		const d = runHook(editPayload(REAL_LINE_WITH_NOT, REAL_LINE_NOT_STRIPPED), {
			GROUNDWORK_PROSE_NEGATION_GUARD: "0",
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});
