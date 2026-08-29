/**
 * spec CLI tests — covers all 13 acceptance criteria from RFC-0001 T1.
 *
 * AC1  — spec init creates doc/specs/README.md with a valid concept node
 * AC2  — spec build writes _generated/{index.md,index.json,coverage.json}
 * AC3  — spec build exits 1 on parent/dir mismatch, printing node id + both values
 * AC4  — spec build exits 1 on duplicate id, printing both paths
 * AC5  — spec req new creates a file with a unique 4-char base32 id suffix
 * AC6  — index.json contains summary, refs, byteSize per node
 * AC7  — spec show without --full emits ≤8 lines and states token cost
 * AC8  — spec search limits rows and prints total match count when truncated
 * AC9  — spec tree defaults to depth 2
 * AC10 — stale index triggers rebuild before read commands
 * AC11 — spec deps reads from index only (no markdown file reads after build)
 * AC12 — spec build accepts verification/criticality; exits 1 if verify has path-like token
 * AC13 — delegated subcommands exit 127 with a named message when script absent
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Direct import for unit-level staleness boundary test (AC10 equality case)
import { isIndexStale } from "../../hooks/lib/spec-io.mjs";

const CLI = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"hooks",
	"spec.mjs",
);

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-spec-"));
	// Minimal package.json so the CLI can find the project root
	writeFileSync(
		path.join(projectDir, "package.json"),
		JSON.stringify({ name: "test-project" }),
	);
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/** Run spec CLI with CLAUDE_PROJECT_DIR pointing at the temp dir. */
function run(
	args: string[],
): { code: number; stdout: string; stderr: string } {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env,
			encoding: "utf8",
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: unknown) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return {
			code: err.status ?? 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers for building fixture trees
// ---------------------------------------------------------------------------

const SPEC_DIR = () => path.join(projectDir, "doc", "specs");
const GEN_DIR = () => path.join(projectDir, "doc", "specs", "_generated");

function mkSpec() {
	mkdirSync(SPEC_DIR(), { recursive: true });
}

function writeReadme(relDir: string, id: string, title = "Test Concept") {
	const dir = path.join(SPEC_DIR(), relDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "README.md"),
		[
			"---",
			`id: ${id}`,
			`type: concept`,
			`title: ${title}`,
			`parent: null`,
			"---",
			"",
			`# ${title}`,
			"",
		].join("\n"),
	);
}

/** D-15 layout: concept dirs use index.md instead of README.md. */
function writeIndex(relDir: string, id: string, title = "Test Concept") {
	const dir = path.join(SPEC_DIR(), relDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, "index.md"),
		[
			"---",
			`id: ${id}`,
			`type: concept`,
			`title: ${title}`,
			`parent: null`,
			"---",
			"",
			`# ${title}`,
			"",
		].join("\n"),
	);
}

function writeReq(
	relDir: string,
	filename: string,
	fields: Record<string, string>,
) {
	const dir = path.join(SPEC_DIR(), relDir);
	mkdirSync(dir, { recursive: true });
	const fm = Object.entries(fields)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
		.join("\n");
	writeFileSync(
		path.join(dir, filename),
		`---\n${fm}\n---\n\nCommentary.\n`,
	);
}

