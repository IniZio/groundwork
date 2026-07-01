import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "deslop-guard.mjs");

type Decision = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

/**
 * Spawn the hook as a subprocess and feed it a PreToolUse payload via stdin,
 * matching the real Claude Code hook input shape (siblings use the same shape).
 */
function runHook(payload: Record<string, unknown>): Decision {
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify({ hook_event_name: "PreToolUse", ...payload }),
		encoding: "utf8",
	});
	return out.trim() ? JSON.parse(out) : {};
}

/** Shortcut: run the hook against a Write of the given content. */
function runWrite(content: string): Decision {
	return runHook({ tool_name: "Write", tool_input: { file_path: "/p/src/x.ts", content } });
}

/** Shortcut: run the hook against an Edit with the given new_string. */
function runEdit(newString: string): Decision {
	return runHook({ tool_name: "Edit", tool_input: { file_path: "/p/src/x.ts", old_string: "x", new_string: newString } });
}

describe("deslop-guard — advisory-only: always continues, surfaces findings via reason", () => {
	it("ALLOWS a clean input with NO warning (passthrough — empty output)", () => {
		const clean = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
		const out = runWrite(clean);
		// Clean passthrough = no hookSpecificOutput emitted at all.
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("ALLOWS but WARNS on an AI-fingerprint opener comment (// Let's …)", () => {
		const d = runWrite("// Let's now process the data\nexport function process(d: number[]) {\n  return d;\n}\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("comment-slop");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("Let's");
	});

	it("WARNS on a narrator Step marker (// Step 1)", () => {
		const d = runWrite("// Step 1: parse input\n// Step 2: transform\nexport function run() { return 1; }\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/step/i);
	});

	it("WARNS on AI emoji in a comment", () => {
		const d = runWrite("// 🚀 ship it\nexport const x = 1;\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("emoji");
	});

	it("WARNS on a restating comment (// foo above function foo)", () => {
		const d = runWrite("// foo\nexport function foo() { return 1; }\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("restating");
	});

	it("WARNS on a commented-out code block (3+ consecutive code-like // lines)", () => {
		const block = "// const old = 1;\n// const older = 2;\n// const oldest = 3;\nexport const x = 1;\n";
		const d = runWrite(block);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("commented-out code block");
	});

	it("works on Edit tool (new_string surface) the same as Write", () => {
		const d = runEdit("// Let's process the data\nexport function process() { return 1; }\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("comment-slop");
	});
});

describe("deslop-guard — allow-list: JSDoc / annotations / shebang never fire", () => {
	it("does NOT trigger on a JSDoc block (/** … */)", () => {
		const jsdoc =
			"/**\n" +
			" * Adds two numbers. Let's note this is a JSDoc, not a slop comment.\n" +
			" * Now we just return the sum.\n" +
			" * @param a first number\n" +
			" * @param b second number\n" +
			" */\n" +
			"export function add(a: number, b: number) {\n  return a + b;\n}\n";
		const out = runWrite(jsdoc);
		// JSDoc lines are allow-listed — no warning even though they contain
		// "Let's" and "Now we", because they live inside a docblock.
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("does NOT trigger on a @ts-ignore / @eslint-disable line annotation", () => {
		const out = runWrite("// @ts-ignore\n// @eslint-disable-next-line no-console\nconsole.log(1);\n");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("does NOT trigger on a shebang line", () => {
		const out = runWrite("#!/usr/bin/env node\n// Let's go\nexport const x = 1;\n");
		// The `// Let's go` line still triggers (not allow-listed); only the
		// shebang is skipped. So we expect a warning still — this asserts the
		// shebang itself is never the finding.
		expect(out.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(out.hookSpecificOutput?.permissionDecisionReason).not.toContain("shebang");
	});

	it("does NOT trigger on a license header in the first ~5 lines", () => {
		const license = "// Copyright 2024 Newman. Licensed under the MIT License.\nexport const x = 1;\n";
		const out = runWrite(license);
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});

describe("deslop-guard — escape hatches disable detection", () => {
	it("the // deslop:disable marker skips detection entirely (no warning)", () => {
		const disabled =
			"// deslop:disable\n" +
			"// Let's now process the data\n" +
			"// Step 1: parse\n" +
			"// 🚀 ship it\n" +
			"export function process() { return 1; }\n";
		const out = runWrite(disabled);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("env var GROUNDWORK_DESLOP_GUARD=0 skips detection entirely", () => {
		const payload = {
			hook_event_name: "PreToolUse",
			tool_name: "Write",
			tool_input: { file_path: "/p/src/x.ts", content: "// Let's go\n// 🚀\nexport const x = 1;\n" },
		};
		const out = execFileSync("node", [HOOK], {
			input: JSON.stringify(payload),
			encoding: "utf8",
			env: { ...process.env, GROUNDWORK_DESLOP_GUARD: "0" },
		});
		const d = out.trim() ? JSON.parse(out) : {};
		expect(d.hookSpecificOutput).toBeUndefined();
	});
});

describe("deslop-guard — scope and fail-open (mirror sibling guards)", () => {
	it("PASSES Bash (not in the guarded set)", () => {
		const out = runHook({ tool_name: "Bash", tool_input: { command: "echo hi" } });
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("PASSES Read (not in the guarded set)", () => {
		const out = runHook({ tool_name: "Read", tool_input: { file_path: "/p/src/x.ts" } });
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("fails open (no output) on malformed stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "{ not json", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});

	it("fails open (no output) on empty stdin", () => {
		const out = execFileSync("node", [HOOK], { input: "", encoding: "utf8" });
		expect(out.trim()).toBe("");
	});

	it("NEVER denies — even on many findings, permissionDecision is allow", () => {
		const verySloppy =
			"// Let's begin\n" +
			"// Now we parse\n" +
			"// Step 1: parse\n" +
			"// 🚀 ✨ 🎯\n" +
			"// foo\n" +
			"export function foo() { return 1; }\n";
		const d = runWrite(verySloppy);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});
