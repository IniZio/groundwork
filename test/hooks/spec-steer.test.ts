/**
 * spec-steer.mjs and spec-lint.mjs tests — RFC-0001 T14 acceptance criteria.
 * Also covers steering injection in session-reminder.mjs.
 *
 * AC 1 — system never authors docs/steering/ files
 * AC 2 — SessionStart injects top-level docs/steering/ only (no subdirectory recursion)
 * AC 3 — steering injection truncates at file granularity when >1000 tokens; logs SESSION_START
 * AC 4 — spec steer prints ancestry bottom-up; warns if chain >4000 tokens
 * AC 5 — spec lint (no --rfc) checks every node, emits LINT_DRIFT per violation
 * AC 6 — spec lint --rfc checks only RFC spec_delta nodes; exits 1 on violations
 * AC 7 — STEERING_UPDATE journal event (not exercised by these scripts; T4 writes steering)
 * AC 8 — spec steer / spec lint never write to docs/steering/
 * AC 9 — SessionStart injection token measurement (verified separately; DECISION event emitted)
 *
 * Mutation tests cover:
 *   M1 — token boundary: > vs >= at STEERING_TOKEN_CAP=1000 (AC 3)
 *   M2 — non-recursion: skipping directories (AC 2)
 *   M3 — --rfc exit-1 vs exit-0 boundary (AC 6)
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const STEER_CLI = path.resolve(
	import.meta.dirname,
	"../..",
	"hooks",
	"spec-steer.mjs",
);
const LINT_CLI = path.resolve(
	import.meta.dirname,
	"../..",
	"hooks",
	"spec-lint.mjs",
);
const REMINDER_CLI = path.resolve(
	import.meta.dirname,
	"../..",
	"hooks",
	"session-reminder.mjs",
);
const SPEC_CLI = path.resolve(
	import.meta.dirname,
	"../..",
	"hooks",
	"spec.mjs",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let projectDir: string;

function run(
	cli: string,
	args: string[],
	env?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
	const fullEnv = { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir, ...env };
	delete fullEnv.CLAUDE_CODE_SESSION_ID;
	const result = spawnSync("node", [cli, ...args], {
		env: fullEnv as NodeJS.ProcessEnv,
		encoding: "utf8",
	});
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

/** Estimate tokens using doc-io.mjs formula. */
function estimateTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 3.5);
}

/** Write a steering file under docs/steering/. */
function writeSteeringFile(name: string, content: string): string {
	const dir = path.join(projectDir, "docs", "steering");
	mkdirSync(dir, { recursive: true });
	const p = path.join(dir, name);
	writeFileSync(p, content);
	return p;
}

/** Write a minimal spec index so spec lint can run. */
function writeSpecIndex(nodes: Record<string, object>): void {
	const genDir = path.join(projectDir, "docs", "spec", "_generated");
	mkdirSync(genDir, { recursive: true });
	writeFileSync(path.join(genDir, "index.json"), JSON.stringify({ nodes }));
}

/** Write a spec node markdown file. */
function writeSpecNode(relPath: string, frontmatter: Record<string, string | null>): void {
	const absPath = path.join(projectDir, "docs", "spec", relPath);
	mkdirSync(path.dirname(absPath), { recursive: true });
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${v ?? "null"}`)
		.join("\n");
	writeFileSync(absPath, `---\n${fm}\n---\n\nBody.\n`);
}

/** Write a minimal RFC with spec_delta. */
function writeRfc(uid: string, targets: string[]): string {
	const dir = path.join(projectDir, ".groundwork", "rfcs", `0001-test`);
	mkdirSync(dir, { recursive: true });
	const delta = targets.map(t => `  - op: add\n    target: ${t}`).join("\n");
	const content = `---\nschema: 1\nuid: ${uid}\nstatus: draft\nspec_delta:\n${delta}\n---\n\n# Test RFC\n`;
	writeFileSync(path.join(dir, "rfc.md"), content);
	return dir;
}

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-steer-"));
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC 1 — system never authors docs/steering/
// ---------------------------------------------------------------------------

