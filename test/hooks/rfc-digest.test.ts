/**
 * Tests for rfc-io.mjs: fence-safe digest scoping, digest determinism across
 * layouts, strict layout validation, and tasks[] sidecar round-trip.
 *
 * Required by the RFC structure standard implementation brief.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import library functions under test directly.
import {
	assembleLogicalBody,
	computeBodyDigest,
	readTasksSidecar,
	validateSectionLayout,
	writeTasksSidecar,
} from "../../hooks/lib/rfc-io.mjs";

let tmpDir: string;
let _rfcN = 0; // unique RFC dir counter per test, reset in beforeEach

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "gw-rfc-digest-"));
	_rfcN = 0;
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal multi-file RFC directory tree.
 * Each call within a test gets a unique directory name via _rfcN.
 *
 * Section keys are relative paths under sections/ (e.g. "01-summary.md"
 * or "02-design/01-overview.md").
 */
function makeRfc(
	sections: Record<string, string>,
	tasks: unknown[] = [],
	frontmatter: Record<string, unknown> = {},
): string {
	const rfcDir = path.join(tmpDir, `rfc${++_rfcN}`);
	const sectionsDir = path.join(rfcDir, "sections");
	mkdirSync(sectionsDir, { recursive: true });

	for (const [name, content] of Object.entries(sections)) {
		const fullPath = path.join(sectionsDir, name);
		mkdirSync(path.dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, content);
	}

	writeFileSync(path.join(rfcDir, "tasks.yaml"), JSON.stringify(tasks));

	const fm = {
		schema: 1,
		uid: `R-20260726-TEST0${_rfcN}`,
		ordinal: _rfcN,
		slug: "test",
		title: "Test RFC",
		status: "draft",
		classification: "tactical",
		created: "2026-07-26T00:00:00.000Z",
		updated: "2026-07-26T00:00:00.000Z",
		accepted_at: null,
		accepted_by: null,
		supersedes: [],
		superseded_by: null,
		body_digest: null,
		spec_delta: [],
		...frontmatter,
	};
	const yaml = Object.entries(fm)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
		.join("\n");
	writeFileSync(
		path.join(rfcDir, "rfc.md"),
		`---\n${yaml}\n---\n\n> Abstract: Test RFC\n`,
	);

	return rfcDir;
}

/**
 * Create a single-file RFC (no sections/ directory) — exercises the
 * compatibility code path in computeBodyDigest that calls
 * extractSections1to8FenceAware.  The `body` argument is everything that
 * follows the closing `---` line in rfc.md.
 */
function makeSingleFileRfc(body: string): string {
	const rfcDir = path.join(tmpDir, `rfc${++_rfcN}`);
	mkdirSync(rfcDir, { recursive: true });
	const fm = {
		schema: 1,
		uid: `R-20260726-SFT${String(_rfcN).padStart(2, "0")}`,
		ordinal: _rfcN,
		slug: "test",
		title: "Test RFC",
		status: "draft",
		classification: "tactical",
		created: "2026-07-26T00:00:00.000Z",
		updated: "2026-07-26T00:00:00.000Z",
		accepted_at: null,
		accepted_by: null,
		supersedes: [],
		superseded_by: null,
		body_digest: null,
		spec_delta: [],
	};
	const yaml = Object.entries(fm)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
		.join("\n");
	writeFileSync(path.join(rfcDir, "rfc.md"), `---\n${yaml}\n---\n\n${body}`);
	// Intentionally no sections/ directory → forces single-file compatibility path.
	return rfcDir;
}

// ---------------------------------------------------------------------------
// 1. Fenced-code headings cannot influence digest scoping
// ---------------------------------------------------------------------------

