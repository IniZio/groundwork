/**
 * pi-skills-sync — verifies that scripts/check-pi-skills.mjs correctly
 * detects byte-level drift between .pi/skills/ copies and their authority
 * sources declared in the MANIFEST.
 *
 * Tests run against mkdtemp-pinned temp trees; they never touch the live
 * .pi/skills/ or skills/groundwork/ directories.
 */

import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CHECK_MJS = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"scripts",
	"check-pi-skills.mjs",
);

/** The first entry in the MANIFEST — used as the mutation target. */
const MANIFEST_FIRST = {
	pi: ".pi/skills/use-groundwork/SKILL.md",
	authority: "skills/groundwork/use-groundwork/SKILL.md",
};

function run(piRoot: string, authorityRoot: string): { code: number; out: string } {
	try {
		const out = execFileSync(
			process.execPath,
			[CHECK_MJS, "--pi-root", piRoot, "--authority-root", authorityRoot],
			{ encoding: "utf8" },
		);
		return { code: 0, out };
	} catch (err: unknown) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
	}
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "gw-pi-sync-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal temp tree with one Pi file and its authority counterpart. */
function buildTree(piContent: string, authorityContent: string) {
	const piRoot = path.join(tmpDir, "pi");
	const authRoot = path.join(tmpDir, "auth");
	mkdirSync(path.join(piRoot, ".pi/skills/use-groundwork"), { recursive: true });
	mkdirSync(path.join(authRoot, "skills/groundwork/use-groundwork"), {
		recursive: true,
	});
	writeFileSync(
		path.join(piRoot, MANIFEST_FIRST.pi),
		piContent,
	);
	writeFileSync(
		path.join(authRoot, MANIFEST_FIRST.authority),
		authorityContent,
	);
	// Stub the remaining manifest files so the checker finds them (as matches).
	const remaining = [
		[
			".pi/skills/use-groundwork/bootstrap-orchestrator.md",
			"skills/groundwork/use-groundwork/bootstrap-orchestrator.md",
		],
		[
			".pi/skills/use-groundwork/bootstrap-general-purpose.md",
			"skills/groundwork/use-groundwork/bootstrap-general-purpose.md",
		],
		[
			".pi/skills/use-groundwork/bootstrap-universal.md",
			"skills/groundwork/use-groundwork/bootstrap-universal.md",
		],
		[
			".pi/skills/ultrawork/SKILL.md",
			"skills/groundwork/ultrawork/SKILL.md",
		],
	];
	for (const [pi, auth] of remaining) {
		mkdirSync(path.join(piRoot, path.dirname(pi)), { recursive: true });
		mkdirSync(path.join(authRoot, path.dirname(auth)), { recursive: true });
		writeFileSync(path.join(piRoot, pi), "# stub\n");
		writeFileSync(path.join(authRoot, auth), "# stub\n");
	}
	return { piRoot, authRoot };
}

describe("check-pi-skills", () => {
	it("exits 0 when Pi copy matches authority", () => {
		const content = "# Groundwork Use-Groundwork\n\nIdentical content.\n";
		const { piRoot, authRoot } = buildTree(content, content);
		const { code, out } = run(piRoot, authRoot);
		expect(code).toBe(0);
		expect(out).toContain("OK");
	});

	it("exits 1 when Pi copy differs from authority (drift detected)", () => {
		const authorityContent = "# Groundwork Use-Groundwork\n\nAuthority content.\n";
		const piContent = "# Groundwork Use-Groundwork\n\nStale content — hand-drifted!\n";
		const { piRoot, authRoot } = buildTree(piContent, authorityContent);
		const { code, out } = run(piRoot, authRoot);
		expect(code).toBe(1);
		expect(out).toContain("DRIFT");
		expect(out).toContain(MANIFEST_FIRST.pi);
	});

	it("exits 1 when a Pi file is missing entirely", () => {
		const authRoot = path.join(tmpDir, "auth2");
		const piRoot = path.join(tmpDir, "pi2");
		mkdirSync(path.join(authRoot, "skills/groundwork/use-groundwork"), {
			recursive: true,
		});
		mkdirSync(path.join(piRoot, ".pi/skills/use-groundwork"), {
			recursive: true,
		});
		// Write authority but NOT Pi copy for the first manifest entry.
		writeFileSync(
			path.join(authRoot, MANIFEST_FIRST.authority),
			"# content\n",
		);
		// Stub remaining entries in both trees.
		const rest = [
			"bootstrap-orchestrator.md",
			"bootstrap-general-purpose.md",
			"bootstrap-universal.md",
		];
		for (const f of rest) {
			writeFileSync(
				path.join(piRoot, `.pi/skills/use-groundwork/${f}`),
				"# stub\n",
			);
			writeFileSync(
				path.join(authRoot, `skills/groundwork/use-groundwork/${f}`),
				"# stub\n",
			);
		}
		// Stub the ultrawork manifest entry in both trees.
		mkdirSync(path.join(piRoot, ".pi/skills/ultrawork"), { recursive: true });
		mkdirSync(path.join(authRoot, "skills/groundwork/ultrawork"), { recursive: true });
		writeFileSync(path.join(piRoot, ".pi/skills/ultrawork/SKILL.md"), "# stub\n");
		writeFileSync(path.join(authRoot, "skills/groundwork/ultrawork/SKILL.md"), "# stub\n");
		const { code, out } = run(piRoot, authRoot);
		expect(code).toBe(1);
		expect(out).toContain("MISSING");
	});
});