describe("AC 1 — system never authors docs/steering/", () => {
	it("spec steer does not create any file under docs/steering/", () => {
		// No steering dir exists — steer should not create it
		const steeringDir = path.join(projectDir, "docs", "steering");
		expect(existsSync(steeringDir)).toBe(false);
		run(STEER_CLI, ["."]);
		expect(existsSync(steeringDir)).toBe(false);
	});

	it("spec lint does not create any file under docs/steering/", () => {
		writeSpecIndex({});
		const steeringDir = path.join(projectDir, "docs", "steering");
		expect(existsSync(steeringDir)).toBe(false);
		run(LINT_CLI, []);
		expect(existsSync(steeringDir)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC 2 — top-level injection only (no subdirectory recursion)
// ---------------------------------------------------------------------------

describe("AC 2 — no subdirectory recursion in steering injection", () => {
	it("injects top-level steering files only, not files in subdirectories", () => {
		writeSteeringFile("root.md", "# Root steering");
		// Create a subdirectory with its own file
		mkdirSync(path.join(projectDir, "docs", "steering", "subdir"), { recursive: true });
		writeFileSync(
			path.join(projectDir, "docs", "steering", "subdir", "deep.md"),
			"# Deep file — must not be injected",
		);

		// The session-reminder should only load root.md, not deep.md
		const result = spawnSync(
			"node",
			[REMINDER_CLI],
			{
				input: JSON.stringify({ cwd: projectDir }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined } as NodeJS.ProcessEnv,
			},
		);
		const output = JSON.parse(result.stdout || "{}");
		const ctx: string = output?.hookSpecificOutput?.additionalContext ?? "";
		expect(ctx).toContain("root.md");
		expect(ctx).not.toContain("deep.md");
		expect(ctx).not.toContain("Deep file");
	});

	// Mutation M2: if the directory check is removed, subdirs would be processed
	// and their files would appear. This test proves the isDirectory() guard is load-bearing.
	it("M2 (mutation boundary): subdirectory itself is skipped, not treated as a file", () => {
		mkdirSync(path.join(projectDir, "docs", "steering", "concepts"), { recursive: true });
		writeSteeringFile("top.md", "# Top level");

		const result = spawnSync(
			"node",
			[REMINDER_CLI],
			{
				input: JSON.stringify({ cwd: projectDir }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined } as NodeJS.ProcessEnv,
			},
		);
		const output = JSON.parse(result.stdout || "{}");
		const ctx: string = output?.hookSpecificOutput?.additionalContext ?? "";
		// concepts/ directory ends with no extension — should not cause an error
		expect(result.status).toBe(0);
		expect(ctx).toContain("top.md");
	});
});

// ---------------------------------------------------------------------------
// AC 3 — steering injection truncates at file granularity; logs SESSION_START
// ---------------------------------------------------------------------------

describe("AC 3 — steering truncation at 1000 tokens", () => {
	it("loads files that fit within 1000 tokens, omits files that would exceed", () => {
		// Write a file that alone is under 1000 tokens
		const smallContent = "# Small\n" + "word ".repeat(200); // ~200 words ≈ 286 tokens
		writeSteeringFile("a-small.md", smallContent);

		// Write a large file that would push past 1000 tokens if combined
		const largeContent = "# Large\n" + "x ".repeat(2600); // ~2600 * 2.5 bytes each ≈ >1000 tokens
		writeSteeringFile("b-large.md", largeContent);

		const result = spawnSync(
			"node",
			[REMINDER_CLI],
			{
				input: JSON.stringify({ cwd: projectDir }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined } as NodeJS.ProcessEnv,
			},
		);
		expect(result.status).toBe(0);
		const output = JSON.parse(result.stdout || "{}");
		const ctx: string = output?.hookSpecificOutput?.additionalContext ?? "";
		expect(ctx).toContain("a-small.md"); // loaded
		expect(ctx).toContain("b-large.md"); // named as omitted
	});

	// Mutation M1: boundary test — a file at exactly 1000 tokens should be INCLUDED (> vs >=)
	it("M1 (boundary mutation >=): a file whose tokens equal the cap is included (> not >=)", () => {
		// Build content that is exactly at 1000 tokens using the formula ceil(byteLen/3.5)
		// Target: ceil(byteLen/3.5) = 1000 → byteLen = 3500 (max that stays at 1000)
		// 3500 bytes → ceil(3500/3.5) = 1000 tokens — must be INCLUDED
		const content = "a".repeat(3500);
		writeSteeringFile("boundary.md", content);

		const result = spawnSync(
			"node",
			[REMINDER_CLI],
			{
				input: JSON.stringify({ cwd: projectDir }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined } as NodeJS.ProcessEnv,
			},
		);
		const output = JSON.parse(result.stdout || "{}");
		const ctx: string = output?.hookSpecificOutput?.additionalContext ?? "";
		// File at exactly 1000 tokens should be loaded, not omitted
		expect(ctx).toContain("boundary.md");
		expect(ctx).not.toContain("Steering files omitted");
	});

	it("M1 (boundary mutation >): a file just over 1000 tokens is omitted and named", () => {
		// 3501 bytes → ceil(3501/3.5) = 1001 tokens — must be OMITTED and NAMED
		const content = "a".repeat(3501);
		writeSteeringFile("over-cap.md", content);

		const result = spawnSync(
			"node",
			[REMINDER_CLI],
			{
				input: JSON.stringify({ cwd: projectDir }),
				encoding: "utf8",
				env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined } as NodeJS.ProcessEnv,
			},
		);
		const output = JSON.parse(result.stdout || "{}");
		const ctx: string = output?.hookSpecificOutput?.additionalContext ?? "";
		// File that alone exceeds 1000 tokens must be named in the injection as omitted
		expect(ctx).toContain("over-cap.md");
		expect(ctx).toContain("omitted");
	});
});

// ---------------------------------------------------------------------------
// AC 4 — spec steer prints ancestry bottom-up, warns at 4000 tokens
// ---------------------------------------------------------------------------

describe("AC 4 — spec steer ancestry output", () => {
	it("prints root steering for '.' with heading", () => {
		writeSteeringFile("tech.md", "# Tech\nNode.js");
		const r = run(STEER_CLI, ["."]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Root steering");
		expect(r.stdout).toContain("tech.md");
		expect(r.stdout).toContain("Node.js");
	});

	it("warns to stderr if chain exceeds 4000 tokens", () => {
		// Write a file large enough to push past 4000 tokens in the output
		// 4000 tokens * 3.5 bytes/token = 14000 bytes of raw content, plus headers ~= 14100+ bytes
		const bigContent = "word ".repeat(3000); // ~3000 * 5 bytes = 15000 bytes → >4000 tokens
		writeSteeringFile("huge.md", bigContent);
		const r = run(STEER_CLI, ["."]);
		expect(r.code).toBe(0);
		expect(r.stderr).toMatch(/Warning.*4000/);
	});

	it("does not warn when chain is under 4000 tokens", () => {
		writeSteeringFile("small.md", "# Small\nFive words.");
		const r = run(STEER_CLI, ["."]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("exits 2 with usage when no concept-path provided", () => {
		const r = run(STEER_CLI, []);
		expect(r.code).toBe(2);
	});

	it("exits 1 when steering directory does not exist", () => {
		const r = run(STEER_CLI, ["."]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not found");
	});

	it("shows concept-specific files before root files (bottom-up)", () => {
		writeSteeringFile("root.md", "# Root");
		// Create a concept-specific subdir
		mkdirSync(path.join(projectDir, "docs", "steering", "orchestration"), { recursive: true });
		writeFileSync(
			path.join(projectDir, "docs", "steering", "orchestration", "specific.md"),
			"# Specific orchestration steering",
		);
		const r = run(STEER_CLI, ["orchestration"]);
		expect(r.code).toBe(0);
		const idx_specific = r.stdout.indexOf("Concept steering");
		const idx_root = r.stdout.indexOf("Root steering");
		expect(idx_specific).toBeGreaterThanOrEqual(0);
		expect(idx_root).toBeGreaterThanOrEqual(0);
		// Concept-specific comes before root (bottom-up = most specific first)
		expect(idx_specific).toBeLessThan(idx_root);
	});
});

// ---------------------------------------------------------------------------
// AC 5 — spec lint without --rfc checks all nodes
// ---------------------------------------------------------------------------

describe("AC 5 — spec lint (no --rfc) full check", () => {
	it("exits 0 and reports clean when all nodes pass invariants", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "Root",
				ears: null,
				summary: "A root concept",
				concept: null,
				relPath: "README.md",
			},
		});
		writeSpecNode("README.md", {
			id: "C-ROOT",
			type: "concept",
			title: "Root",
			origin_rfc: "R-TEST",
		});
		const r = run(LINT_CLI, []);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("clean");
	});

	it("reports LINT_DRIFT for nodes missing title", () => {
		writeSpecIndex({
			"C-NOTITLE": {
				id: "C-NOTITLE",
				type: "concept",
				title: "",
				ears: null,
				summary: "some",
				concept: null,
				relPath: "README.md",
			},
		});
		writeSpecNode("README.md", { id: "C-NOTITLE", type: "concept", title: "", origin_rfc: "R-TEST" });
		const r = run(LINT_CLI, []);
		expect(r.code).toBe(0); // full mode always exits 0
		expect(r.stdout).toContain("LINT_DRIFT");
		expect(r.stdout).toContain("title-present");
	});

	it("reports LINT_DRIFT for requirement nodes missing ears and summary", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "Root",
				ears: null,
				summary: "Root",
				concept: null,
				relPath: "README.md",
			},
			"ROOT-R-0001": {
				id: "ROOT-R-0001",
				type: "requirement",
				title: "Some req",
				ears: "",
				summary: "",
				concept: "C-ROOT",
				relPath: "requirements/some-req.md",
			},
		});
		writeSpecNode("README.md", { id: "C-ROOT", type: "concept", title: "Root", origin_rfc: "R-TEST" });
		writeSpecNode("requirements/some-req.md", {
			id: "ROOT-R-0001",
			type: "requirement",
			concept: "C-ROOT",
			title: "Some req",
			origin_rfc: "R-TEST",
		});
		const r = run(LINT_CLI, []);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("ears-or-summary");
	});

	it("reports LINT_DRIFT for nodes missing origin_rfc", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "Root",
				ears: null,
				summary: "Root",
				concept: null,
				relPath: "README.md",
			},
		});
		// No origin_rfc in frontmatter
		writeSpecNode("README.md", { id: "C-ROOT", type: "concept", title: "Root" });
		const r = run(LINT_CLI, []);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("origin-rfc");
	});
});