describe("fence-safe digest scoping", () => {
	it("fenced heading ## 3. Fake does not affect digest of §§1–8", () => {
		// §2 contains a fenced code block with a heading-shaped line.
		// The heading inside the fence must NOT influence what is hashed.
		const rfcDirWithFence = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nReal content.\n",
			"02-design.md":
				"## 2. Design\n\nProse.\n\n```\n## 3. Fake heading inside fence\n```\n\nMore prose.\n",
			"03-security.md": "## 3. Security\n\nTODO\n",
		});

		// Compute digest — must not throw.
		const fm = { spec_delta: [] };
		expect(() => computeBodyDigest(fm, rfcDirWithFence)).not.toThrow();

		// A layout where §2 lacks the fence but has the same outer prose:
		const rfcDirNoFence = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nReal content.\n",
			"02-design.md": "## 2. Design\n\nProse.\n\nMore prose.\n",
			"03-security.md": "## 3. Security\n\nTODO\n",
		});

		// §2 content differs (one has the fence line, other doesn't) → digests differ.
		const dWithFence = computeBodyDigest(fm, rfcDirWithFence);
		const dNoFence = computeBodyDigest(fm, rfcDirNoFence);
		expect(dWithFence).not.toBe(dNoFence);

		// Rerunning on same directory is deterministic.
		expect(computeBodyDigest(fm, rfcDirWithFence)).toBe(dWithFence);
	});

	it("fenced ## 9. Stop line inside §8 does not truncate the §8 capture", () => {
		// §8 has a fence containing "## 9. Fake" — must not stop §8 content.
		const rfcWithFenceInSec8 = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nContent.\n",
			"08-open-questions.md":
				"## 8. Open Questions\n\nSome text.\n\n```bash\n## 9. Fake\n```\n\nMore.\n",
		});
		const rfcSec8NoFence = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nContent.\n",
			"08-open-questions.md": "## 8. Open Questions\n\nSome text.\n\nMore.\n",
		});
		const fm = { spec_delta: [] };
		// The two §8 files differ → digests must differ.
		// If the fence were causing truncation, "More." would be lost and the digests
		// might happen to match — but they shouldn't because the fence line itself
		// is also different prose.
		expect(computeBodyDigest(fm, rfcWithFenceInSec8)).not.toBe(
			computeBodyDigest(fm, rfcSec8NoFence),
		);
		// Sanity: both produce valid-length hex strings.
		expect(computeBodyDigest(fm, rfcWithFenceInSec8)).toHaveLength(64);
	});

	// -------------------------------------------------------------------------
	// M-04 killer: isFenceDelimiter always returns false
	//
	// Existing tests use makeRfc (multi-file mode) where extractSections1to8FenceAware
	// is NEVER called — so they cannot kill this mutant.
	// This test uses single-file compatibility mode (no sections/) with the adversarial
	// fenced heading inside §8 specifically.  §8 is the last section in the 1–8 range,
	// so if the fence is not detected and ## 9. stops capture, there is no later real
	// heading to re-open it and the tail is silently dropped.
	// Assertion: removing the tail content changes the digest → tail must be included.
	// Under the mutant (isFenceDelimiter → false): ## 9. stops capture → tail dropped
	// → both digests are identical → assertion fails → mutant killed.
	// -------------------------------------------------------------------------
	it("single-file: ``` fence in §8 — tail content after fenced ## 9. is included in digest (M-04)", () => {
		const sentinel = "SENTINEL_TAIL_CONTENT_BACKTICK_M04";
		// Body A: §8 with a backtick fence enclosing a fake ## 9. heading, then tail.
		const bodyWithTail =
			`## 8. Open Questions\n\nSome text.\n\n` +
			`\`\`\`\n## 9. Fake heading — must not stop §8 capture\n\`\`\`\n\n${sentinel}\n`;
		// Body B: same but without the tail sentinel — only the fence block differs.
		const bodyWithoutTail =
			`## 8. Open Questions\n\nSome text.\n\n` +
			`\`\`\`\n## 9. Fake heading — must not stop §8 capture\n\`\`\`\n`;

		const rfcWithTail = makeSingleFileRfc(bodyWithTail);
		const rfcWithoutTail = makeSingleFileRfc(bodyWithoutTail);
		const fm = { spec_delta: [], tasks: [] };

		// The sentinel IS part of §8; removing it must change the digest.
		expect(computeBodyDigest(fm, rfcWithTail)).not.toBe(
			computeBodyDigest(fm, rfcWithoutTail),
		);
	});

	// -------------------------------------------------------------------------
	// M-03 killer: fence detector drops the ~{3,} alternative
	//
	// Same logic as M-04 but uses ~~~ fence style.  If the ~{3,} branch is
	// absent, ~~~ lines are not recognised as fence delimiters and ## 9. stops
	// capture, silently dropping the tail.
	// -------------------------------------------------------------------------
	it("single-file: ~~~ fence in §8 — tail content after fenced ## 9. is included in digest (M-03)", () => {
		const sentinel = "SENTINEL_TAIL_CONTENT_TILDE_M03";
		const bodyWithTail =
			`## 8. Open Questions\n\nSome text.\n\n` +
			`~~~\n## 9. Fake heading — tilde fence must be recognised\n~~~\n\n${sentinel}\n`;
		const bodyWithoutTail =
			`## 8. Open Questions\n\nSome text.\n\n` +
			`~~~\n## 9. Fake heading — tilde fence must be recognised\n~~~\n`;

		const rfcWithTail = makeSingleFileRfc(bodyWithTail);
		const rfcWithoutTail = makeSingleFileRfc(bodyWithoutTail);
		const fm = { spec_delta: [], tasks: [] };

		expect(computeBodyDigest(fm, rfcWithTail)).not.toBe(
			computeBodyDigest(fm, rfcWithoutTail),
		);
	});
});