// ---------------------------------------------------------------------------
// Manifest completeness — guards against omissions in the MANIFEST
// ---------------------------------------------------------------------------

/**
 * Parse the MANIFEST array literal from the check-pi-skills.mjs source text.
 * The MANIFEST contains only plain object literals with string values, so
 * evaluating it with Function is safe and avoids importing the module (which
 * has side-effect checks that may fail in test context).
 */
function parseManifest(scriptPath: string): Array<{ pi: string; authority: string }> {
	const source = readFileSync(scriptPath, "utf8");
	const match = source.match(/const MANIFEST = (\[[\s\S]*?\]);/);
	if (!match) {
		throw new Error(`Could not find MANIFEST array in ${scriptPath}`);
	}
	// eslint-disable-next-line no-new-func
	return new Function(`return ${match[1]}`)() as Array<{ pi: string; authority: string }>;
}

/**
 * Recursively collect all regular files under a directory, returning paths
 * relative to that directory (using forward slashes).
 *
 * Symlinks are skipped entirely — a symlink into the groundwork tree cannot
 * drift by definition (it IS the authority source), so it needs no MANIFEST
 * entry. Only actual file copies can drift and therefore need registration.
 */
function walkRelative(dir: string, base = ""): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		// Skip symlinks — they point directly at the source and cannot drift.
		if (entry.isSymbolicLink()) continue;
		const rel = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			results.push(...walkRelative(path.join(dir, entry.name), rel));
		} else if (entry.isFile()) {
			results.push(rel);
		}
	}
	return results;
}

describe("pi-skills manifest completeness", () => {
	/**
	 * Every .pi/skills/ file that has a byte-for-byte counterpart candidate at
	 * the corresponding skills/groundwork/ path must appear in the MANIFEST.
	 *
	 * Files that are genuinely pi-specific despite a same-named groundwork
	 * counterpart (e.g. advisor-gate, which diverges by design) are listed in
	 * EXEMPTIONS with a justification comment. The exemption list is deliberately
	 * small — a growing exemption list is a signal that the test logic needs review.
	 *
	 * Red→green proof: remove the ultrawork entry from MANIFEST, run this test →
	 * it reports ".pi/skills/ultrawork/SKILL.md" as missing. Restore → passes.
	 */
	it("every .pi/skills/ file with a skills/groundwork/ counterpart is in the MANIFEST", () => {
		const REPO_ROOT = path.resolve(CHECK_MJS, "..", "..");
		const PI_ROOT = path.join(REPO_ROOT, ".pi", "skills");
		const GW_ROOT = path.join(REPO_ROOT, "skills", "groundwork");

		// Files that are intentionally pi-specific even though a same-named file
		// exists under skills/groundwork/ (they diverge by design and must NOT
		// be byte-for-byte mirrors). Add an entry here only with a justification.
		const EXEMPTIONS = new Set<string>([
			".pi/skills/advisor-gate/SKILL.md",
			// Documented as intentionally pi-specific in scripts/check-pi-skills.mjs:
			// "Files NOT in MANIFEST are Pi-specific (e.g. acp, advisor-gate body, autoresearch)"
		]);

		const manifest = parseManifest(CHECK_MJS);
		const manifestPiPaths = new Set(manifest.map((e) => e.pi));

		// Walk every file under .pi/skills/ and check whether a skills/groundwork/
		// counterpart exists at the same relative path.
		const piFiles = walkRelative(PI_ROOT);
		const unregistered: string[] = [];

		for (const rel of piFiles) {
			const piKey = `.pi/skills/${rel}`;
			const gwCounterpart = path.join(GW_ROOT, rel);

			let counterpartExists = false;
			try {
				// Only match file-to-file — if the groundwork path is a directory
				// (not a file), it is not a copy counterpart.
				counterpartExists = statSync(gwCounterpart).isFile();
			} catch {
				// No groundwork counterpart — pi-specific file, nothing to register.
			}

			if (counterpartExists && !EXEMPTIONS.has(piKey) && !manifestPiPaths.has(piKey)) {
				unregistered.push(piKey);
			}
		}

		expect(
			unregistered,
			`These .pi/skills/ files have a skills/groundwork/ counterpart ` +
				`but are absent from the MANIFEST in scripts/check-pi-skills.mjs:\n` +
				`  ${unregistered.join("\n  ")}\n` +
				`Add each to the MANIFEST (if it is a byte-for-byte mirror) or ` +
				`add it to EXEMPTIONS in this test with a justification comment.`,
		).toEqual([]);
	});
});
