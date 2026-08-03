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
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
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

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

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
	];
	for (const [pi, auth] of remaining) {
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
		const { code, out } = run(piRoot, authRoot);
		expect(code).toBe(1);
		expect(out).toContain("MISSING");
	});
});
