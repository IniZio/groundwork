/**
 * Tests that generate-agent-definitions.ts warns before deleting orphaned mirror
 * skill files — files present in skills/ with no authority counterpart in
 * skills/groundwork/.
 *
 * Coverage:
 *  1. formatOrphanDeletionWarning — pure unit: shape of the warning message.
 *  2. End-to-end subprocess: generator prints warning to stderr when an orphan
 *     exists in skills/, then deletes it.
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { formatOrphanDeletionWarning } from "../../scripts/generate-agent-definitions.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const skillsMirrorDir = join(repoRoot, "skills");

// ─── Unit: warning message format ────────────────────────────────────────────

describe("formatOrphanDeletionWarning", () => {
	test("includes WARNING prefix", () => {
		const msg = formatOrphanDeletionWarning("some-skill/SKILL.md");
		expect(msg).toMatch(/^WARNING:/);
	});

	test("names the mirror file path", () => {
		const msg = formatOrphanDeletionWarning("some-skill/SKILL.md");
		expect(msg).toContain("skills/some-skill/SKILL.md");
	});

	test("names the expected authority path", () => {
		const msg = formatOrphanDeletionWarning("some-skill/SKILL.md");
		expect(msg).toContain("skills/groundwork/some-skill/SKILL.md");
	});

	test("explains the fix", () => {
		const msg = formatOrphanDeletionWarning("some-skill/SKILL.md");
		expect(msg).toContain("create the authority copy");
	});
});

// ─── Integration: generator prints warning and deletes orphan ─────────────────

describe("generate:agents orphan deletion warning", () => {
	// Path of the fake orphaned skill we plant in the mirror.
	const orphanRelPath = "__test-orphan-skill__/SKILL.md";
	const orphanAbsPath = join(skillsMirrorDir, orphanRelPath);

	beforeEach(() => {
		mkdirSync(join(skillsMirrorDir, "__test-orphan-skill__"), { recursive: true });
		writeFileSync(orphanAbsPath, "---\nname: test-orphan\n---\nTest orphan.\n");
	});

	afterEach(() => {
		// Clean up in case the generator did NOT delete it (e.g. test failure path).
		if (existsSync(join(skillsMirrorDir, "__test-orphan-skill__"))) {
			rmSync(join(skillsMirrorDir, "__test-orphan-skill__"), { recursive: true, force: true });
		}
	});

	test("generator prints WARNING to stderr and removes the orphaned file", () => {
		const result = spawnSync(
			"node",
			["--experimental-strip-types", join(repoRoot, "scripts", "generate-agent-definitions.ts")],
			{ cwd: repoRoot, encoding: "utf8" },
		);

		// The generator must succeed.
		expect(result.status, `generator exited ${result.status}:\n${result.stderr}`).toBe(0);

		// Warning must appear on stderr.
		expect(result.stderr).toContain("WARNING:");
		expect(result.stderr).toContain("__test-orphan-skill__/SKILL.md");
		expect(result.stderr).toContain("skills/groundwork/__test-orphan-skill__/SKILL.md");

		// The orphaned file must be deleted.
		expect(existsSync(orphanAbsPath)).toBe(false);
	});
});