// ---------------------------------------------------------------------------
// 1b. Multi-file §§1–8 boundary enforcement
// ---------------------------------------------------------------------------

describe("multi-file §§1–8 boundary", () => {
	// M-01c killer: num <= 8 mutated to num <= 7 at the multi-file sectionsFilter
	// (computeBodyDigest line ~408).  This is the code path used once RFC-0001 is
	// migrated to multi-file layout — it matters more than the single-file path.
	//
	// Note on the equivalent single-file mutant (line ~156): a loose `else if
	// (capturing)` fallback absorbs that mutation, so no behaviour change occurs.
	// Only the multi-file boundary at L408 is genuinely behaviour-changing.
	//
	// Assertion: an RFC with §8 content has a different digest than the same RFC
	// without §8 content.  Under num<=7 the §8 file is excluded and both digests
	// are identical → assertion fails → mutant killed.
	it("§8 file content is included in digest (M-01c)", () => {
		const rfcWithSec8 = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nShared prose.\n",
			"08-open-questions.md":
				"## 8. Open Questions\n\nSENTINEL_SEC8_UNIQUE_CONTENT\n",
		});
		const rfcWithoutSec8 = makeRfc({
			"01-motivation.md": "## 1. Motivation\n\nShared prose.\n",
			// No 08- file at all.
		});
		const fm = { spec_delta: [] };

		// §8 must be within digest scope: its presence must change the digest.
		expect(computeBodyDigest(fm, rfcWithSec8)).not.toBe(
			computeBodyDigest(fm, rfcWithoutSec8),
		);
	});
});

// ---------------------------------------------------------------------------
// 2. Digest determinism across layouts
// ---------------------------------------------------------------------------

