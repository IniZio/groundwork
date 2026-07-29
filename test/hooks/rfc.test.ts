/**
 * Tests for hooks/rfc.mjs
 *
 * AC coverage map:
 *   AC1  → "rfc new creates directory structure with draft status and uid"
 *   AC2  → "rfc validate exits 0 on valid frontmatter"
 *           "rfc validate exits 1 with field-named errors on invalid frontmatter"
 *   AC3  → "rfc validate reports line and column on YAML parse error"
 *   AC4  → "rfc set-status leaves bytes after closing fence unchanged"
 *   AC5  → "frontmatter serialization uses lineWidth 0 — no 80-char reflow"
 *           "rfc set-status preserves comments in frontmatter"
 *   AC6  → "rfc validate reports body_digest mismatch for review+ status"
 *   AC7  → "rfc new --supersedes sets supersedes on new and superseded_by on target atomically"
 *   AC8  → "rfc set-status refuses invalid transitions and prints permitted ones"
 *   AC9  → "rfc status prints program counter, AC coverage map, and gate history from ledger"
 *   AC10 → "rfc status prints unavailable for ledger fields when no matching ledger"
 *   AC11 → verified separately: yaml >=2.8.3 in package.json dependencies
 */

import { createHash } from "node:crypto";
import {
	execFileSync,
	execSync,
} from "node:child_process";
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

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "rfc.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-rfc-test-"));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/** Run the rfc CLI in the test project dir. */
function run(
	args: string[],
): { code: number; stdout: string; stderr: string } {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env,
			encoding: "utf8",
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: any) {
		return {
			code: e.status ?? 1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
		};
	}
}

/** Return the path to the rfcs dir. */
function rfcsDir() {
	return path.join(projectDir, ".groundwork", "rfcs");
}

/** Create a new RFC and return its directory path. */
function createRfc(slug = "test-feature", extraArgs: string[] = []) {
	const r = run(["new", slug, ...extraArgs]);
	expect(r.code).toBe(0);
	const match = r.stdout.match(/Created (.+)/);
	expect(match).toBeTruthy();
	return match![1].trim();
}

/** Read frontmatter from an RFC dir. */
function readFrontmatter(rfcDir: string) {
	const content = readFileSync(path.join(rfcDir, "rfc.md"), "utf8");
	// parse the YAML between --- fences using js-yaml (js-yaml is an existing dep)
	const match = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) throw new Error("No frontmatter found");
	// simple key extraction for tests
	return content;
}

/** Write a custom rfc.md into an RFC dir. */
function writeRfcMd(rfcDir: string, content: string) {
	writeFileSync(path.join(rfcDir, "rfc.md"), content);
}

/** Build a minimal valid rfc.md. */
function minimalRfcMd(overrides: Record<string, string> = {}) {
	const uid = overrides.uid ?? "R-20260726-K4M2QX";
	const status = overrides.status ?? "draft";
	const body_digest = overrides.body_digest ?? "null";
	return (
		`---\n` +
		`schema: 1\n` +
		`uid: ${uid}\n` +
		`ordinal: 1\n` +
		`slug: test-feature\n` +
		`title: test feature\n` +
		`status: ${status}\n` +
		`classification: tactical\n` +
		`created: "2026-07-26T00:00:00.000Z"\n` +
		`updated: "2026-07-26T00:00:00.000Z"\n` +
		`accepted_at: null\n` +
		`accepted_by: null\n` +
		`supersedes: []\n` +
		`superseded_by: null\n` +
		`body_digest: ${body_digest}\n` +
		`spec_delta: []\n` +
		`tasks: []\n` +
		`---\n` +
		`\n## 1. Summary\n\nHello\n\n## 2. Motivation\n\nWorld\n`
	);
}

// ---------------------------------------------------------------------------
// AC 1: rfc new creates correct directory structure
// ---------------------------------------------------------------------------

