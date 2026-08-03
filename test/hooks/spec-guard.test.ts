/**
 * Tests for hooks/spec-guard.mjs
 *
 * The hook uses exit code 2 for deny and exit 0 for permit/fail-open.
 * All tests use spawnSync so we can capture exit codes alongside stderr.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "spec-guard.mjs");

const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Create a temp project directory. */
function makeProjectDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "gw-spec-guard-"));
	tmpRoots.push(dir);
	return dir;
}

type RunResult = { exitCode: number; stderr: string; stdout: string };

/** Run the hook with the given payload (stdin JSON). */
function runHook(
	payload: Record<string, unknown>,
	env: Record<string, string> = {},
): RunResult {
	const result = spawnSync("node", [HOOK], {
		input: JSON.stringify({ hook_event_name: "PreToolUse", ...payload }),
		encoding: "utf8",
		env: { ...process.env, CLAUDE_SESSION_ID: undefined, ...env },
	});
	return {
		exitCode: result.status ?? -1,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	};
}

// ── Test cases ───────────────────────────────────────────────────────────────

describe("spec-guard — pass-through (paths outside guarded prefixes)", () => {
	it("passes src/ paths through (exit 0, no output)", () => {
		const projectDir = makeProjectDir();
		const r = runHook({
			tool_name: "Edit",
			tool_input: { file_path: path.join(projectDir, "src", "foo.ts") },
			cwd: projectDir,
			session_id: "sess-1",
		});
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("passes non-guarded relative paths through", () => {
		const projectDir = makeProjectDir();
		const r = runHook({
			tool_name: "Write",
			tool_input: { file_path: "hooks/some-hook.mjs" },
			cwd: projectDir,
			session_id: "sess-1",
		});
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("passes Bash tool through (not in guarded tool set)", () => {
		const projectDir = makeProjectDir();
		const r = runHook({
			tool_name: "Bash",
			tool_input: { command: "echo hi" },
			cwd: projectDir,
			session_id: "sess-1",
		});
		expect(r.exitCode).toBe(0);
	});
});

describe("spec-guard — generated files are unconditionally exempt", () => {
	it("permits writes to doc/specs/_generated/ regardless of RFC state", () => {
		// No ledger, no RFC → would normally fail-open, but generated is exempt even earlier.
		const projectDir = makeProjectDir();
		const r = runHook({
			tool_name: "Write",
			tool_input: { file_path: path.join(projectDir, "doc", "specs", "_generated", "index.md") },
			cwd: projectDir,
			session_id: "sess-1",
		});
		expect(r.exitCode).toBe(0);
		// No WARN (exempt before ledger load)
		expect(r.stderr).toBe("");
	});
});

describe("spec-guard — fail-open: missing ledger", () => {
	it("permits write and emits WARN when no ledger exists on disk", () => {
		const projectDir = makeProjectDir(); // no .groundwork/ written
		const r = runHook(
			{
				tool_name: "Edit",
				tool_input: { file_path: path.join(projectDir, "doc", "specs", "foo.md") },
				cwd: projectDir,
				session_id: "sess-no-ledger",
			},
			{ CLAUDE_SESSION_ID: "sess-no-ledger" },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("WARN");
	});
});

describe("spec-guard — malformed stdin", () => {
	it("fails open (exit 0) on malformed stdin", () => {
		const result = spawnSync("node", [HOOK], {
			input: "{ not json",
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});
});


describe("spec-guard — fail-open behavior documentation (do not change without RFC discussion)", () => {
	it("documents current fail-open behavior for out-of-project paths (see RFC discussion)", () => {
		// CURRENT BEHAVIOR (pinned, not endorsed): when a write targets an absolute path
		// in a different repo, relativeFromProject() returns the absolute path unchanged.
		// That absolute path does not start with "doc/specs/" or "docs/steering/", so
		// isGuarded = false and the hook passes through with exit 0 — no RFC check performed.
		//
		// This means cross-repo spec writes are NOT authorization-checked.
		// If the design decision flips to fail-closed, invert this test.
		const projectDir = makeProjectDir();
		// Simulate a write in a completely different project directory (not a subdirectory of projectDir).
		const otherProjectPath = "/home/newman/magic/hanlun-lms/doc/specs/artifact/requirements.md";
		const r = runHook({
			tool_name: "Write",
			tool_input: { file_path: otherProjectPath },
			cwd: projectDir,
			session_id: "sess-xrepo",
		});
		// Fail-open: exits 0, no WARN (passthrough before ledger load).
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});
});