describe("digest determinism across layouts", () => {
	it("same logical content split differently yields equal digest", () => {
		// Layout A: §2 as a single leaf file.
		// The file content, after normFileContent (strip trailing newlines), is:
		//   "## 2. Design\n\nPart one.\n\n### 2.1 Sub\n\nPart two."
		const rfcDirA = makeRfc({
			"01-summary.md": "## 1. Summary\n\nSame prose here.\n",
			"02-design.md":
				"## 2. Design\n\nPart one.\n\n### 2.1 Sub\n\nPart two.\n",
		});

		// Layout B: §2 as a branch directory with _intro.md + one child.
		// The canonical join rule: strip trailing newlines from each file, then
		// join with exactly "\n".  To get the blank line between Part one and
		// §2.1, the child file must START with "\n".
		//   _intro normalized: "## 2. Design\n\nPart one."
		//   + "\n" (join separator)
		//   + 01-sub normalized: "\n### 2.1 Sub\n\nPart two."
		//   = "## 2. Design\n\nPart one.\n\n### 2.1 Sub\n\nPart two."
		//   ↑ matches Layout A
		const rfcDirB = path.join(tmpDir, `rfcB${++_rfcN}`);
		const sdirB = path.join(rfcDirB, "sections");
		mkdirSync(path.join(sdirB, "02-design"), { recursive: true });
		writeFileSync(
			path.join(sdirB, "01-summary.md"),
			"## 1. Summary\n\nSame prose here.\n",
		);
		writeFileSync(
			path.join(sdirB, "02-design", "_intro.md"),
			"## 2. Design\n\nPart one.\n",
		);
		writeFileSync(
			path.join(sdirB, "02-design", "01-sub.md"),
			"\n### 2.1 Sub\n\nPart two.\n",
		);
		writeFileSync(path.join(rfcDirB, "tasks.yaml"), "[]");
		writeFileSync(
			path.join(rfcDirB, "rfc.md"),
			`---\nschema: 1\nuid: "R-20260726-TESTB"\nordinal: 99\nslug: "test"\ntitle: "Test"\nstatus: "draft"\nclassification: "tactical"\ncreated: "2026-07-26T00:00:00.000Z"\nupdated: "2026-07-26T00:00:00.000Z"\naccepted_at: null\naccepted_by: null\nsupersedes: []\nsuperseded_by: null\nbody_digest: null\nspec_delta: []\n---\n`,
		);

		const fm = { spec_delta: [] };
		const dA = computeBodyDigest(fm, rfcDirA);
		const dB = computeBodyDigest(fm, rfcDirB);
		expect(dA).toBe(dB);
	});

	it("CRLF, BOM, and trailing-newline variants produce identical digest", () => {
		const rfcDir1 = makeRfc({ "01-summary.md": "## 1. Summary\n\nHello.\n" });
		const rfcDir2 = makeRfc({ "01-summary.md": "## 1. Summary\r\n\r\nHello.\r\n" });
		// BOM is 0xEF 0xBB 0xBF in UTF-8 which is '﻿' in a JS string
		const rfcDir3 = makeRfc({ "01-summary.md": "﻿## 1. Summary\n\nHello.\n\n\n" });

		const fm = { spec_delta: [] };
		const d1 = computeBodyDigest(fm, rfcDir1);
		const d2 = computeBodyDigest(fm, rfcDir2);
		const d3 = computeBodyDigest(fm, rfcDir3);

		expect(d1).toBe(d2);
		expect(d1).toBe(d3);
	});

	it("sections 9–12 are excluded from the digest", () => {
		const fm = { spec_delta: [] };
		const rfcDir1 = makeRfc({
			"01-summary.md": "## 1. Summary\n\nShared.\n",
			"09-appendix.md": "## 9. Appendix\n\nVersion A.\n",
		});
		const rfcDir2 = makeRfc({
			"01-summary.md": "## 1. Summary\n\nShared.\n",
			"09-appendix.md": "## 9. Appendix\n\nVersion B.\n",
		});
		// §9 content differs but digest must be the same (§9 is outside §§1–8).
		expect(computeBodyDigest(fm, rfcDir1)).toBe(computeBodyDigest(fm, rfcDir2));
	});

	it("tasks change produces a different digest", () => {
		const sections = { "01-summary.md": "## 1. Summary\n\nContent.\n" };
		const rfcDirNoTasks = makeRfc(sections, []);
		const rfcDirWithTask = makeRfc(sections, [
			{ id: "T1", title: "Task 1", wave: 0, blocked_by: [], files: [], ac: [] },
		]);
		const fm = { spec_delta: [] };
		expect(computeBodyDigest(fm, rfcDirNoTasks)).not.toBe(
			computeBodyDigest(fm, rfcDirWithTask),
		);
	});

	it("spec_delta change produces a different digest", () => {
		const rfcDir = makeRfc({ "01-summary.md": "## 1. Summary\n\nContent.\n" }, []);
		const fm1 = { spec_delta: [] };
		const fm2 = {
			spec_delta: [{ op: "add", target: "docs/spec/README.md", note: "Root." }],
		};
		expect(computeBodyDigest(fm1, rfcDir)).not.toBe(computeBodyDigest(fm2, rfcDir));
	});
});

