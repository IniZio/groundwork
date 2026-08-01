/**
 * test/hooks/doc-size-guard.test.ts — RFC-0001 T20 AC 1, 6, 7
 *
 * AC→test map:
 *   AC 1 — "violation naming path, class, tokens, budget, missing element"
 *           → tests: "prints violation*" and "violation output names all fields"
 *   AC 6 — "fail-open: any error → permit, exit 0"
 *           → tests: "fail-open: missing file", "fail-open: malformed stdin"
 *   AC 7 — "registered for Write|Edit|MultiEdit"
 *           → verified by hooks.json (separate); passes through for other tools
 *           → test: "passes through for non-guarded tool (Read)"
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOC_CLASSES, classifyDoc } from "../../hooks/lib/doc-io.mjs";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "doc-size-guard.mjs");
const ROOT = path.resolve(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "doc-size-guard-"));
	// Create the plan dir so classifyDoc works with tmpDir as project root.
	mkdirSync(path.join(tmpDir, ".groundwork", "plans"), { recursive: true });
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function runHook(payload: Record<string, unknown>, extraEnv?: Record<string, string>, cwd?: string): string {
	const result = spawnSync("node", [HOOK], {
		input: JSON.stringify({ hook_event_name: "PostToolUse", ...payload }),
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
		cwd: cwd ?? tmpDir,
	});
	// Exit code is always 0 (fail-open design).
	expect(result.status).toBe(0);
	return result.stdout ?? "";
}

/**
 * Build a plan-class file path inside the temp project root so classifyDoc works.
 * Uses .groundwork/plans/ (plan class, budget 3000).
 * Files are cleaned up automatically when tmpDir is removed in afterEach.
 */
function prdPath(filename: string): string {
	return path.join(tmpDir, ".groundwork", "plans", filename);
}

/**
 * Content large enough to exceed prd budget (3000 tokens = 10500 bytes).
 * Returns a string of roughly `bytes` bytes (ASCII).
 */
function bigContent(bytes: number, includeSummary = false, includeSectionAnchor = false): string {
	const header = includeSummary ? "# Big Document\n\nSome introductory text.\n\n" : "";
	const anchor = includeSectionAnchor ? "## Section One\n\nContent here.\n\n" : "";
	const filler = "x".repeat(Math.max(0, bytes - header.length - anchor.length));
	return header + anchor + filler;
}

/** Tokens = ceil(byteLength / 3.5). Returns bytes needed for exactly `tokens` tokens. */
function bytesForTokens(tokens: number): number {
	return tokens * 3.5; // ceil(n*3.5/3.5) = n when n is integer
}

// ---------------------------------------------------------------------------
// Pass-through cases (no violation output)
// ---------------------------------------------------------------------------