describe("rfc new (AC 1)", () => {
	it("creates directory structure with draft status, uid, notes/, reviews/, sections/, tasks.yaml", () => {
		const rfcDir = createRfc("my-feature");

		// Directory exists
		expect(existsSync(rfcDir)).toBe(true);
		// rfc.md exists
		expect(existsSync(path.join(rfcDir, "rfc.md"))).toBe(true);
		// notes/ directory
		expect(existsSync(path.join(rfcDir, "notes"))).toBe(true);
		// reviews/ directory
		expect(existsSync(path.join(rfcDir, "reviews"))).toBe(true);
		// sections/ directory (multi-file layout)
		expect(existsSync(path.join(rfcDir, "sections"))).toBe(true);
		// tasks.yaml sidecar
		expect(existsSync(path.join(rfcDir, "tasks.yaml"))).toBe(true);

		// S2: frontmatter moves to rfc.yaml; rfc.md is prose-only
		expect(existsSync(path.join(rfcDir, "rfc.yaml"))).toBe(true);
		const rfcYaml = readFileSync(path.join(rfcDir, "rfc.yaml"), "utf8");
		// status is draft
		expect(rfcYaml).toContain("status: draft");
		// uid matches pattern
		expect(rfcYaml).toMatch(/uid: R-\d{8}-[A-Z0-9]{6}/);
		// directory name has padded ordinal
		expect(path.basename(rfcDir)).toMatch(/^0001-my-feature$/);
		// rfc.md is prose-only — tasks key must not appear in prose
		const rfcMdContent = readFileSync(path.join(rfcDir, "rfc.md"), "utf8");
		expect(rfcMdContent).not.toMatch(/^tasks:/m);
	});

	it("scaffolds a conforming structure — rfc validate exits 0 immediately after rfc new", () => {
		const rfcDir = createRfc("scaffold-test");
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
	});

	it("assigns incrementing ordinals for successive RFCs", () => {
		const d1 = createRfc("alpha");
		const d2 = createRfc("beta");
		expect(path.basename(d1)).toMatch(/^0001-/);
		expect(path.basename(d2)).toMatch(/^0002-/);
	});

	it("exits 2 when slug is missing", () => {
		const r = run(["new"]);
		expect(r.code).toBe(2);
	});

	// M-09 killer: unknown-flag rejection removed.
	// `rfc new` must exit 2 on any unrecognised flag — this guard was absent and
	// once allowed a stray `--debug` flag to silently write a directory into the
	// live repo during a gate run.
	it("exits 2 on unknown flag (M-09)", () => {
		const r = run(["new", "my-feature", "--surprise-flag"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/unknown flag/i);
	});
});

// ---------------------------------------------------------------------------
// AC 2: rfc validate
// ---------------------------------------------------------------------------

describe("rfc validate (AC 2)", () => {
	it("exits 0 on valid frontmatter", () => {
		const rfcDir = createRfc();
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
		expect(r.stdout.trim()).toBe("OK");
	});

	it("exits 1 with field-named errors on invalid frontmatter", () => {
		mkdirSync(path.join(rfcsDir(), "0001-bad"), { recursive: true });
		writeFileSync(
			path.join(rfcsDir(), "0001-bad", "rfc.md"),
			"---\nschema: 99\nuid: INVALID\nstatus: draft\n---\n",
		);
		const r = run(["validate", path.join(rfcsDir(), "0001-bad")]);
		expect(r.code).toBe(1);
		// should report field-named errors
		expect(r.stderr).toContain("schema");
		expect(r.stderr).toContain("uid");
		// should mention missing required fields
		expect(r.stderr).toContain("missing required field");
	});

	it("exits 1 when rfc.md is missing", () => {
		mkdirSync(path.join(rfcsDir(), "0001-empty"), { recursive: true });
		const r = run(["validate", path.join(rfcsDir(), "0001-empty")]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("rfc.md not found");
	});
});

// ---------------------------------------------------------------------------
// STD7: spec_delta uses the Keep a Changelog v1.1.0 change-type vocabulary
// and the OpenAPI-Overlay field name `description` (was `note`). Hard cutover —
// the prior bespoke enum (add|modify|supersede|remove) is rejected outright.
// ---------------------------------------------------------------------------

describe("rfc validate spec_delta change types (STD7)", () => {
	function withSpecDelta(dirName: string, deltaYaml: string) {
		const dir = path.join(rfcsDir(), dirName);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			path.join(dir, "rfc.md"),
			minimalRfcMd().replace("spec_delta: []\n", `spec_delta:\n${deltaYaml}`),
		);
		return run(["validate", dir]);
	}

	for (const op of ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]) {
		it(`accepts op: ${op}`, () => {
			const r = withSpecDelta(
				`0001-op-${op.toLowerCase()}`,
				`  - op: ${op}\n    target: doc/specs/README.md\n`,
			);
			expect(r.code).toBe(0);
		});
	}

	for (const legacy of ["add", "modify", "supersede", "remove"]) {
		it(`rejects the legacy op: ${legacy} (hard cutover, no dual-accept)`, () => {
			const r = withSpecDelta(
				`0001-legacy-${legacy}`,
				`  - op: ${legacy}\n    target: doc/specs/README.md\n`,
			);
			expect(r.code).toBe(1);
			expect(r.stderr).toContain("spec_delta: op must be");
			expect(r.stderr).toContain(`got "${legacy}"`);
		});
	}

	it("rejects an unknown op", () => {
		const r = withSpecDelta(
			"0001-op-nonsense",
			"  - op: Nonsense\n    target: doc/specs/README.md\n",
		);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain('got "Nonsense"');
	});

	it("accepts an entry carrying `description`", () => {
		const r = withSpecDelta(
			"0001-desc",
			"  - op: Added\n    target: doc/specs/README.md\n    description: 'Root node.'\n",
		);
		expect(r.code).toBe(0);
	});

	it("still requires a non-empty target", () => {
		const r = withSpecDelta("0001-no-target", "  - op: Added\n");
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("non-empty target");
	});
});

