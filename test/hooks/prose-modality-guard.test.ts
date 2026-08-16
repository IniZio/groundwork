/**
 * Tests for prose-modality-guard.mjs (TOKEN-ECONOMY-R-005).
 *
 * Four groups:
 *   (a) RED  — modal hedge removed + strong assertion added → guard fires
 *   (b) GREEN — hedge replaced with another hedge → passthrough
 *   (c) GREEN — strong assertion present in both old and new → passthrough
 *   (d) GREEN — hedge removed but no strong assertion added → passthrough
 *
 * Plus:
 *   (e) GREEN — escape hatch env var
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "prose-modality-guard.mjs");

// Real line from agents-src/orchestrator.md (line 89)
const REAL_LINE_WITH_MAY =
	"- `general-purpose` → may delegate to `advisor` (architecture) or `explore` (codebase investigation) only; MUST NOT spawn `general-purpose` or `junior-orchestrator`";
// Same line with "may" → "will" (hedge upgraded to strong assertion)
const REAL_LINE_MAY_TO_WILL = REAL_LINE_WITH_MAY.replace("may delegate", "will delegate");

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

function editPayload(oldString: string, newString: string) {
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Edit",
		tool_input: {
			file_path: "/home/newman/.local/share/groundwork/agents-src/orchestrator.md",
			old_string: oldString,
			new_string: newString,
		},
	};
}

// ---------------------------------------------------------------------------
// (a) RED — modal hedge removed + strong assertion added → guard fires
// ---------------------------------------------------------------------------
describe("prose-modality-guard — hedge upgraded to assertion (guard fires)", () => {
	it("(a1) real repo line: 'may delegate' → 'will delegate' → advisory fires with 'may' in reason", () => {
		const d = runHook(editPayload(REAL_LINE_WITH_MAY, REAL_LINE_MAY_TO_WILL));
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-modality-guard");
		expect(reason.toLowerCase()).toContain("may");
	});

	it("(a2) synthetic: 'this may also fire' → 'this will fire' → advisory fires", () => {
		const d = runHook(
			editPayload("This may also fire on advisory-only hooks.", "This will fire on advisory-only hooks."),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-modality-guard");
		expect(reason.toLowerCase()).toContain("may");
	});

	it("(a3) 'might' removed + 'does' added → guard fires", () => {
		const d = runHook(
			editPayload("The hook might surface a warning.", "The hook does surface a warning."),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-modality-guard");
		expect(reason.toLowerCase()).toContain("might");
	});

	it("(a4-ev1) sentence 1 loses 'may'→'will', sentence 2 keeps 'may' → advisory fires (sentence-aligned)", () => {
		const d = runHook(
			editPayload(
				"The orchestrator may delegate. A junior may spawn workers.",
				"The orchestrator will delegate. A junior may spawn workers.",
			),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-modality-guard");
		expect(reason.toLowerCase()).toContain("may");
	});

	it("(a5) 'may' removed + 'is' added in same sentence → advisory fires", () => {
		const d = runHook(
			editPayload(
				"This operation may fail under load.",
				"This operation is failing under load.",
			),
		);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).toContain("prose-modality-guard");
	});
});

// ---------------------------------------------------------------------------
// (b) GREEN — hedge replaced with another hedge → passthrough
// ---------------------------------------------------------------------------
describe("prose-modality-guard — hedge replaced with hedge (passthrough)", () => {
	it("(b1) 'may' → 'might' → no advisory (still hedged)", () => {
		const d = runHook(editPayload("this may work", "this might work"));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prose-modality-guard");
	});
});

// ---------------------------------------------------------------------------
// (c) GREEN — strong assertion in both old and new → passthrough
// ---------------------------------------------------------------------------
describe("prose-modality-guard — strong assertion in both old and new (passthrough)", () => {
	it("(c1) 'will' in both old and new → no advisory (no upgrade happened)", () => {
		const d = runHook(editPayload("This will always run first.", "This will always trigger."));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prose-modality-guard");
	});
});

// ---------------------------------------------------------------------------
// (d) GREEN — hedge removed but no strong assertion added → passthrough
// ---------------------------------------------------------------------------
describe("prose-modality-guard — hedge removed but no assertion added (passthrough)", () => {
	it("(d1) 'may' removed but no strong assertion added → no advisory", () => {
		const d = runHook(editPayload("this may work", "this works"));
		const reason = d.hookSpecificOutput?.permissionDecisionReason ?? "";
		expect(reason).not.toContain("prose-modality-guard");
	});
});

// ---------------------------------------------------------------------------
// (f) GREEN — non-prose file type → passthrough
// ---------------------------------------------------------------------------
describe("prose-modality-guard — non-prose file type (passthrough)", () => {
	it("(f1) .ts file edit → no advisory even when 'may' removed + 'will' added", () => {
		const d = runHook({
			hook_event_name: "PreToolUse",
			tool_name: "Edit",
			tool_input: {
				file_path: "/home/newman/.local/share/groundwork/src/lib/foo.ts",
				old_string: "// callers may pass null",
				new_string: "// this will be removed later",
			},
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// (e) GREEN — escape hatch env var
// ---------------------------------------------------------------------------
describe("prose-modality-guard — escape hatch disables guard", () => {
	it("(e1) GROUNDWORK_PROSE_MODALITY_GUARD=0 → passthrough even on upgrade", () => {
		const d = runHook(editPayload(REAL_LINE_WITH_MAY, REAL_LINE_MAY_TO_WILL), {
			GROUNDWORK_PROSE_MODALITY_GUARD: "0",
		});
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});