// ---------------------------------------------------------------------------
// AC 6 — spec lint --rfc checks only RFC spec_delta nodes; exits 1 on violations
// ---------------------------------------------------------------------------

describe("AC 6 — spec lint --rfc mode", () => {
	it("exits 0 when RFC nodes are clean", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "Root",
				ears: null,
				summary: "Root",
				concept: null,
				relPath: "README.md",
			},
		});
		writeSpecNode("README.md", { id: "C-ROOT", type: "concept", title: "Root", origin_rfc: "R-TESTX" });
		writeRfc("R-TESTX", ["docs/spec/README.md"]);
		const r = run(LINT_CLI, ["--rfc", "R-TESTX"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("clean");
	});

	it("exits 1 when RFC nodes have violations", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "", // violation: empty title
				ears: null,
				summary: "Root",
				concept: null,
				relPath: "README.md",
			},
		});
		writeSpecNode("README.md", { id: "C-ROOT", type: "concept", title: "", origin_rfc: "R-TESTY" });
		writeRfc("R-TESTY", ["docs/spec/README.md"]);
		const r = run(LINT_CLI, ["--rfc", "R-TESTY"]);
		expect(r.code).toBe(1); // exit 1 on violations in --rfc mode
		expect(r.stderr).toContain("LINT_DRIFT");
	});

	// Mutation M3: boundary — check that exit code is 1 (not 0) with violations.
	// If the condition were inverted or the process.exit(1) removed, exit would be 0.
	it("M3 (mutation boundary): exit code is exactly 1 on violations, not 0", () => {
		writeSpecIndex({
			"C-ROOT": {
				id: "C-ROOT",
				type: "concept",
				title: "",
				ears: null,
				summary: "",
				concept: null,
				relPath: "README.md",
			},
		});
		writeSpecNode("README.md", { id: "C-ROOT", type: "concept", title: "" });
		writeRfc("R-TESTZ", ["docs/spec/README.md"]);
		const r = run(LINT_CLI, ["--rfc", "R-TESTZ"]);
		// Exactly 1, not 0 and not 2
		expect(r.code).toBe(1);
	});

	it("exits 1 if RFC not found", () => {
		writeSpecIndex({});
		const r = run(LINT_CLI, ["--rfc", "R-NONEXISTENT"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not found");
	});

	it("exits 2 on usage error (--rfc with no uid)", () => {
		const r = run(LINT_CLI, ["--rfc"]);
		expect(r.code).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// AC 8 — spec steer and spec lint never write to docs/steering/
// ---------------------------------------------------------------------------

describe("AC 8 — read-only access to docs/steering/", () => {
	it("spec steer does not modify any steering file", () => {
		writeSteeringFile("check.md", "# Original content");
		const before = readFileSync(
			path.join(projectDir, "docs", "steering", "check.md"),
			"utf8",
		);
		run(STEER_CLI, ["."]);
		const after = readFileSync(
			path.join(projectDir, "docs", "steering", "check.md"),
			"utf8",
		);
		expect(after).toBe(before);
	});

	it("spec steer does not create new files under docs/steering/", () => {
		writeSteeringFile("existing.md", "# Existing");
		const filesBefore = readdirSync(path.join(projectDir, "docs", "steering"));
		run(STEER_CLI, ["."]);
		const filesAfter = readdirSync(path.join(projectDir, "docs", "steering"));
		expect(filesAfter).toEqual(filesBefore);
	});

	it("spec lint does not create or modify files under docs/steering/", () => {
		writeSteeringFile("guard.md", "# Guard");
		const steeringDir = path.join(projectDir, "docs", "steering");
		writeSpecIndex({});
		const before = readdirSync(steeringDir).join(",");
		run(LINT_CLI, []);
		const after = readdirSync(steeringDir).join(",");
		expect(after).toBe(before);
	});
});

// ---------------------------------------------------------------------------
// Spec delegation wiring (via spec.mjs)
// ---------------------------------------------------------------------------

describe("spec steer/lint dispatch via spec.mjs", () => {
	it("spec steer dispatches to spec-steer.mjs (not exit 127)", () => {
		// With scripts present, should NOT exit 127
		// (exit 2 because no concept-path arg, but not 127)
		const result = spawnSync(
			"node",
			[SPEC_CLI, "steer"],
			{ encoding: "utf8", env: { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir } as NodeJS.ProcessEnv },
		);
		expect(result.status).not.toBe(127);
	});

	it("spec lint dispatches to spec-lint.mjs (not exit 127)", () => {
		writeSpecIndex({});
		const result = spawnSync(
			"node",
			[SPEC_CLI, "lint"],
			{ encoding: "utf8", env: { ...process.env, GROUNDWORK_PROJECT_DIR: projectDir } as NodeJS.ProcessEnv },
		);
		expect(result.status).not.toBe(127);
	});
});