// ---------------------------------------------------------------------------
// AC 3: YAML parse error reports line and column
// ---------------------------------------------------------------------------

describe("rfc validate YAML parse error (AC 3)", () => {
	it("reports line and column of a YAML parse error", () => {
		mkdirSync(path.join(rfcsDir(), "0001-broken"), { recursive: true });
		// Intentionally broken YAML: unclosed flow map causes a parse error
		const broken =
			"---\nschema: 1\nuid: R-20260726-K4M2QX\nstatus: {\n  bad: unclosed\nslug: oops\n---\n";
		writeFileSync(
			path.join(rfcsDir(), "0001-broken", "rfc.md"),
			broken,
		);
		const r = run(["validate", path.join(rfcsDir(), "0001-broken")]);
		expect(r.code).toBe(1);
		expect(r.stderr).toMatch(/line \d+/i);
		expect(r.stderr).toMatch(/column \d+/i);
	});
});

// ---------------------------------------------------------------------------
// AC 4: set-status leaves bytes after closing fence unchanged
// ---------------------------------------------------------------------------

describe("rfc set-status bytes-after-fence preservation (AC 4)", () => {
	it("leaves all bytes after the closing --- unchanged", () => {
		const rfcDir = createRfc("fence-test");
		const rfcMd = path.join(rfcDir, "rfc.md");
		const before = readFileSync(rfcMd, "utf8");
		// capture everything after the closing ---\n
		const fenceEnd = before.indexOf("\n---\n", 4);
		const bodyBefore = before.slice(fenceEnd + 5);

		run(["set-status", rfcDir, "review"]);

		const after = readFileSync(rfcMd, "utf8");
		const fenceEnd2 = after.indexOf("\n---\n", 4);
		const bodyAfter = after.slice(fenceEnd2 + 5);

		expect(bodyAfter).toBe(bodyBefore);
	});

	it("body is unchanged even if it contains special characters", () => {
		mkdirSync(path.join(rfcsDir(), "0001-special"), { recursive: true });
		const specialBody = "\n## 1. Summary\n\n```yaml\nfoo: bar\n```\n\n<!-- comment: ñöü -->\n";
		writeFileSync(
			path.join(rfcsDir(), "0001-special", "rfc.md"),
			minimalRfcMd() + specialBody,
		);
		// The minimalRfcMd already includes the body; let's build it properly
		const content = `---\nschema: 1\nuid: R-20260726-K4M2QX\nordinal: 1\nslug: special\ntitle: special\nstatus: draft\nclassification: tactical\ncreated: "2026-07-26T00:00:00.000Z"\nupdated: "2026-07-26T00:00:00.000Z"\naccepted_at: null\naccepted_by: null\nsupersedes: []\nsuperseded_by: null\nbody_digest: null\nspec_delta: []\ntasks: []\n---\n${specialBody}`;
		writeFileSync(path.join(rfcsDir(), "0001-special", "rfc.md"), content);

		const before = readFileSync(path.join(rfcsDir(), "0001-special", "rfc.md"), "utf8");
		const bodyBefore = before.slice(before.indexOf("\n---\n", 4) + 5);

		run(["set-status", path.join(rfcsDir(), "0001-special"), "review"]);

		const after = readFileSync(path.join(rfcsDir(), "0001-special", "rfc.md"), "utf8");
		const bodyAfter = after.slice(after.indexOf("\n---\n", 4) + 5);

		expect(bodyAfter).toBe(bodyBefore);
	});
});

