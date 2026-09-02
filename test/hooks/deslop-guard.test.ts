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
	it("does NOT trigger on a JSDoc block (/** … */) EXCEPT for block-comment body slop", () => {
		const jsdoc =
			"/**\n" +
			" * Adds two numbers. Let's note this is a JSDoc, not a slop comment.\n" +
			" * Now we just return the sum.\n" +
			" * @param a first number\n" +
			" * @param b second number\n" +
			" */\n" +
			"export function add(a: number, b: number) {\n  return a + b;\n}\n";
		const out = runWrite(jsdoc);
		// The `* Now we just return the sum.` line matches the SLOP_BLOCK pattern
		// (AI-fingerprint opener in block comment). The `* Adds two numbers. Let's…`
		// line does NOT fire because the slop phrase is not at the start after `* `.
		// @param lines remain exempt via ALLOW_BLOCK_BODY. The write still proceeds
		// (advisory only).
		expect(out.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/block comment/i);
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

describe("deslop-guard — multi-word restating comments", () => {
	it("WARNS on '// fetch the user' above function fetchUser", () => {
		const d = runWrite("// fetch the user\nfunction fetchUser() { return null; }\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("multi-word restating");
	});

	it("WARNS on '// get user by id' above const getUserById", () => {
		const d = runWrite("// get user by id\nconst getUserById = () => null;\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("multi-word restating");
	});

	it("does NOT warn on '// fetch the user with roles' (extra word not in identifier)", () => {
		const d = runWrite("// fetch the user with roles\nfunction fetchUser() { return null; }\n");
		// 'roles' is not in fetchUser tokens — should not fire
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("multi-word restating");
	});

	it("does NOT warn on a comment that adds real context", () => {
		const d = runWrite("// fetch the user from the remote database\nfunction fetchUser() { return null; }\n");
		// 'remote', 'database' are absent from identifier tokens
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("multi-word restating");
	});
});

describe("deslop-guard — prose-paraphrase comments", () => {
	it("WARNS on '// return the result' above 'return result'", () => {
		const d = runWrite("// return the result\nreturn result;\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("prose-paraphrase");
	});

	it("WARNS on '// resolve the promise' above 'resolve(promise)'", () => {
		// Both 'resolve' and 'promise' appear as whole words in the code line.
		const d = runWrite("// resolve the promise\nresolve(promise);\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("prose-paraphrase");
	});

	it("WARNS on '// call the handler' above 'handler.call(this)'", () => {
		// 'call' and 'handler' appear as whole words (\b match) in the code line.
		const d = runWrite("// call the handler\nhandler.call(this);\n");
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("prose-paraphrase");
	});

	it("does NOT warn when the comment adds real context not present in the code line", () => {
		const d = runWrite("// throw if the user session has expired\nif (!user.isAuthenticated) { throw new Error(); }\n");
		// 'session', 'expired' absent from code line → no match
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("prose-paraphrase");
	});

	it("does NOT warn on a prose-paraphrase above a declaration (handled by restating detectors)", () => {
		const d = runWrite("// fetch the user\nfunction fetchUser() { return null; }\n");
		// Should fire as multi-word restating, NOT as prose-paraphrase
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("prose-paraphrase");
	});

	it("does NOT warn on '// cat and dog' above 'concatenate(dogmatic)' (raw-substring false positive)", () => {
		// 'cat' is a substring of 'concatenate' and 'dog' of 'dogmatic', but neither
		// is a word-boundary match or a splitIdentifier token of those identifiers.
		const d = runWrite("// cat and dog\nconcatenate(dogmatic);\n");
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("prose-paraphrase");
	});

	it("does NOT warn on '// log level' above 'dialogLevelizer()' (raw-substring false positive)", () => {
		// 'log' ⊂ 'dialog', 'level' ⊂ 'levelizer' as substrings — but not as tokens.
		const d = runWrite("// log level\ndialogLevelizer();\n");
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("prose-paraphrase");
	});

	it("does NOT warn on '// map keys' above 'remapKeystrokes()' (raw-substring false positive)", () => {
		// 'map' ⊂ 'remap', 'keys' ⊂ 'keystrokes' as substrings — but 'map' and 'keys'
		// are not splitIdentifier tokens of 'remap' or 'keystrokes'.
		const d = runWrite("// map keys\nremapKeystrokes();\n");
		expect(d.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain("prose-paraphrase");
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

describe("deslop-guard — block-comment body scan (new)", () => {
	it("WARNS on ' * Let\\'s do this.' in a block comment", () => {
		const content = "/*\n * Let's do this.\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/block comment/i);
	});

	it("WARNS on ' * Now we process the data.'", () => {
		const content = "/*\n * Now we process the data.\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/block comment/i);
	});

	it("WARNS on ' * Step 1: initialize.'", () => {
		const content = "/*\n * Step 1: initialize.\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/block comment/i);
	});

	it("WARNS on ' * Simply return the value.'", () => {
		const content = "/*\n * Simply return the value.\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toMatch(/block comment/i);
	});

	it("WARNS on emoji in a block comment body (' * 🚀 ship it')", () => {
		const content = "/*\n * 🚀 ship it\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput?.permissionDecision).toBe("allow");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("emoji");
	});

	it("does NOT fire on the block opener /** (structural line exempt)", () => {
		// /** matches ALLOW_BLOCK_BODY — no SLOP_BLOCK scan runs on it
		const d = runWrite("/**\n */\nexport const x = 1;\n");
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("does NOT fire on the block closer */ (structural line exempt)", () => {
		// */ matches ALLOW_BLOCK_BODY — no SLOP_BLOCK scan runs on it
		const content = "/*\n * neutral body line\n */\nexport const x = 1;\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("does NOT fire on ' * @param foo bar' (@-annotation exempt)", () => {
		// @-annotation lines match ALLOW_BLOCK_BODY — skipped from block-comment body scan
		const content = "/**\n * @param foo bar description\n */\nexport function f(foo: string) { return foo; }\n";
		const d = runWrite(content);
		expect(d.hookSpecificOutput).toBeUndefined();
	});

	it("// deslop:disable anywhere in content suppresses block-comment body slop too", () => {
		const content =
			"// deslop:disable\n" +
			"/*\n * Now we process the data.\n */\nexport const x = 1;\n";
		const out = runWrite(content);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("env var GROUNDWORK_DESLOP_GUARD=0 suppresses block-comment body slop too", () => {
		const payload = {
			hook_event_name: "PreToolUse",
			tool_name: "Write",
			tool_input: {
				file_path: "/p/src/x.ts",
				content: "/*\n * Now we process the data.\n */\nexport const x = 1;\n",
			},
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
