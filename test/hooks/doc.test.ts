/**
 * doc CLI tests — covers all 9 acceptance criteria from RFC-0001 T19.
 *
 * AC1  — doc toc emits section anchors and no section body
 * AC2  — doc show --section emits exactly the named section + whole-file token cost
 * AC3  — doc show --brief emits only the summary header block, at most 8 lines
 * AC4  — doc search limits rows to --limit (default 8) and prints total match count when truncated
 * AC5  — doc lint prints one summary row per class and exits 0 when all files are within budget
 * AC6  — doc lint violation names path, class, token estimate, budget, missing structural element
 * AC7  — doc lint reports over-budget-but-structurally-sound as WARN, not exit non-zero
 * AC8  — doc never writes/rewrites/truncates any indexed file (mtime + hash test)
 * AC9  — doc lint excludes unclassified files and names them in summary
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	createHash,
	type Hash,
} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"hooks",
	"doc.mjs",
);

let projectDir: string;

function run(args: string[], opts: { cwd?: string } = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: opts.cwd ?? projectDir,
		encoding: "utf8",
		env: { ...process.env },
	});
}

function runOrThrow(args: string[], opts: { cwd?: string } = {}) {
	return execFileSync(process.execPath, [CLI, ...args], {
		cwd: opts.cwd ?? projectDir,
		encoding: "utf8",
		env: { ...process.env },
	});
}

function md5(s: string) {
	return createHash("md5").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_CONTENT = `# My Skill

This is the summary header paragraph.

## Overview

This section explains the skill overview in detail.
It has multiple lines.

## Usage

\`\`\`bash
example command
\`\`\`

## Notes

Final notes here.
`;

const PRD_CONTENT = `# PRD: Feature X

Background for the PRD.

## Goals

We want to achieve X.

## Non-Goals

We do not want Y.
`;

const NARRATIVE_CONTENT = `# Development Guide

Introduction paragraph.

## Setup

Run the setup script.

## Testing

Run the tests.
`;

// A file that starts with ## (no summary header)
const NO_HEADER_CONTENT = `## Section One

Body of section one.

## Section Two

Body of section two.
`;

// A file with no ## headings (no section anchors)
const NO_SECTIONS_CONTENT = `# Just a title

Some prose without any sections.
`;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-doc-"));
	writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "test-project" }));

	// Create skills/my-skill/SKILL.md
	mkdirSync(path.join(projectDir, "skills", "my-skill"), { recursive: true });
	writeFileSync(path.join(projectDir, "skills", "my-skill", "SKILL.md"), SKILL_CONTENT);

	// Create .groundwork/plans/feature-x.md (prd class)
	mkdirSync(path.join(projectDir, ".groundwork", "plans"), { recursive: true });
	writeFileSync(path.join(projectDir, ".groundwork", "plans", "feature-x.md"), PRD_CONTENT);

	// Create doc/development.md (narrative)
	mkdirSync(path.join(projectDir, "doc"), { recursive: true });
	writeFileSync(path.join(projectDir, "doc", "development.md"), NARRATIVE_CONTENT);

	// Create root README.md
	writeFileSync(path.join(projectDir, "README.md"), `# README\n\nProject readme.\n\n## Getting Started\n\nStart here.\n`);
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC1: toc emits section anchors, no section body
// ---------------------------------------------------------------------------

describe("AC1 — doc toc", () => {
	it("emits section anchors for every heading", () => {
		const out = runOrThrow(["toc", "skills/my-skill/SKILL.md"]);
		expect(out).toContain("#overview");
		expect(out).toContain("#usage");
		expect(out).toContain("#notes");
	});

	it("does NOT emit section body text", () => {
		const out = runOrThrow(["toc", "skills/my-skill/SKILL.md"]);
		// The body text should not appear
		expect(out).not.toContain("explains the skill overview");
		expect(out).not.toContain("example command");
		expect(out).not.toContain("Final notes here");
	});

	it("exits 2 with no path argument", () => {
		const r = run(["toc"]);
		expect(r.status).toBe(2);
	});

	it("exits 1 if file not found", () => {
		const r = run(["toc", "nonexistent.md"]);
		expect(r.status).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// AC2: show --section emits exactly the named section + token cost
// ---------------------------------------------------------------------------

describe("AC2 — doc show --section", () => {
	it("emits the named section heading and body", () => {
		const out = runOrThrow(["show", "skills/my-skill/SKILL.md", "--section", "overview"]);
		expect(out).toContain("## Overview");
		expect(out).toContain("explains the skill overview");
	});

	it("emits whole-file token cost", () => {
		const out = runOrThrow(["show", "skills/my-skill/SKILL.md", "--section", "overview"]);
		expect(out).toMatch(/whole-file token cost: ~\d+ tokens/);
	});

	it("does NOT emit other sections' bodies when showing one section", () => {
		const out = runOrThrow(["show", "skills/my-skill/SKILL.md", "--section", "overview"]);
		expect(out).not.toContain("Final notes here");
		expect(out).not.toContain("example command");
	});

	it("exits 1 with helpful message when section anchor not found", () => {
		const r = run(["show", "skills/my-skill/SKILL.md", "--section", "nonexistent"]);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("nonexistent");
	});
});

// ---------------------------------------------------------------------------
// AC3: show --brief emits summary header, at most 8 lines
// ---------------------------------------------------------------------------

describe("AC3 — doc show --brief", () => {
	it("emits the summary header block (content before first ##)", () => {
		const out = runOrThrow(["show", "skills/my-skill/SKILL.md", "--brief"]);
		// Should contain the title and the summary paragraph
		expect(out).toContain("My Skill");
		expect(out).toContain("summary header paragraph");
	});

	it("emits at most 8 lines", () => {
		// Create a file with a long summary header
		const longHeader = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");
		const bigFile = `${longHeader}\n\n## Section\n\nBody.\n`;
		writeFileSync(path.join(projectDir, "doc", "big.md"), bigFile);

		const out = runOrThrow(["show", "doc/big.md", "--brief"]);
		const lines = out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("─"));
		expect(lines.length).toBeLessThanOrEqual(8);
	});

	it("does NOT emit section body in --brief mode", () => {
		const out = runOrThrow(["show", "skills/my-skill/SKILL.md", "--brief"]);
		expect(out).not.toContain("explains the skill overview");
	});

	it("exits 2 without a mode flag", () => {
		const r = run(["show", "skills/my-skill/SKILL.md"]);
		expect(r.status).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// AC4: search limits rows and prints total match count when truncated
// ---------------------------------------------------------------------------

describe("AC4 — doc search", () => {
	beforeEach(() => {
		// Create 10 narrative docs all matching "searchterm"
		for (let i = 0; i < 10; i++) {
			writeFileSync(
				path.join(projectDir, "doc", `topic-${i}.md`),
				`# Topic ${i}\n\nThis doc mentions searchterm here.\n\n## Section\n\nMore text.\n`,
			);
		}
	});

	it("returns at most --limit rows (default 8)", () => {
		const out = runOrThrow(["search", "searchterm"]);
		const resultLines = out.split("\n").filter((l) => l.includes("searchterm") || l.includes("topic-"));
		expect(resultLines.length).toBeLessThanOrEqual(8);
	});

	it("prints total match count when results are truncated", () => {
		const out = runOrThrow(["search", "searchterm"]);
		// Should show truncation notice since 10 matches > default limit 8
		expect(out).toMatch(/\d+ of \d+ matches shown/);
	});

	it("respects --limit flag", () => {
		const out = runOrThrow(["search", "searchterm", "--limit", "3"]);
		const lines = out.split("\n").filter((l) => l.match(/topic-\d+/));
		expect(lines.length).toBeLessThanOrEqual(3);
		expect(out).toMatch(/3 of \d+ matches shown/);
	});

	it("exits 2 with no query", () => {
		const r = run(["search"]);
		expect(r.status).toBe(2);
	});

	it("prints (no matches) when nothing found", () => {
		const out = runOrThrow(["search", "zzz_definitely_not_in_any_file"]);
		expect(out).toContain("no matches");
	});
});

// ---------------------------------------------------------------------------
// AC5: lint prints one summary row per class, exits 0 when all within budget
// ---------------------------------------------------------------------------

describe("AC5 — doc lint summary table", () => {
	it("prints one row per doc class", () => {
		const out = runOrThrow(["lint"]);
		// All defined classes must appear
		expect(out).toContain("root-doc");
		expect(out).toContain("skill");
		expect(out).toContain("plan");
		expect(out).toContain("narrative");
	});

	it("exits 0 when all files are within budget and structurally sound", () => {
		const r = run(["lint"]);
		expect(r.status).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC6: lint violation names path, class, token estimate, budget, missing element
// ---------------------------------------------------------------------------

describe("AC6 — doc lint violations", () => {
	it("names path, class, token estimate, budget, and missing element for a violation", () => {
		// File with no summary header and no section anchors
		writeFileSync(path.join(projectDir, "doc", "empty-struct.md"), NO_SECTIONS_CONTENT);

		const r = run(["lint"]);
		// Should exit 1 because of missing section-anchor
		expect(r.status).toBe(1);
		const out = r.stdout;
		expect(out).toContain("doc/empty-struct.md");
		expect(out).toContain("narrative");
		expect(out).toMatch(/~\d+ tokens/);
		expect(out).toContain("2000"); // budget
		expect(out).toContain("section-anchor");
	});

	it("reports missing summary-header when file starts with ##", () => {
		writeFileSync(path.join(projectDir, "doc", "no-header.md"), NO_HEADER_CONTENT);

		const r = run(["lint"]);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("summary-header");
	});
});

// ---------------------------------------------------------------------------
// AC7: over-budget-but-structurally-sound → WARN, not exit non-zero
// ---------------------------------------------------------------------------

describe("AC7 — doc lint warning not failure for structurally-sound over-budget", () => {
	it("reports WARN (not FAIL) for over-budget file with header and sections", () => {
		// Create a large PRD that exceeds 3000-token budget but has proper structure
		const bigContent =
			"# Big PRD\n\nThis is the summary header.\n\n## Goals\n\n" +
			"x".repeat(12000) + // ~3428 tokens from this alone
			"\n\n## Non-Goals\n\nNone.\n";
		writeFileSync(path.join(projectDir, ".groundwork", "plans", "big.md"), bigContent);

		const r = run(["lint"]);
		// Should NOT exit non-zero solely because of over-budget structurally-sound file
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("WARN");
		expect(r.stdout).not.toContain("FAIL");
	});

	it("exits 1 if over-budget file is ALSO missing structural element", () => {
		// Big file with no summary header
		const bigBad =
			"## Section\n\n" +
			"x".repeat(12000) +
			"\n## Another\n\nText.\n";
		writeFileSync(path.join(projectDir, ".groundwork", "plans", "big-bad.md"), bigBad);

		const r = run(["lint"]);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain("FAIL");
	});
});

// ---------------------------------------------------------------------------
// AC8: read-only guarantee — no file is written/truncated/modified
// ---------------------------------------------------------------------------

describe("AC8 — read-only guarantee", () => {
	it("does not modify any fixture file across all subcommands", () => {
		const skillFile = path.join(projectDir, "skills", "my-skill", "SKILL.md");
		const prdFile = path.join(projectDir, ".groundwork", "plans", "feature-x.md");
		const readmeFile = path.join(projectDir, "README.md");

		// Record mtime and content hash before
		const snapshot = (p: string) => ({
			mtime: statSync(p).mtimeMs,
			hash: md5(readFileSync(p, "utf8")),
		});

		const before = {
			skill: snapshot(skillFile),
			prd: snapshot(prdFile),
			readme: snapshot(readmeFile),
		};

		// Run all subcommands
		run(["toc", "skills/my-skill/SKILL.md"]);
		run(["show", "skills/my-skill/SKILL.md", "--section", "overview"]);
		run(["show", "skills/my-skill/SKILL.md", "--brief"]);
		run(["show", ".groundwork/plans/feature-x.md", "--brief"]);
		run(["search", "section"]);
		run(["lint"]);

		// Verify unchanged
		const after = {
			skill: snapshot(skillFile),
			prd: snapshot(prdFile),
			readme: snapshot(readmeFile),
		};

		expect(after.skill.mtime).toBe(before.skill.mtime);
		expect(after.skill.hash).toBe(before.skill.hash);
		expect(after.prd.mtime).toBe(before.prd.mtime);
		expect(after.prd.hash).toBe(before.prd.hash);
		expect(after.readme.mtime).toBe(before.readme.mtime);
		expect(after.readme.hash).toBe(before.readme.hash);
	});
});

// ---------------------------------------------------------------------------
// AC9: unclassified files excluded from lint and named in summary
// ---------------------------------------------------------------------------

describe("AC9 — unclassified paths excluded and named", () => {
	it("names unclassified files in the summary", () => {
		// doc/specs/README.md is not matched by any class (narrative requires top-level only)
		mkdirSync(path.join(projectDir, "doc", "specs"), { recursive: true });
		writeFileSync(
			path.join(projectDir, "doc", "specs", "README.md"),
			"# Spec Root\n\nSome content.\n\n## Section\n\nMore.\n",
		);

		const r = run(["lint"]);
		expect(r.stdout).toContain("unclassified");
		expect(r.stdout).toContain("doc/specs/README.md");
	});

	it("does not treat unclassified files as violations", () => {
		// A structurally bad file in an unclassified location should not trigger FAIL
		mkdirSync(path.join(projectDir, "doc", "specs"), { recursive: true });
		writeFileSync(
			path.join(projectDir, "doc", "specs", "bad.md"),
			// No summary header, no sections
			"just some random text\nno headings at all\n",
		);

		const r = run(["lint"]);
		// exit 0 because the unclassified file is not linted
		expect(r.status).toBe(0);
		// And it should still be named as unclassified
		expect(r.stdout).toContain("unclassified");
	});
});

// ---------------------------------------------------------------------------
// T20 AC8 — per-file OK line: path, class, and NUMERIC token count
// ---------------------------------------------------------------------------
// These tests pin the oks[] print loop in cmdLint (hooks/doc.mjs ~375-379).
// M3: deleting the loop → no OK line printed → test fails.
// M4: corrupting the token template value → numeric mismatch → test fails.
// M3-boundary: `tokenCost > budget` mutated to `>=` → at-budget file flips to
//   WARN → test fails.
// ---------------------------------------------------------------------------

describe("T20-AC8 — per-file OK line reporting", () => {
	it("emits an OK line containing the file path, class, and exact numeric token count", () => {
		// doc/development.md is created in beforeEach with NARRATIVE_CONTENT
		// Token formula: Math.ceil(Buffer.byteLength(content, 'utf8') / 3.5)
		const expectedTokens = Math.ceil(
			Buffer.byteLength(NARRATIVE_CONTENT, "utf8") / 3.5,
		);
		const r = run(["lint"]);
		// Exact substring check — any numeric corruption in M4 breaks this
		expect(r.stdout).toContain(
			`OK    doc/development.md  [narrative]  ~${expectedTokens} tokens (budget 2000)`,
		);
	});

	it("treats a file exactly at the class budget as OK, not WARN (pins > vs >= boundary)", () => {
		// Craft a structurally-valid file whose tokenCost equals the narrative budget (2000).
		// Math.ceil(bytes / 3.5) === 2000  ↔  bytes === 7000 (7000 / 3.5 = 2000.0 exactly).
		const header = "# Budget Boundary\n\nSummary paragraph here.\n\n## Section\n\n";
		const headerBytes = Buffer.byteLength(header, "utf8");
		const content = header + "x".repeat(7000 - headerBytes);
		writeFileSync(path.join(projectDir, "doc", "at-budget.md"), content);

		const tokenCost = Math.ceil(Buffer.byteLength(content, "utf8") / 3.5);
		expect(tokenCost).toBe(2000); // sanity-check the fixture

		const r = run(["lint"]);
		// With correct `>`: tokenCost === budget is NOT over budget → OK line.
		// With mutant `>=`: tokenCost === budget IS "over" budget → WARN line.
		expect(r.stdout).toMatch(/OK\s+doc\/at-budget\.md/);
		expect(r.stdout).not.toMatch(/WARN\s+doc\/at-budget\.md/);
	});
});

// ---------------------------------------------------------------------------
// _intro.md summary-header exemption
// ---------------------------------------------------------------------------
// The _intro.md filename is exempt from the summary-header rule because these
// stubs are navigation placeholders (5-14 tokens) that cannot carry a
// meaningful summary. The exemption is keyed on the EXACT filename so it
// cannot silently widen to cover substantive section files.
//
// Positive test: _intro.md with no summary header → no summary-header violation
// Negative test: a sibling non-_intro file without a summary header → still fails
// ---------------------------------------------------------------------------

describe("_intro.md summary-header exemption", () => {
	beforeEach(() => {
		// Create the rfc-section directory structure
		mkdirSync(
			path.join(projectDir, ".groundwork", "rfcs", "test-rfc", "sections", "01-topic"),
			{ recursive: true },
		);
	});

	it("does NOT flag _intro.md for missing summary-header", () => {
		// _intro.md with only a heading (no content before first ##) — classic stub
		writeFileSync(
			path.join(
				projectDir,
				".groundwork",
				"rfcs",
				"test-rfc",
				"sections",
				"01-topic",
				"_intro.md",
			),
			"## 1. Topic\n\nIntroduction stub.\n",
		);

		const r = run(["lint"]);
		// summary-header must NOT appear for _intro.md
		const introLines = r.stdout
			.split("\n")
			.filter((l) => l.includes("_intro.md"));
		for (const line of introLines) {
			expect(line).not.toContain("summary-header");
		}
	});

	it("still flags a non-_intro.md rfc-section file for missing summary-header", () => {
		// A substantive section file that lacks a summary header — NOT _intro.md
		writeFileSync(
			path.join(
				projectDir,
				".groundwork",
				"rfcs",
				"test-rfc",
				"sections",
				"01-topic",
				"01-detail.md",
			),
			"## 1.1 Detail\n\nBody text here.\n",
		);

		const r = run(["lint"]);
		// summary-header violation MUST appear for the non-_intro file
		const detailLines = r.stdout
			.split("\n")
			.filter((l) => l.includes("01-detail.md"));
		expect(detailLines.some((l) => l.includes("summary-header"))).toBe(true);
		expect(r.status).toBe(1);
	});

	it("a file named _intro.probe.md is still flagged for missing summary-header (M9)", () => {
		// The exemption in doc.mjs is keyed on the EXACT filename '=== _intro.md'.
		// A widening mutation (.startsWith('_intro')) would exempt _intro.probe.md too.
		// This test pins the exact-match behaviour: _intro.probe.md MUST still be required
		// to have a summary header.
		writeFileSync(
			path.join(
				projectDir,
				".groundwork",
				"rfcs",
				"test-rfc",
				"sections",
				"01-topic",
				"_intro.probe.md",
			),
			"## 1.1 Probe\n\nBody text here, no summary header paragraph.\n",
		);

		const r = run(["lint"]);
		const probeLines = r.stdout
			.split("\n")
			.filter((l) => l.includes("_intro.probe.md"));
		// summary-header violation MUST appear — the file is NOT exempt
		expect(probeLines.some((l) => l.includes("summary-header"))).toBe(true);
		expect(r.status).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("usage errors exit 2", () => {
	it("unknown subcommand exits 2", () => {
		const r = run(["bogus"]);
		expect(r.status).toBe(2);
	});
});