// ---------------------------------------------------------------------------
// AC 5: lineWidth 0 and comment preservation
// ---------------------------------------------------------------------------

describe("frontmatter serialization (AC 5)", () => {
	it("serializes with lineWidth 0 — long strings are not wrapped", () => {
		const rfcDir = createRfc("linewidth-test");
		// S2: frontmatter is in rfc.yaml; set-status writes back to rfc.yaml
		const rfcYamlPath = path.join(rfcDir, "rfc.yaml");
		// Inject a very long title that would wrap at 80 chars
		const content = readFileSync(rfcYamlPath, "utf8");
		const longTitle =
			"This is a very long title that would definitely wrap at the default 80-character line width limit imposed by YAML serializers";
		const patched = content.replace(
			/^title:.*$/m,
			`title: ${longTitle}`,
		);
		writeFileSync(rfcYamlPath, patched);

		// Trigger a set-status (which serializes frontmatter back to rfc.yaml)
		run(["set-status", rfcDir, "review"]);

		const after = readFileSync(rfcYamlPath, "utf8");
		// The long title must appear entirely on one line — no wrapping
		const titleLine = after.split("\n").find((l) => l.startsWith("title:"));
		expect(titleLine).toBeDefined();
		// The entire title is on the same line as the key — no fold/continuation
		expect(titleLine).toContain(longTitle);
	});

	it("preserves YAML comments after set-status round-trip", () => {
		mkdirSync(path.join(rfcsDir(), "0001-comments"), { recursive: true });
		const withComments =
			`---\n# This is a header comment\nschema: 1\n` +
			`uid: R-20260726-K4M2QX\nordinal: 1\nslug: comments\ntitle: comments\n` +
			`status: draft\nclassification: tactical\n` +
			`created: "2026-07-26T00:00:00.000Z"\nupdated: "2026-07-26T00:00:00.000Z"\n` +
			`accepted_at: null\naccepted_by: null\n# supersedes list\nsupersedes: []\n` +
			`superseded_by: null\nbody_digest: null\nspec_delta: []\ntasks: []\n---\nBody text.\n`;
		writeFileSync(
			path.join(rfcsDir(), "0001-comments", "rfc.md"),
			withComments,
		);

		run(["set-status", path.join(rfcsDir(), "0001-comments"), "review"]);

		const after = readFileSync(
			path.join(rfcsDir(), "0001-comments", "rfc.md"),
			"utf8",
		);
		expect(after).toContain("# This is a header comment");
		expect(after).toContain("# supersedes list");
	});
});

// ---------------------------------------------------------------------------
// AC 6: body_digest mismatch detection
// ---------------------------------------------------------------------------