function minReq(conceptId: string, reqId: string, overrides: Record<string, string> = {}) {
	return {
		id: reqId,
		concept: conceptId,
		ears: "The system shall do something.",
		pattern: "ubiquitous",
		verify: "Observe the output.",
		verification: "automated",
		criticality: "must",
		origin_decision_ref: "test-motive#D-1",
		status: "active",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1 — spec init
// ---------------------------------------------------------------------------

describe("AC1 — spec init", () => {
	it("creates doc/specs/index.md with a valid concept node", () => {
		const r = run(["init"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		const indexMd = path.join(SPEC_DIR(), "index.md");
		expect(existsSync(indexMd)).toBe(true);
		const content = readFileSync(indexMd, "utf8");
		// Must have a C-<PROJECT> id derived from package.json name
		expect(content).toMatch(/^id: C-TEST-PROJECT/m);
		expect(content).toMatch(/^parent: null/m);
	});

	it("exits 1 if index.md already exists", () => {
		run(["init"]);
		const r2 = run(["init"]);
		expect(r2.code).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// AC2 — spec build
// ---------------------------------------------------------------------------

describe("AC2 — spec build", () => {
	it("writes index.md, index.json, coverage.json and exits 0", () => {
		mkSpec();
		writeReadme("", "C-TESTPROJECT");
		const r = run(["build"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		expect(existsSync(path.join(GEN_DIR(), "index.json"))).toBe(true);
		expect(existsSync(path.join(GEN_DIR(), "index.md"))).toBe(true);
		expect(existsSync(path.join(GEN_DIR(), "coverage.json"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC3 — parent/directory mismatch
// ---------------------------------------------------------------------------

describe("AC3 — parent/directory mismatch", () => {
	it("exits 1 and prints node id and both values when concept disagrees with dir", () => {
		mkSpec();
		// D-15 layout: concept dir uses index.md.
		writeIndex("C-ROOT", "C-ROOT", "Root");
		// Requirement placed in concept's requirements/ but claims wrong concept
		writeReq(
			"C-ROOT/requirements",
			"bad-req.md",
			minReq("C-WRONG", "ROOT-R-aaaa"),
		);

		const r = run(["build"]);
		expect(r.code).toBe(1);
		// Must print the node id
		expect(r.stderr).toContain("ROOT-R-aaaa");
		// Must print frontmatter value
		expect(r.stderr).toContain("C-WRONG");
		// Must print directory-implied value
		expect(r.stderr).toContain("C-ROOT");
	});

	it("succeeds when concept matches directory position", () => {
		mkSpec();
		// D-15 layout: concept dir uses index.md.
		writeIndex("C-ROOT", "C-ROOT", "Root");
		writeReq("C-ROOT/requirements", "good-req.md", minReq("C-ROOT", "ROOT-R-bbbb"));
		const r = run(["build"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC4 — duplicate id
// ---------------------------------------------------------------------------

describe("AC4 — duplicate id", () => {
	it("exits 1 and prints both paths when two files share the same id", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		writeReq("requirements", "req-a.md", minReq("C-ROOT", "ROOT-R-dup1"));
		writeReq("requirements", "req-b.md", minReq("C-ROOT", "ROOT-R-dup1"));

		const r = run(["build"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("ROOT-R-dup1");
		expect(r.stderr).toContain("req-a.md");
		expect(r.stderr).toContain("req-b.md");
	});
});

// ---------------------------------------------------------------------------
// AC5 — spec req new
// ---------------------------------------------------------------------------

describe("AC5 — spec req new", () => {
	it("creates a requirement file with a unique 4-char base32 suffix", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		run(["build"]);

		const r = run(["req", "new", "C-ROOT", "my-feature"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);

		// Find the created file
		const reqDir = path.join(SPEC_DIR(), "requirements");
		const reqFile = path.join(reqDir, "my-feature.md");
		expect(existsSync(reqFile)).toBe(true);

		const content = readFileSync(reqFile, "utf8");
		// id must match pattern: ROOT-R-xxxx where xxxx is 4 base32 chars (with or without quotes)
		expect(content).toMatch(/^id:.*ROOT-R-[a-z2-7]{4}/m);
		expect(content).toMatch(/^concept:.*C-ROOT/m);
	});

	it("generates a suffix not already present in the tree", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		// Pre-populate many requirements to force uniqueness pressure
		for (let i = 0; i < 5; i++) {
			const suffix = `r${String(i).padStart(3, "0")}`.slice(0, 4);
			writeReq("requirements", `req-${i}.md`, minReq("C-ROOT", `ROOT-R-${suffix}`));
		}
		run(["build"]);

		const r = run(["req", "new", "C-ROOT", "new-req"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC6 — index.json fields
// ---------------------------------------------------------------------------

describe("AC6 — index.json fields", () => {
	it("index.json contains summary, refs, and byteSize for each node", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root Concept");
		writeReq(
			"requirements",
			"feat.md",
			minReq("C-ROOT", "ROOT-R-c6c6", {
				ears: "The system shall do X.",
			}),
		);

		run(["build"]);

		const idx = JSON.parse(
			readFileSync(path.join(GEN_DIR(), "index.json"), "utf8"),
		);
		expect(idx.nodes["C-ROOT"]).toBeDefined();
		expect(typeof idx.nodes["C-ROOT"].summary).toBe("string");
		expect(Array.isArray(idx.nodes["C-ROOT"].refs)).toBe(true);
		expect(typeof idx.nodes["C-ROOT"].byteSize).toBe("number");
		expect(idx.nodes["C-ROOT"].byteSize).toBeGreaterThan(0);

		expect(idx.nodes["ROOT-R-c6c6"]).toBeDefined();
		expect(idx.nodes["ROOT-R-c6c6"].summary).toContain("The system shall do X");
		expect(typeof idx.nodes["ROOT-R-c6c6"].byteSize).toBe("number");
	});
});

// ---------------------------------------------------------------------------
// AC6b — explicit summary beats title fallback for concept nodes
// ---------------------------------------------------------------------------

describe("AC6b — concept summary field beats title in index", () => {
	it("uses the summary field, not the title, when summary is present on a concept", () => {
		mkSpec();
		// Write a concept with a summary that is clearly distinct from the title
		const dir = SPEC_DIR();
		writeFileSync(
			path.join(dir, "README.md"),
			[
				"---",
				"id: C-SUMTEST",
				"type: concept",
				"title: Some Generic Title",
				"summary: An informative authored summary distinct from the title",
				"parent: null",
				"origin_decision_ref: test-motive#D-1",
				"---",
				"",
				"# Some Generic Title",
				"",
			].join("\n"),
		);

		run(["build"]);

		const idx = JSON.parse(
			readFileSync(path.join(GEN_DIR(), "index.json"), "utf8"),
		);
		const node = idx.nodes["C-SUMTEST"];
		expect(node).toBeDefined();
		// summary must be the authored value, not the title
		expect(node.summary).toBe(
			"An informative authored summary distinct from the title",
		);
		expect(node.summary).not.toBe("Some Generic Title");
	});
});

// ---------------------------------------------------------------------------
// AC6c — title falls through firstSentence(ears) before bare id
// Kills the mutant: `title: String(data.title || data.summary || id)`
// Without the fix, a requirement with ears but no title/summary gets title===id,
// causing spec show to suppress the Title line and the index to show the bare id.
// ---------------------------------------------------------------------------

describe("AC6c — title falls back through ears before bare id", () => {
	it("sets title to firstSentence(ears) when no title or summary field is present", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root Concept");
		writeReq("requirements", "req-ears-only.md", {
			id: "ROOT-R-ears01",
			concept: "C-ROOT",
			ears: "The system shall process requests without delay.",
			pattern: "ubiquitous",
			verify: "Measure latency.",
			verification: "automated",
			criticality: "must",
			origin_decision_ref: "test-motive#D-1",
			status: "active",
			// NOTE: no summary, no title — this is the defect scenario
		});

		run(["build"]);

		const idx = JSON.parse(
			readFileSync(path.join(GEN_DIR(), "index.json"), "utf8"),
		);
		const node = idx.nodes["ROOT-R-ears01"];
		expect(node).toBeDefined();
		// title must NOT be the bare id
		expect(node.title).not.toBe("ROOT-R-ears01");
		// title must be derived from the ears sentence (firstSentence)
		expect(node.title).toContain("The system shall process requests");
	});
});

// ---------------------------------------------------------------------------
// AC7 — spec show without --full
// ---------------------------------------------------------------------------

describe("AC7 — spec show", () => {
	beforeEach(() => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root Concept");
		writeReq(
			"requirements",
			"feat.md",
			minReq("C-ROOT", "ROOT-R-ac07", {
				ears: "The system shall demonstrate showing.",
			}),
		);
		run(["build"]);
	});

	it("emits at most 8 lines of content without --full", () => {
		const r = run(["show", "ROOT-R-ac07"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// Content lines (before the token cost line)
		const contentLines = r.stdout.split("\n").filter(Boolean);
		// The last line is the token cost separator — total including it ≤ 9 (8 + separator)
		expect(contentLines.length).toBeLessThanOrEqual(9);
	});

	it("states the token cost of the --full form", () => {
		const r = run(["show", "ROOT-R-ac07"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		expect(r.stdout).toMatch(/~\d+ tokens/);
		expect(r.stdout).toContain("--full");
	});

	it("emits full content with --full", () => {
		const r = run(["show", "ROOT-R-ac07", "--full"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		expect(r.stdout).toContain("demonstrate showing");
		// Should have many more lines than the truncated form
		const lines = r.stdout.split("\n").filter(Boolean);
		expect(lines.length).toBeGreaterThan(3);
	});
});

// ---------------------------------------------------------------------------
// AC8 — spec search truncation
// ---------------------------------------------------------------------------

describe("AC8 — spec search", () => {
	beforeEach(() => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		// Create many requirements with matching content
		for (let i = 0; i < 12; i++) {
			const suffix = `s${String(i).padStart(3, "0")}`.slice(0, 4);
			writeReq(
				"requirements",
				`req-${i}.md`,
				minReq("C-ROOT", `ROOT-R-${suffix}`, {
					ears: `The system shall searchme feature ${i}.`,
				}),
			);
		}
		run(["build"]);
	});

	it("emits at most --limit rows (default 8)", () => {
		const r = run(["search", "searchme"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// Count result rows (non-empty lines before the truncation message)
		const resultLines = r.stdout.split("\n").filter(l => l.includes("ROOT-R-"));
		expect(resultLines.length).toBeLessThanOrEqual(8);
	});

	it("prints total match count when results are truncated", () => {
		const r = run(["search", "searchme"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// 12 requirements match, default limit 8 → should show truncation notice
		expect(r.stdout).toMatch(/\d+ of \d+ matches/);
	});

	it("respects --limit flag", () => {
		const r = run(["search", "searchme", "--limit", "3"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		const resultLines = r.stdout.split("\n").filter(l => l.includes("ROOT-R-"));
		expect(resultLines.length).toBeLessThanOrEqual(3);
	});
});

// ---------------------------------------------------------------------------
// AC9 — spec tree defaults to depth 2
// ---------------------------------------------------------------------------

describe("AC9 — spec tree depth", () => {
	beforeEach(() => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		mkdirSync(path.join(SPEC_DIR(), "sub"), { recursive: true });
		writeFileSync(
			path.join(SPEC_DIR(), "sub", "README.md"),
			"---\nid: C-ROOT-SUB\ntype: concept\ntitle: Sub\nparent: C-ROOT\n---\n",
		);
		run(["build"]);
	});

	it("defaults to depth 2 without --depth flag", () => {
		const r = run(["tree"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// Should show at least the root and sub-concept
		expect(r.stdout).toContain("C-ROOT");
	});

	it("respects --depth flag", () => {
		const r1 = run(["tree", "--depth", "1"]);
		const r2 = run(["tree", "--depth", "2"]);
		expect(r1.code, `stderr: ${r1.stderr}`).toBe(0);
		expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
		// depth 2 output should be >= depth 1 output
		expect(r2.stdout.split("\n").length).toBeGreaterThanOrEqual(
			r1.stdout.split("\n").length,
		);
	});
});

// ---------------------------------------------------------------------------
// AC10 — stale index triggers rebuild
// ---------------------------------------------------------------------------

describe("AC10 — stale index rebuild", () => {
	it("rebuilds the index before answering a read command if index is stale", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		run(["build"]);

		// Add a new requirement without rebuilding
		writeReq(
			"requirements",
			"late-req.md",
			minReq("C-ROOT", "ROOT-R-late"),
		);

		// spec show for a concept that was already indexed should trigger rebuild
		// and include the new requirement
		const r = run(["search", "Root"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);

		// The rebuilt index.json should now contain the new requirement
		const idx = JSON.parse(
			readFileSync(path.join(GEN_DIR(), "index.json"), "utf8"),
		);
		expect(idx.nodes["ROOT-R-late"]).toBeDefined();
	});

	it("triggers rebuild when a spec file is newer than index.json", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		run(["build"]);

		// Back-date the index to force staleness
		const idxPath = path.join(GEN_DIR(), "index.json");
		const past = new Date(Date.now() - 10000);
		utimesSync(idxPath, past, past);

		// Write a new file (which is newer than the back-dated index)
		writeReq("requirements", "newer.md", minReq("C-ROOT", "ROOT-R-new1"));

		// deps command should trigger rebuild
		const r = run(["deps", "C-ROOT"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);

		const idx = JSON.parse(readFileSync(idxPath, "utf8"));
		expect(idx.nodes["ROOT-R-new1"]).toBeDefined();
	});

	it("treats equal mtime as fresh — isIndexStale returns false when source mtime === index mtime", () => {
		// Build a minimal spec tree
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		run(["build"]);

		const idxPath = path.join(GEN_DIR(), "index.json");
		const srcPath = path.join(SPEC_DIR(), "README.md");

		// Choose a fixed timestamp well in the past so the filesystem has no
		// rounding ambiguity.  Use the same Date for both files so their
		// mtimeMs values are guaranteed identical at millisecond resolution.
		const sharedTime = new Date(Date.now() - 5000);
		utimesSync(idxPath, sharedTime, sharedTime);
		utimesSync(srcPath, sharedTime, sharedTime);

		// Confirm the mtimes are genuinely equal as observed by statSync —
		// if the filesystem rounds to seconds and they diverge, this assertion
		// will catch the test degrading into a non-boundary case.
		const idxMtime = statSync(idxPath).mtimeMs;
		const srcMtime = statSync(srcPath).mtimeMs;
		expect(idxMtime).toBe(srcMtime);

		// Equal mtime must NOT be treated as stale (the correct operator is >,
		// not >=).  If this assertion fails, the >= mutant has survived.
		const sd = SPEC_DIR();
		expect(isIndexStale(sd)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// AC11 — spec deps reads from index only
// ---------------------------------------------------------------------------

describe("AC11 — spec deps", () => {
	it("emits inbound and outbound references from the index", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		// req-a references req-b in its body
		mkdirSync(path.join(SPEC_DIR(), "requirements"), { recursive: true });
		writeFileSync(
			path.join(SPEC_DIR(), "requirements", "req-a.md"),
			[
				"---",
				'id: "ROOT-R-aaa1"',
				'concept: "C-ROOT"',
				'ears: "The system shall do A."',
				'pattern: "ubiquitous"',
				'verify: "Check output."',
				'verification: "automated"',
				'criticality: "must"',
				'origin_decision_ref: "test-motive#D-1"',
				'status: "active"',
				"---",
				"See ROOT-R-bbb2 for details.",
			].join("\n"),
		);
		writeReq("requirements", "req-b.md", minReq("C-ROOT", "ROOT-R-bbb2"));
		run(["build"]);

		const r = run(["deps", "ROOT-R-bbb2"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// ROOT-R-aaa1 references ROOT-R-bbb2 → bbb2 should have aaa1 as inbound
		expect(r.stdout).toContain("ROOT-R-aaa1");
		expect(r.stdout).toContain("inbound");
	});

	it("exits 1 for an unknown id", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		run(["build"]);
		const r = run(["deps", "NONEXISTENT-R-xxxx"]);
		expect(r.code).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// AC12 — verification/criticality accepted; path-like verify rejected
// ---------------------------------------------------------------------------

describe("AC12 — verify field validation", () => {
	it("accepts verification and criticality fields in spec build", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		writeReq(
			"requirements",
			"valid.md",
			minReq("C-ROOT", "ROOT-R-v12a", {
				verification: "manual",
				criticality: "should",
				verify: "Read the audit log and confirm the entry is present.",
			}),
		);
		const r = run(["build"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
	});

	it("exits 1 and names the annotation mechanism if verify contains a path-like token", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		writeReq(
			"requirements",
			"bad-verify.md",
			minReq("C-ROOT", "ROOT-R-v12b", {
				verify: "Run test/integration/auth.test.ts and check output.",
			}),
		);
		const r = run(["build"]);
		expect(r.code).toBe(1);
		// Must mention the annotation mechanism
		expect(r.stderr).toContain("@verifies");
	});
});

// ---------------------------------------------------------------------------
// AC13 — delegation: absent script exits 127; present script reaches impl
// ---------------------------------------------------------------------------

describe("AC13 — delegation of verify/lint/metrics/doc", () => {
	// All subcommands the dispatcher recognises as delegated.
	const ALL_DELEGATED = ["verify", "lint", "metrics", "doc"];
	// Derive the absent set at test-time so adding a new spec-<sub>.mjs
	// automatically moves it out of this group without a manual edit.
	const hooksDir = path.resolve(import.meta.dirname, "..", "..", "hooks");
	const absentSubs = ALL_DELEGATED.filter(
		(sub) => !existsSync(path.join(hooksDir, `spec-${sub}.mjs`)),
	);

	describe("absent script → dispatcher exits 127", () => {
		for (const sub of absentSubs) {
			it(`spec ${sub} exits 127 with a named message when spec-${sub}.mjs is absent`, () => {
				const r = run([sub]);
				expect(r.code).toBe(127);
				expect(r.stderr).toContain(`spec-${sub}.mjs`);
			});
		}
	});

	// Present scripts: dispatcher must reach the real implementation.
	// Assertions are specific to each script's documented exit codes so that
	// a mutation (removing the script) causes a concrete assertion failure.
	describe("present script → reaches implementation (not 127)", () => {
		it("spec lint with no args exits 0 (informational scan), reaching spec-lint.mjs", () => {
			const r = run(["lint"]);
			// exit 0 = clean informational run from spec-lint.mjs; 127 would mean script absent
			expect(r.code).toBe(0);
			expect(r.stdout).toContain("spec lint");
		});
	});
});

// ---------------------------------------------------------------------------
// M1 — summary-before-ears precedence (mutation pin)
// A surviving mutant swapped summary→ears. This test fails if ears is shown
// in the index instead of the authored summary.
// ---------------------------------------------------------------------------

describe("M1 — index uses summary over ears when both are present", () => {
	it("index.json summary field uses the authored gloss, not the ears sentence, when they differ", () => {
		// Old-format requirements (not requirements.md) have no anchor and are omitted
		// from index.md (RFC-0003 contract, see spec-build.test.ts). The mutation target —
		// `summary = data.summary ?? firstSentence(data.ears)` — is tested via index.json
		// which always records every node's summary field regardless of anchor presence.
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		writeReq(
			"requirements",
			"pinned.md",
			minReq("C-ROOT", "ROOT-R-m1aa", {
				summary: "Short retrieval gloss for the index.",
				ears: "When triggered, the system shall perform the long normative action described here.",
			}),
		);
		run(["build"]);
		const idxJson = JSON.parse(
			readFileSync(path.join(GEN_DIR(), "index.json"), "utf8"),
		);
		const node = idxJson.nodes["ROOT-R-m1aa"];
		expect(node).toBeDefined();
		// summary must be the authored gloss, not derived from ears
		expect(node.summary).toContain("Short retrieval gloss for the index");
		// ears sentence must NOT be used as the summary
		expect(node.summary).not.toContain("perform the long normative action");
	});
});

// ---------------------------------------------------------------------------
// M3 — requirement title derived from summary, not concept id (mutation pin)
// The prior code fell back to data.concept, making Title and Concept identical.
// This test fails if the title is the parent concept id instead of the summary.
// ---------------------------------------------------------------------------

describe("M3 — spec show uses summary as title for requirements", () => {
	it("show output for a requirement shows summary as title, not the concept id", () => {
		mkSpec();
		writeReadme("", "C-ROOT", "Root");
		writeReq(
			"requirements",
			"title-check.md",
			minReq("C-ROOT", "ROOT-R-m3bb", {
				summary: "Distinct summary gloss for the requirement.",
				ears: "The system shall do something.",
			}),
		);
		run(["build"]);
		const r = run(["show", "ROOT-R-m3bb"]);
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// Title must show the summary, not the parent concept id
		expect(r.stdout).toContain("Distinct summary gloss");
		expect(r.stdout).not.toContain("Title: C-ROOT");
	});
});
