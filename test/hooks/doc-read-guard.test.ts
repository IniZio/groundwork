/**
 * test/hooks/doc-read-guard.test.ts — RFC-0001 T20 AC 2, 3, 4, 5, 6
 *
 * AC→test map:
 *   AC 2 — Read of over-budget doc-class file without toc → deny with "doc toc <path>"
 *           → tests: "denies Read*", "denial message includes doc toc"
 *   AC 3 — Bash cat/head of over-budget doc-class file → deny with "doc show <path>"
 *           → tests: "denies Bash cat*", "denies Bash head*", "denial includes doc show"
 *   AC 4 — Never deny Edit/Write/MultiEdit
 *           → tests: "passes through for Edit/Write/MultiEdit (AC 4)"
 *   AC 5 — notes/ scratch file within budget → permit unconditionally
 *           → tests: "passes through for notes/ file within budget (AC 5)"
 *   AC 6 — Fail-open: any error → permit, exit 0
 *           → tests: "fail-open: malformed stdin", "fail-open: unreadable file path"
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "doc-read-guard.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "doc-read-guard-"));
	// Create the plan dir so classifyDoc works with tmpDir as project root.
	mkdirSync(path.join(tmpDir, ".groundwork", "plans"), { recursive: true });
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

type Decision = {
	hookSpecificOutput?: {
		permissionDecision?: string;
		permissionDecisionReason?: string;
	};
};

function runHook(payload: Record<string, unknown>, extraEnv?: Record<string, string>, cwd?: string): Decision {
	const result = spawnSync("node", [HOOK], {
		input: JSON.stringify({ hook_event_name: "PreToolUse", ...payload }),
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
		cwd: cwd ?? tmpDir,
	});
	expect(result.status).toBe(0); // always exit 0 (fail-open)
	return result.stdout?.trim() ? JSON.parse(result.stdout) : {};
}

function runHookRaw(input: string, extraEnv?: Record<string, string>): { stdout: string; status: number } {
	const result = spawnSync("node", [HOOK], {
		input,
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
		cwd: tmpDir,
	});
	return { stdout: result.stdout ?? "", status: result.status ?? 0 };
}

/** plan class path (budget 3000 tokens) — under .groundwork/plans/ in the temp project root */
function prdPath(name: string): string {
	return path.join(tmpDir, ".groundwork", "plans", name);
}

/** Bytes for exactly `n` tokens: n * 3.5 */
function bytesForTokens(n: number): number {
	return Math.ceil(n * 3.5);
}

/** Large ASCII content: over prd budget (3000 tokens = 10500 bytes) */
function bigContent(bytes = 11000): string {
	return "x".repeat(bytes);
}

/** Small ASCII content: within prd budget */
function smallContent(): string {
	return "# Doc\n\n## Section\n\nShort.\n";
}