describe("rfc validate body_digest (AC 6)", () => {
	it("exits 0 when body_digest matches for review+ RFC", () => {
		const rfcDir = createRfc("digest-ok");
		// Move to review (stamps the digest)
		run(["set-status", rfcDir, "review"]);
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
	});

	it("reports mutation and exits 1 when body_digest mismatches for review status", () => {
		const rfcDir = createRfc("digest-bad");
		run(["set-status", rfcDir, "review"]);

		// Mutate a section file (§1 is within the digest scope §§1–8).
		// In the multi-file layout, the digest is computed from sections/; mutating
		// rfc.md body alone would not change the digest.
		const sectionFile = path.join(rfcDir, "sections", "01-summary.md");
		const sectionContent = readFileSync(sectionFile, "utf8");
		writeFileSync(sectionFile, sectionContent + "\n\nMUTATED TEXT");

		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("body_digest mismatch");
	});

	it("does not check body_digest for draft status", () => {
		const rfcDir = createRfc("digest-draft");
		// In draft, body_digest is null — no check should be done
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC 7: rfc new --supersedes
// ---------------------------------------------------------------------------

describe("rfc new --supersedes (AC 7)", () => {
	it("sets supersedes on new RFC and superseded_by on target atomically", () => {
		// Create the original RFC
		const originalDir = createRfc("original-proposal");
		// S2: frontmatter is in rfc.yaml; read uid from there
		const originalYaml = path.join(originalDir, "rfc.yaml");
		const originalContent = readFileSync(originalYaml, "utf8");
		const uidMatch = originalContent.match(/uid: (R-\d{8}-[A-Z0-9]{6})/);
		expect(uidMatch).toBeTruthy();
		const originalUid = uidMatch![1];

		// Create a new RFC that supersedes the original
		const r = run(["new", "replacement-proposal", "--supersedes", originalUid]);
		expect(r.code).toBe(0);

		// New RFC should have supersedes: [originalUid] in its rfc.yaml
		const newDirs = existsSync(path.join(rfcsDir(), "0002-replacement-proposal"));
		expect(newDirs).toBe(true);
		const newContent = readFileSync(
			path.join(rfcsDir(), "0002-replacement-proposal", "rfc.yaml"),
			"utf8",
		);
		expect(newContent).toContain(originalUid);

		// Original RFC should now have superseded_by set to new RFC's uid in rfc.yaml
		const updatedOriginal = readFileSync(originalYaml, "utf8");
		expect(updatedOriginal).toContain("superseded_by:");
		// The new uid should appear in the updated original
		const newUidMatch = newContent.match(/uid: (R-\d{8}-[A-Z0-9]{6})/);
		expect(newUidMatch).toBeTruthy();
		const newUid = newUidMatch![1];
		expect(updatedOriginal).toContain(newUid);
	});

	it("exits 1 if the --supersedes uid does not exist", () => {
		const r = run(["new", "ghost", "--supersedes", "R-20000101-FFFFFF"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not found");
	});

	it("exits 1 if the --supersedes uid has an invalid format", () => {
		const r = run(["new", "bad-uid", "--supersedes", "NOTANUID"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("valid RFC uid");
	});
});

// ---------------------------------------------------------------------------
// AC 8: transition enforcement
// ---------------------------------------------------------------------------

describe("rfc set-status transition enforcement (AC 8)", () => {
	it("allows valid transitions", () => {
		const rfcDir = createRfc("transitions");
		// draft → review
		expect(run(["set-status", rfcDir, "review"]).code).toBe(0);
		// review → accepted
		expect(run(["set-status", rfcDir, "accepted"]).code).toBe(0);
		// accepted → implementing
		expect(run(["set-status", rfcDir, "implementing"]).code).toBe(0);
		// implementing → implemented
		expect(run(["set-status", rfcDir, "implemented"]).code).toBe(0);
	});

	it("refuses invalid transition and prints permitted transitions", () => {
		const rfcDir = createRfc("bad-transition");
		// draft → implemented is not permitted
		const r = run(["set-status", rfcDir, "implemented"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not permitted");
		// §3.2 (as amended): permitted from draft are review and abandoned
		expect(r.stderr).toContain("review");
		expect(r.stderr).toContain("abandoned");
		expect(r.stderr).not.toContain("rejected");
	});

	it("refuses any transition from terminal state and says no transitions permitted", () => {
		const rfcDir = createRfc("terminal");
		// superseded is a terminal state (no outgoing edges per §3.2)
		run(["set-status", rfcDir, "review"]);
		run(["set-status", rfcDir, "superseded"]);
		const r = run(["set-status", rfcDir, "draft"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("terminal");
	});

	it("allows review → review (revision loop, §3.6)", () => {
		const rfcDir = createRfc("revision");
		run(["set-status", rfcDir, "review"]);
		const r = run(["set-status", rfcDir, "review"]);
		expect(r.code).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Owner ruling 2: draft → abandoned is PERMITTED (§3.1 diagram wins)
	// -----------------------------------------------------------------------
	it("allows draft → abandoned (owner ruling 2)", () => {
		const rfcDir = createRfc("draft-abandoned");
		const r = run(["set-status", rfcDir, "abandoned"]);
		expect(r.code).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Additional allowed transitions — full §3.2 coverage
	// -----------------------------------------------------------------------
	it("allows review → superseded", () => {
		const rfcDir = createRfc("review-superseded");
		run(["set-status", rfcDir, "review"]);
		const r = run(["set-status", rfcDir, "superseded"]);
		expect(r.code).toBe(0);
	});

	it("allows accepted → abandoned", () => {
		const rfcDir = createRfc("accepted-abandoned");
		run(["set-status", rfcDir, "review"]);
		run(["set-status", rfcDir, "accepted"]);
		const r = run(["set-status", rfcDir, "abandoned"]);
		expect(r.code).toBe(0);
	});

	it("allows implementing → abandoned", () => {
		const rfcDir = createRfc("implementing-abandoned");
		run(["set-status", rfcDir, "review"]);
		run(["set-status", rfcDir, "accepted"]);
		run(["set-status", rfcDir, "implementing"]);
		const r = run(["set-status", rfcDir, "abandoned"]);
		expect(r.code).toBe(0);
	});

	it("allows implemented → superseded", () => {
		const rfcDir = createRfc("implemented-superseded");
		run(["set-status", rfcDir, "review"]);
		run(["set-status", rfcDir, "accepted"]);
		run(["set-status", rfcDir, "implementing"]);
		run(["set-status", rfcDir, "implemented"]);
		const r = run(["set-status", rfcDir, "superseded"]);
		expect(r.code).toBe(0);
	});

	it("allows abandoned → superseded", () => {
		const rfcDir = createRfc("abandoned-superseded");
		run(["set-status", rfcDir, "abandoned"]);
		const r = run(["set-status", rfcDir, "superseded"]);
		expect(r.code).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Owner ruling 1: rejected is TERMINAL — rejected → superseded REFUSED
	// -----------------------------------------------------------------------
	it("refuses rejected → superseded (owner ruling 1: rejected is terminal)", () => {
		const rfcDir = createRfc("rejected-terminal");
		run(["set-status", rfcDir, "review"]);
		run(["set-status", rfcDir, "rejected"]);
		const r = run(["set-status", rfcDir, "superseded"]);
		expect(r.code).toBe(1);
		// Must mention terminal, not just "not permitted"
		expect(r.stderr).toContain("terminal");
	});

	// -----------------------------------------------------------------------
	// draft → rejected still REFUSED (no §3.2 row for this transition)
	// -----------------------------------------------------------------------
	it("refuses draft → rejected (no such transition)", () => {
		const rfcDir = createRfc("draft-rejected");
		const r = run(["set-status", rfcDir, "rejected"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not permitted");
		// permitted from draft: review, abandoned
		expect(r.stderr).toContain("review");
		expect(r.stderr).toContain("abandoned");
	});

	it("exits 2 on unknown status", () => {
		const rfcDir = createRfc("unknown-status");
		const r = run(["set-status", rfcDir, "flibbertigibbet"]);
		expect(r.code).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// AC 9: rfc status derives fields from ledger and journal
// ---------------------------------------------------------------------------

describe("rfc status with ledger (AC 9)", () => {
	it("prints program counter, per-task status, AC coverage map, and gate history", () => {
		// Create RFC with tasks
		const rfcDir = createRfc("with-ledger");
		// S2: frontmatter (including uid) is in rfc.yaml
		const uid = readFileSync(path.join(rfcDir, "rfc.yaml"), "utf8").match(/uid: (R-\d{8}-[A-Z0-9]{6})/)![1];

		// Write tasks to tasks.yaml sidecar (tasks no longer live in frontmatter).
		const tasksYaml =
			`- id: T1\n  title: Implement core\n  wave: 0\n  blocked_by: []\n  files: []\n  ac: [AC1, AC2]\n` +
			`- id: T2\n  title: Write tests\n  wave: 1\n  blocked_by: [T1]\n  files: []\n  ac: [AC1]\n`;
		writeFileSync(path.join(rfcDir, "tasks.yaml"), tasksYaml);

		// Write a run ledger with rfc_ref
		const runsDir = path.join(projectDir, ".groundwork", "runs");
		mkdirSync(runsDir, { recursive: true });
		const ledger = {
			version: 1,
			active: true,
			session_id: "sess-rfc",
			rfc_ref: uid,
			brief: "RFC impl run",
			slices: [
				{ id: "T1", name: "Implement core", wave: 0, status: "complete", blocked_by: [], acceptance: ["AC1", "AC2"] },
				{ id: "T2", name: "Write tests", wave: 1, status: "pending", blocked_by: ["T1"], acceptance: ["AC1"] },
			],
			gate: { advisor: "pending" },
		};
		writeFileSync(path.join(runsDir, "sess-rfc.json"), JSON.stringify(ledger, null, 2));

		// Write a journal entry
		const journalDir = path.join(projectDir, ".groundwork", "journal");
		mkdirSync(journalDir, { recursive: true });
		const journalEntry = {
			ts: "2026-07-26T10:00:00Z",
			session: "sess-rfc",
			rfc: uid,
			type: "TASK_COMPLETE",
			msg: "T1 complete",
			data: {},
		};
		writeFileSync(
			path.join(journalDir, "2026-07-26-sess-rfc.jsonl"),
			JSON.stringify(journalEntry) + "\n",
		);

		const r = run(["status", rfcDir]);
		expect(r.code).toBe(0);

		// Program counter (tasks)
		expect(r.stdout).toContain("T1");
		expect(r.stdout).toContain("T2");

		// AC coverage map
		expect(r.stdout).toContain("AC coverage map:");
		expect(r.stdout).toContain("AC1");
		expect(r.stdout).toContain("AC2");

		// Ledger-derived status
		expect(r.stdout).toContain("Run ledger(s): 1");
		expect(r.stdout).toContain("complete");

		// Per-task status mapping (AC 9): T2 must be pending, not complete
		expect(r.stdout).toContain("T2");
		expect(r.stdout).toContain("pending");
		// Negative: T2 slice is pending in the ledger; must not be reported complete
		expect(r.stdout).not.toMatch(/T2.*complete|complete.*T2/);

		// Gate history from journal
		expect(r.stdout).toContain("TASK_COMPLETE");
	});
});

// ---------------------------------------------------------------------------
// AC 10: rfc status with no matching ledger
// ---------------------------------------------------------------------------

describe("rfc status no matching ledger (AC 10)", () => {
	it("prints frontmatter fields and reports ledger fields as unavailable, exits 0", () => {
		const rfcDir = createRfc("no-ledger");
		const r = run(["status", rfcDir]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("unavailable");
		// Frontmatter-derived fields still shown
		expect(r.stdout).toContain("status:");
		expect(r.stdout).toContain("ordinal:");
	});
});

// ---------------------------------------------------------------------------
// AC 11: yaml declared as direct dependency in package.json
// ---------------------------------------------------------------------------

describe("yaml direct dependency (AC 11)", () => {
	it("declares yaml >=2.8.3 as a direct dependency in package.json", () => {
		const pkgJson = JSON.parse(
			readFileSync(
				path.resolve(import.meta.dirname, "..", "..", "package.json"),
				"utf8",
			),
		);
		expect(pkgJson.dependencies).toHaveProperty("yaml");
		const ver = pkgJson.dependencies.yaml as string;
		// Must be >=2.8.3 or ^2.8.3 or similar — just check the version number is >= 2.8.3
		expect(ver).toMatch(/2\.(8|9|[1-9]\d)\./);
	});
});

// ---------------------------------------------------------------------------
// Help and usage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Schema-keyed strict layout validation (guard-narrowing fix)
// Kills M-07 (entire strict path was skipped) and M-08 (tasks.yaml check absent).
// Also kills the boundary mutant (>= 2 vs >= 3).
// ---------------------------------------------------------------------------

describe("rfc validate strict layout (schema >= 2)", () => {
	it("rfc new writes schema: 2 — new RFCs are strict from birth", () => {
		const rfcDir = createRfc("strict-birth");
		// S2: frontmatter (including schema) is in rfc.yaml
		const content = readFileSync(path.join(rfcDir, "rfc.yaml"), "utf8");
		// Extract schema value from sidecar
		const m = content.match(/^schema: (\d+)$/m);
		expect(m).toBeTruthy();
		expect(Number(m![1])).toBe(2);
	});

	// M-07 killer: proves the strict path actually executes for schema: 2.
	// If the gate were `if (false && ...)` or keyed on existsSync(sectionsDir),
	// a schema:2 RFC with no sections/ would pass — this test would fail.
	// Also kills the boundary mutant `>= 3`: schema:2 must trigger strict.
	it("exits 1 when schema: 2 RFC is missing sections/ (single-file schema-2 is non-conformant)", () => {
		const rfcDir = createRfc("missing-sections");
		// Remove sections/ to simulate a single-file schema-2 RFC.
		rmSync(path.join(rfcDir, "sections"), { recursive: true, force: true });
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("sections/");
	});

	// M-08 killer: proves the tasks.yaml check fires for schema: 2.
	// If the tasks.yaml check were removed, this test would see exit 0.
	it("exits 1 when schema: 2 RFC has sections/ but tasks.yaml is missing", () => {
		const rfcDir = createRfc("missing-tasks");
		// Remove tasks.yaml to simulate a schema-2 RFC without the required sidecar.
		rmSync(path.join(rfcDir, "tasks.yaml"), { force: true });
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("tasks.yaml");
	});

	// Boundary: schema:1 (lenient) with no sections/ must NOT trigger strict errors.
	// Proves the gate is < 2 lenient, not accidentally strict for all RFCs.
	it("exits 0 for schema: 1 RFC with no sections/ (legacy/lenient path)", () => {
		// Use rfc new output as base, then downgrade to schema: 1 and remove sections/.
		// S2: schema field lives in rfc.yaml; patch there.
		const rfcDir = createRfc("legacy-lenient");
		const rfcYamlPath = path.join(rfcDir, "rfc.yaml");
		const content = readFileSync(rfcYamlPath, "utf8");
		// Patch schema: 2 → schema: 1 and remove sections/.
		const patched = content.replace(/^schema: 2$/m, "schema: 1");
		writeFileSync(rfcYamlPath, patched);
		rmSync(path.join(rfcDir, "sections"), { recursive: true, force: true });
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
	});

	// schema: 2 with full layout intact passes — confirms the gate does not
	// unconditionally fail all schema-2 RFCs.
	it("exits 0 for a fully conformant schema: 2 RFC (sections/ + tasks.yaml present)", () => {
		const rfcDir = createRfc("full-conformant");
		const r = run(["validate", rfcDir]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("OK");
	});
});

// ---------------------------------------------------------------------------
// Help and usage
// ---------------------------------------------------------------------------

describe("help", () => {
	it("exits 0 with usage text when called with no args", () => {
		const r = run([]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Usage:");
	});

	it("exits 0 with usage text for help command", () => {
		const r = run(["help"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("rfc new");
	});

	it("exits 2 for unknown command", () => {
		const r = run(["nonexistent"]);
		expect(r.code).toBe(2);
	});
});