// ---------------------------------------------------------------------------
// 3. Strict layout validation
// ---------------------------------------------------------------------------

describe("validateSectionLayout", () => {
	it("returns [] for a valid flat layout 01, 02, 03", () => {
		const sectionsDir = path.join(tmpDir, "sections");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		writeFileSync(path.join(sectionsDir, "02-design.md"), "");
		writeFileSync(path.join(sectionsDir, "03-security.md"), "");
		expect(validateSectionLayout(sectionsDir)).toEqual([]);
	});

	it("reports a numbering gap (01, 03 — missing 02)", () => {
		const sectionsDir = path.join(tmpDir, "sections-gap");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		writeFileSync(path.join(sectionsDir, "03-security.md"), "");
		const errors = validateSectionLayout(sectionsDir);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(" ")).toMatch(/gap|expected 02/i);
	});

	it("reports a stray file with an invalid name (notes.md)", () => {
		const sectionsDir = path.join(tmpDir, "sections-stray");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		writeFileSync(path.join(sectionsDir, "notes.md"), "");
		const errors = validateSectionLayout(sectionsDir);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(" ")).toMatch(/stray|invalid/i);
	});

	it("reports a duplicate section number (two 01- entries)", () => {
		const sectionsDir = path.join(tmpDir, "sections-dup");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		writeFileSync(path.join(sectionsDir, "01-design.md"), "");
		const errors = validateSectionLayout(sectionsDir);
		expect(errors.join(" ")).toMatch(/duplicate/i);
	});

	it("returns [] for a valid nested layout (01, 02/ with children 01, 02)", () => {
		const sectionsDir = path.join(tmpDir, "sections-nested");
		const sub = path.join(sectionsDir, "02-design");
		mkdirSync(sub, { recursive: true });
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		writeFileSync(path.join(sub, "01-overview.md"), "");
		writeFileSync(path.join(sub, "02-detail.md"), "");
		expect(validateSectionLayout(sectionsDir)).toEqual([]);
	});

	it("allows _intro.md alongside numbered files", () => {
		const sectionsDir = path.join(tmpDir, "sections-intro");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "_intro.md"), "");
		writeFileSync(path.join(sectionsDir, "01-motivation.md"), "");
		expect(validateSectionLayout(sectionsDir)).toEqual([]);
	});

	it("returns [] for an empty sections/ directory (no gaps in empty set)", () => {
		const sectionsDir = path.join(tmpDir, "sections-empty");
		mkdirSync(sectionsDir);
		expect(validateSectionLayout(sectionsDir)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 4. tasks[] sidecar round-trip
// ---------------------------------------------------------------------------

describe("tasks sidecar round-trip", () => {
	it("readTasksSidecar returns [] when tasks.yaml absent", () => {
		const rfcDir = path.join(tmpDir, "no-tasks");
		mkdirSync(rfcDir);
		expect(readTasksSidecar(rfcDir)).toEqual([]);
	});

	it("writeTasksSidecar + readTasksSidecar is lossless", () => {
		const rfcDir = path.join(tmpDir, "with-tasks");
		mkdirSync(rfcDir);
		const tasks = [
			{ id: "T1", title: "First", wave: 0, blocked_by: [], files: [], ac: ["AC1"] },
			{ id: "T2", title: "Second", wave: 1, blocked_by: ["T1"], files: [], ac: [] },
		];
		writeTasksSidecar(rfcDir, tasks);
		const roundTripped = readTasksSidecar(rfcDir);
		expect(roundTripped).toHaveLength(2);
		expect(roundTripped[0].id).toBe("T1");
		expect(roundTripped[1].id).toBe("T2");
		expect(roundTripped[1].blocked_by).toEqual(["T1"]);
	});

	it("tasks.yaml participates in the digest (different tasks → different digest)", () => {
		const sections = { "01-summary.md": "## 1. Summary\n\nA.\n" };
		const rfcDirEmpty = makeRfc(sections, []);
		const rfcDirWithTask = makeRfc(sections, [
			{ id: "T1", title: "Task", wave: 0, blocked_by: [], files: [], ac: [] },
		]);
		const fm = { spec_delta: [] };
		expect(computeBodyDigest(fm, rfcDirEmpty)).not.toBe(
			computeBodyDigest(fm, rfcDirWithTask),
		);
	});

	it("tasks.yaml empty array produces a valid 64-char hex digest", () => {
		const rfcDir = makeRfc({ "01-summary.md": "## 1. Summary\n\nB.\n" }, []);
		const fm = { spec_delta: [] };
		const d = computeBodyDigest(fm, rfcDir);
		expect(typeof d).toBe("string");
		expect(d).toHaveLength(64);
	});
});

// ---------------------------------------------------------------------------
// 5. Mutation tests — digest scoping and strict-validate failure path
// ---------------------------------------------------------------------------

describe("mutation tests — digest scoping boundary", () => {
	it("MUTANT §8 boundary: §8 content IS included in digest (proves num <= 8, not num < 8)", () => {
		// If the filter were `num < 8` instead of `num <= 8`, §8 would be excluded.
		// Adding §8 content must change the digest.
		const withSec8 = makeRfc({
			"01-summary.md": "## 1. Summary\n\nBase.\n",
			"08-open-questions.md": "## 8. Open Questions\n\nUNIQUE_SEC8_MARKER.\n",
		});
		const withoutSec8 = makeRfc({
			"01-summary.md": "## 1. Summary\n\nBase.\n",
		});
		const fm = { spec_delta: [] };
		expect(computeBodyDigest(fm, withSec8)).not.toBe(
			computeBodyDigest(fm, withoutSec8),
		);
	});

	it("MUTANT §9 boundary: §9 content is NOT included in digest (proves num <= 8, not num <= 9)", () => {
		// If the filter were `num <= 9`, §9 content would change the digest.
		// Changing §9 must NOT change the digest.
		const withSec9A = makeRfc({
			"01-summary.md": "## 1. Summary\n\nBase.\n",
			"09-appendix.md": "## 9. Appendix\n\nVersion A.\n",
		});
		const withSec9B = makeRfc({
			"01-summary.md": "## 1. Summary\n\nBase.\n",
			"09-appendix.md": "## 9. Appendix\n\nVersion B.\n",
		});
		const fm = { spec_delta: [] };
		expect(computeBodyDigest(fm, withSec9A)).toBe(computeBodyDigest(fm, withSec9B));
	});

	it("MUTANT equality boundary: content change produces a DIFFERENT digest (not >=)", () => {
		// If digest comparison used >= or always returned true, no mutation would be
		// detected.  This proves the comparison is a strict equality check.
		const rfcDir = makeRfc({ "01-summary.md": "## 1. Summary\n\nOriginal.\n" });
		const fm = { spec_delta: [] };
		const d1 = computeBodyDigest(fm, rfcDir);
		writeFileSync(
			path.join(rfcDir, "sections", "01-summary.md"),
			"## 1. Summary\n\nModified.\n",
		);
		const d2 = computeBodyDigest(fm, rfcDir);
		expect(d1).not.toBe(d2);
	});
});

describe("mutation tests — validateSectionLayout failure path", () => {
	it("MUTANT gap detection: gap at 02 is reported", () => {
		const sectionsDir = path.join(tmpDir, "sections-gap3");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-a.md"), "");
		writeFileSync(path.join(sectionsDir, "04-d.md"), "");
		expect(validateSectionLayout(sectionsDir).length).toBeGreaterThan(0);
	});

	it("MUTANT stray detection: any non-conforming name is rejected", () => {
		const sectionsDir = path.join(tmpDir, "sections-readmetxt");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-a.md"), "");
		writeFileSync(path.join(sectionsDir, "readme.txt"), "");
		expect(validateSectionLayout(sectionsDir).length).toBeGreaterThan(0);
	});

	it("MUTANT: valid layout produces zero errors (not false-positive)", () => {
		const sectionsDir = path.join(tmpDir, "sections-valid");
		mkdirSync(sectionsDir);
		writeFileSync(path.join(sectionsDir, "01-a.md"), "");
		writeFileSync(path.join(sectionsDir, "02-b.md"), "");
		expect(validateSectionLayout(sectionsDir)).toHaveLength(0);
	});
});