/** Unique session id per test */
function sessionId(): string {
	return `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Pass-through: unclassified / within-budget / Grep / writes
// ---------------------------------------------------------------------------

describe("doc-read-guard — pass-through cases", () => {
	it("passes through for Read of unclassified file", () => {
		const fp = path.join(tmpDir, "random.md");
		writeFileSync(fp, bigContent()); // big, but unclassified
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp } });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Read of doc-class file within budget", () => {
		const fp = prdPath(`within-budget-read-${Date.now()}.md`);
		writeFileSync(fp, smallContent());
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp } });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Grep (AC 7: registered but no action)", () => {
		const fp = prdPath(`grep-test-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({ tool_name: "Grep", tool_input: { pattern: "x", path: fp } });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Edit (AC 4: never deny writes)", () => {
		const fp = prdPath(`edit-pass-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Edit",
			tool_input: { file_path: fp, old_string: "x", new_string: "y" },
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Write (AC 4: never deny writes)", () => {
		const fp = prdPath(`write-pass-${Date.now()}.md`);
		const d = runHook({ tool_name: "Write", tool_input: { file_path: fp, content: bigContent() } });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for MultiEdit (AC 4: never deny writes)", () => {
		const fp = prdPath(`multiedit-pass-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "MultiEdit",
			tool_input: { file_path: fp, edits: [] },
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// AC 2: Read of over-budget doc-class file without toc → deny
// ---------------------------------------------------------------------------

describe("doc-read-guard — AC 2: Read of over-budget doc-class file", () => {
	it("denies Read of over-budget doc-class file when no toc has been issued", () => {
		const fp = prdPath(`big-no-toc-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const sid = sessionId();
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("denial message includes 'doc toc <path>' with the actual path (AC 2)", () => {
		const fp = prdPath(`big-toc-msg-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const sid = sessionId();
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid });
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain(`doc toc ${fp}`);
	});

	it("permits Read of over-budget doc-class file when toc has been issued (AC 2)", () => {
		const fp = prdPath(`big-with-toc-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const sid = sessionId();
		// First: run a Bash "doc toc <path>" to record the toc.
		runHook({
			tool_name: "Bash",
			tool_input: { command: `doc toc ${fp}` },
			session_id: sid,
		});
		// Now the Read should be permitted.
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("permits Read when no session_id is available (fail-open on missing session state)", () => {
		// Without session_id, we cannot track toc state → fail-open (permit).
		const fp = prdPath(`big-no-session-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp } });
		// No session_id → should NOT deny (fail-open).
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Read of file at exactly the budget (boundary: > not >=)", () => {
		// plan budget = 3000. Exactly 3000 tokens = 10500 bytes (ASCII).
		// With > comparison: 3000 > 3000 = false → permit.
		// With >= mutant: 3000 >= 3000 = true → deny (catches the mutant).
		const fp = prdPath(`at-budget-read-${Date.now()}.md`);
		writeFileSync(fp, "x".repeat(bytesForTokens(3000)));
		const sid = sessionId();
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// AC 3: Bash cat / head of over-budget doc-class file → deny
// ---------------------------------------------------------------------------

describe("doc-read-guard — AC 3: Bash cat/head of over-budget file", () => {
	it("denies Bash cat of over-budget doc-class file", () => {
		const fp = prdPath(`cat-big-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `cat ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("denies Bash head of over-budget doc-class file", () => {
		const fp = prdPath(`head-big-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `head -n 50 ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
	});

	it("denial message includes 'doc show <path>' with the actual path (AC 3)", () => {
		const fp = prdPath(`cat-show-msg-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `cat ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain(`doc show ${fp}`);
	});

	it("permits Bash cat of within-budget doc-class file", () => {
		const fp = prdPath(`cat-small-${Date.now()}.md`);
		writeFileSync(fp, smallContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `cat ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("permits Bash cat of unclassified file even if large", () => {
		const fp = path.join(tmpDir, "big-unclassified.md");
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `cat ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("permits Bash doc-toc command itself (not denied as a cat/head)", () => {
		const fp = prdPath(`toc-cmd-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `doc toc ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// AC 4: Never deny writes (double-checked even though not registered for them)
// ---------------------------------------------------------------------------

// Already covered in pass-through cases above.

// ---------------------------------------------------------------------------
// AC 5: notes/ scratch file within budget → permit unconditionally
// ---------------------------------------------------------------------------

describe("doc-read-guard — AC 5: notes/ scratch files", () => {
	it("passes through for Read of a notes/ file within budget (AC 5)", () => {
		// Create a file inside a notes/ directory; it is unclassified → within budget → permit.
		const notesDir = path.join(tmpDir, "notes");
		mkdirSync(notesDir, { recursive: true });
		const fp = path.join(notesDir, "scratch.md");
		writeFileSync(fp, smallContent());
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sessionId() });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("passes through for Bash cat of a notes/ file within budget (AC 5)", () => {
		const notesDir = path.join(tmpDir, "notes");
		mkdirSync(notesDir, { recursive: true });
		const fp = path.join(notesDir, "scratch.md");
		writeFileSync(fp, smallContent());
		const d = runHook({
			tool_name: "Bash",
			tool_input: { command: `cat ${fp}` },
			session_id: sessionId(),
		});
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});

// ---------------------------------------------------------------------------
// AC 6: Fail-open
// ---------------------------------------------------------------------------

describe("doc-read-guard — AC 6: fail-open", () => {
	it("fail-open: malformed stdin JSON — no output, exit 0", () => {
		const r = runHookRaw("not-json{{{{");
		expect(r.status).toBe(0);
		// No JSON deny output
		expect(r.stdout.trim()).toBe("");
	});

	it("fail-open: empty stdin — no output, exit 0", () => {
		const r = runHookRaw("");
		expect(r.status).toBe(0);
		expect(r.stdout.trim()).toBe("");
	});

	it("fail-open: Read of non-existent doc-class file — no deny, exit 0", () => {
		// File doesn't exist; reading it would throw → fail-open → permit.
		const fp = prdPath(`nonexistent-${Date.now()}.md`);
		// Do NOT create the file.
		const d = runHook({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sessionId() });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});

	it("fail-open: SDK-embedded agent — no output, exit 0", () => {
		const fp = prdPath(`sdk-read-${Date.now()}.md`);
		writeFileSync(fp, bigContent());
		const r = runHookRaw(
			JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: fp }, session_id: sessionId() }),
			{ CLAUDE_CODE_ENTRYPOINT: "sdk-js" },
		);
		expect(r.status).toBe(0);
		expect(r.stdout.trim()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// RFC index guard — fires on over-budget rfc.md (new rfc-index budget = 12000)
// ---------------------------------------------------------------------------

describe("doc-read-guard — rfc-index class fires on over-budget rfc.md", () => {
	it("denies Read of an rfc.md that exceeds 12000 tokens (rfc-index budget)", () => {
		// 12001 tokens → 42004 bytes. Confirms the guard fires at the new calibration.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-read-guard-test");
		const rfcPath = path.join(rfcDir, "rfc.md");
		mkdirSync(rfcDir, { recursive: true });
		writeFileSync(rfcPath, "x".repeat(42004));
		const d = runHook({ tool_name: "Read", tool_input: { file_path: rfcPath }, session_id: sessionId() });
		expect(d.hookSpecificOutput?.permissionDecision).toBe("deny");
		expect(d.hookSpecificOutput?.permissionDecisionReason).toContain("rfc-index");
	});

	it("permits Read of an rfc.md at exactly 12000 tokens (boundary, > not >=)", () => {
		// 12000 tokens = 42000 bytes — at budget, not over; must permit.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-read-guard-boundary");
		const rfcPath = path.join(rfcDir, "rfc.md");
		mkdirSync(rfcDir, { recursive: true });
		writeFileSync(rfcPath, "x".repeat(42000));
		const d = runHook({ tool_name: "Read", tool_input: { file_path: rfcPath }, session_id: sessionId() });
		expect(d.hookSpecificOutput?.permissionDecision).not.toBe("deny");
	});
});