describe("doc-size-guard — pass-through cases", () => {
	it("passes through for a non-.md file (unclassified)", () => {
		const fp = path.join(tmpDir, "file.ts");
		writeFileSync(fp, "x".repeat(50000));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toBe("");
	});

	it("passes through for a doc-class file within its budget", () => {
		// plan budget = 3000 tokens; use a file well under budget
		const fp = prdPath(`within-budget-${Date.now()}.md`);
		writeFileSync(fp, "# Small doc\n\n## Section\n\nShort.\n");
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toBe("");
	});

	it("passes through for a file AT exactly the budget (boundary: > not >=)", () => {
		// plan budget = 3000 tokens. Exactly 3000 tokens = exactly 10500 bytes (ASCII).
		// With > comparison: 3000 > 3000 = false → no violation.
		// With >= mutant:    3000 >= 3000 = true → violation (catches the mutant).
		const bytes = bytesForTokens(3000); // exactly 3000 tokens
		const fp = prdPath(`at-budget-${Date.now()}.md`);
		writeFileSync(fp, "x".repeat(bytes));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toBe("");
	});

	it("passes through for over-budget file with BOTH structural elements (warning-only territory)", () => {
		const fp = prdPath(`over-both-elements-${Date.now()}.md`);
		// Both summary header and section anchor present, file over budget.
		const content = bigContent(11000, true, true);
		writeFileSync(fp, content);
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toBe(""); // guard is silent; doc lint warns separately
	});

	it("passes through for a non-guarded tool name (Read)", () => {
		const fp = prdPath(`read-tool-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000));
		const out = runHook({ tool_name: "Read", tool_input: { file_path: fp } });
		expect(out).toBe("");
	});

	it("passes through when tool_input.file_path is missing", () => {
		const out = runHook({ tool_name: "Write", tool_input: {} });
		expect(out).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Violation cases (AC 1)
// ---------------------------------------------------------------------------

describe("doc-size-guard — violations (AC 1)", () => {
	it("prints violation for over-budget file missing BOTH structural elements", () => {
		const fp = prdPath(`violation-both-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000, false, false));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toContain("doc-size-guard: violation");
	});

	it("prints violation for over-budget file missing summary-header only", () => {
		const fp = prdPath(`violation-no-summary-${Date.now()}.md`);
		// Has section anchor but no summary-header (starts immediately with ##).
		const content = "## Section One\n\nContent.\n\n" + "x".repeat(11000);
		writeFileSync(fp, content);
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toContain("doc-size-guard: violation");
		expect(out).toContain("summary-header");
	});

	it("prints violation for over-budget file missing section-anchor only", () => {
		const fp = prdPath(`violation-no-anchor-${Date.now()}.md`);
		// Has summary header but no ## section.
		const content = "# Title\n\nIntro paragraph.\n\n" + "x".repeat(11000);
		writeFileSync(fp, content);
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toContain("doc-size-guard: violation");
		expect(out).toContain("section-anchor");
	});

	it("violation output names path, class, measured tokens, budget, and missing element (AC 1)", () => {
		const fp = prdPath(`violation-fields-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000, false, false));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		expect(out).toContain(fp);                // path
		expect(out).toContain("plan");             // class
		expect(out).toMatch(/~\d+ \(budget \d+\)/); // measured tokens + budget
		expect(out).toContain("missing:");          // missing element field
	});

	it("fires for Edit tool use, not just Write", () => {
		const fp = prdPath(`edit-violation-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000, false, false));
		const out = runHook({ tool_name: "Edit", tool_input: { file_path: fp } });
		expect(out).toContain("doc-size-guard: violation");
	});

	it("fires for MultiEdit tool use", () => {
		const fp = prdPath(`multiedit-violation-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000, false, false));
		const out = runHook({ tool_name: "MultiEdit", tool_input: { file_path: fp } });
		expect(out).toContain("doc-size-guard: violation");
	});
});

// ---------------------------------------------------------------------------
// Fail-open cases (AC 6) — must permit AND exit 0
// ---------------------------------------------------------------------------

describe("doc-size-guard — fail-open (AC 6)", () => {
	it("fail-open: file does not exist — no output, exit 0", () => {
		const fp = prdPath(`nonexistent-${Date.now()}.md`);
		// Do NOT create the file.
		const out = runHook({ tool_name: "Write", tool_input: { file_path: fp } });
		// runHook already asserts exit code 0.
		expect(out).toBe(""); // no violation output
	});


	it("fail-open: malformed stdin JSON — no output, exit 0", () => {
		const result = spawnSync("node", [HOOK], {
			input: "not-json{{{",
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("fail-open: empty stdin — no output, exit 0", () => {
		const result = spawnSync("node", [HOOK], {
			input: "",
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("fail-open: SDK-embedded agent env — no output, exit 0", () => {
		const fp = prdPath(`sdk-agent-${Date.now()}.md`);
		writeFileSync(fp, bigContent(11000, false, false));
		const out = runHook(
			{ tool_name: "Write", tool_input: { file_path: fp } },
			{ CLAUDE_CODE_ENTRYPOINT: "sdk-py" },
		);
		expect(out).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Budget-pinning tests (M10 regression: mutating rfc budget must fail)
// ---------------------------------------------------------------------------

describe("doc-class budget values — pinned (M10 mutation guard)", () => {
	function getClassBudget(name: string): number {
		const cls = DOC_CLASSES.find((c: { name: string }) => c.name === name);
		if (!cls) throw new Error(`doc class "${name}" not found in DOC_CLASSES`);
		return cls.budget;
	}

	it("rfc-index class budget is exactly 12000 tokens", () => {
		// Pinned: mutating this value must fail this test.
		expect(getClassBudget("rfc-index")).toBe(12000);
	});

	it("rfc-section class budget is exactly 6000 tokens", () => {
		// Pinned: mutating this value must fail this test.
		expect(getClassBudget("rfc-section")).toBe(6000);
	});

	it("rfc-index guard fires when rfc.md exceeds 12000 tokens", () => {
		// 12001 tokens = ceil(x / 3.5) > 12000 → x > 42000 bytes. Use 42004 bytes.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-budget-test");
		const rfcPath = path.join(rfcDir, "rfc.md");
		mkdirSync(rfcDir, { recursive: true });
		writeFileSync(rfcPath, "x".repeat(42004));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: rfcPath } });
		expect(out).toContain("doc-size-guard: violation");
		expect(out).toContain("rfc-index");
	});

	it("rfc-index guard does NOT fire at exactly 12000 tokens (boundary, > not >=)", () => {
		// 12000 tokens = 42000 bytes. Guard uses >, not >=, so this must pass.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-budget-boundary");
		const rfcPath = path.join(rfcDir, "rfc.md");
		mkdirSync(rfcDir, { recursive: true });
		writeFileSync(rfcPath, "x".repeat(42000));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: rfcPath } });
		expect(out).toBe("");
	});

	it("rfc-section guard fires when a sections/ file exceeds 6000 tokens", () => {
		// 6001 tokens → x > 21000 bytes. Use 21004 bytes.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-section-test");
		const secPath = path.join(rfcDir, "sections", "01-motivation.md");
		mkdirSync(path.dirname(secPath), { recursive: true });
		writeFileSync(secPath, "x".repeat(21004));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: secPath } });
		expect(out).toContain("doc-size-guard: violation");
		expect(out).toContain("rfc-section");
	});

	it("rfc-section guard does NOT fire at exactly 6000 tokens (boundary, > not >=)", () => {
		// 6000 tokens = 21000 bytes.
		const rfcDir = path.join(tmpDir, ".groundwork", "rfcs", "9999-section-boundary");
		const secPath = path.join(rfcDir, "sections", "01-motivation.md");
		mkdirSync(path.dirname(secPath), { recursive: true });
		writeFileSync(secPath, "x".repeat(21000));
		const out = runHook({ tool_name: "Write", tool_input: { file_path: secPath } });
		expect(out).toBe("");
	});

	it("sections/ path classifies as rfc-section (not null/unclassified)", () => {
		// Regression: before this fix, sections/ files classified as null and bypassed the guard.
		const secPath = path.join(ROOT, ".groundwork", "rfcs", "0001-spec-rfc-journal", "sections", "02-artifact-reference", "01-full-layout.md");
		const cls = classifyDoc(secPath, ROOT);
		expect(cls).not.toBeNull();
		expect(cls?.name).toBe("rfc-section");
	});

	it("sections/ nested path classifies as rfc-section (not null/unclassified)", () => {
		// Also covers a flat sections/ file.
		const secPath = path.join(ROOT, ".groundwork", "rfcs", "0001-spec-rfc-journal", "sections", "01-motivation.md");
		const cls = classifyDoc(secPath, ROOT);
		expect(cls).not.toBeNull();
		expect(cls?.name).toBe("rfc-section");
	});

	it("notes/ path under RFC dir does NOT classify as rfc-section (sections/ constraint must hold)", () => {
		// Mutation guard: if the sections/ segment is removed from the regex, notes/ files would
		// wrongly classify as rfc-section. This test catches that widening mutant.
		const notesPath = path.join(ROOT, ".groundwork", "rfcs", "0001-spec-rfc-journal", "notes", "steering.md");
		const cls = classifyDoc(notesPath, ROOT);
		// notes/ files must be unclassified (null), never rfc-section.
		expect(cls?.name).not.toBe("rfc-section");
	});
});
