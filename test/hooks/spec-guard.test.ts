/**
 * Tests for hooks/spec-guard.mjs
 *
 * The hook uses exit code 2 for deny and exit 0 for permit/fail-open.
 * All tests use spawnSync so we can capture exit codes alongside stderr.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

/** Write a session ledger to .groundwork/runs/<sessionId>.json */
function writeLedger(projectDir: string, sessionId: string, ledger: Record<string, unknown>): void {
	const runsDir = path.join(projectDir, ".groundwork", "runs");
	mkdirSync(runsDir, { recursive: true });
	writeFileSync(path.join(runsDir, `${sessionId}.json`), JSON.stringify(ledger));
}

/** Write an RFC rfc.md file in the given directory. */
function writeRfc(rfcDir: string, frontmatter: Record<string, unknown>): void {
	mkdirSync(rfcDir, { recursive: true });
	const yamlLines = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
		.join("\n");
	writeFileSync(path.join(rfcDir, "rfc.md"), `---\n${yamlLines}\n---\n\n# RFC body\n`);
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

describe("spec-guard — fail-open: ledger missing rfc_ref", () => {
	it("permits write and emits WARN when ledger has no rfc_ref", () => {
		const projectDir = makeProjectDir();
		writeLedger(projectDir, "sess-2", {
			active: true,
			session_id: "sess-2",
			slices: [],
			// rfc_ref intentionally absent
		});
		const r = runHook(
			{
				tool_name: "Edit",
				tool_input: { file_path: path.join(projectDir, "doc", "specs", "foo.md") },
				cwd: projectDir,
				session_id: "sess-2",
			},
			{ CLAUDE_SESSION_ID: "sess-2" },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("WARN");
		expect(r.stderr).toContain("rfc_ref");
	});
});

describe("spec-guard — deny: RFC not in accepted/implementing status", () => {
	it("denies when RFC status is 'draft'", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0001-my-rfc");
		writeRfc(rfcDir, {
			uid: "0001",
			status: "draft",
			spec_delta: [{ op: "add", target: "doc/specs/foo.md" }],
		});
		writeLedger(projectDir, "sess-3", {
			active: true,
			session_id: "sess-3",
			rfc_ref: ".groundwork/rfcs/0001-my-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Edit",
				tool_input: { file_path: path.join(projectDir, "doc", "specs", "foo.md") },
				cwd: projectDir,
				session_id: "sess-3",
			},
			{ CLAUDE_SESSION_ID: "sess-3" },
		);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("DENIED");
		expect(r.stderr).toContain("draft");
		expect(r.stderr).toContain("accepted/implementing");
	});

	it("denies when RFC status is 'review'", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0002-review-rfc");
		writeRfc(rfcDir, {
			uid: "0002",
			status: "review",
			spec_delta: [{ op: "add", target: "doc/specs/bar.md" }],
		});
		writeLedger(projectDir, "sess-4", {
			active: true,
			session_id: "sess-4",
			rfc_ref: ".groundwork/rfcs/0002-review-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Write",
				tool_input: { file_path: path.join(projectDir, "doc", "specs", "bar.md") },
				cwd: projectDir,
				session_id: "sess-4",
			},
			{ CLAUDE_SESSION_ID: "sess-4" },
		);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("DENIED");
	});
});

describe("spec-guard — deny: no matching spec_delta entry", () => {
	it("denies when RFC is accepted but spec_delta doesn't cover the path", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0003-accepted-rfc");
		writeRfc(rfcDir, {
			uid: "0003",
			status: "accepted",
			spec_delta: [
				// Only covers artifacts/README.md, not doc/specs/other.md
				{ op: "add", target: "doc/specs/artifacts/README.md" },
			],
		});
		writeLedger(projectDir, "sess-5", {
			active: true,
			session_id: "sess-5",
			rfc_ref: ".groundwork/rfcs/0003-accepted-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Edit",
				tool_input: { file_path: path.join(projectDir, "doc", "specs", "other.md") },
				cwd: projectDir,
				session_id: "sess-5",
			},
			{ CLAUDE_SESSION_ID: "sess-5" },
		);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("DENIED");
		expect(r.stderr).toContain("spec_delta");
	});
});

describe("spec-guard — permit: matching spec_delta entry", () => {
	it("permits when RFC is accepted and spec_delta has exact match for target", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0004-impl-rfc");
		writeRfc(rfcDir, {
			uid: "0004",
			status: "accepted",
			spec_delta: [{ op: "add", target: "doc/specs/requirements/my-req.md" }],
		});
		writeLedger(projectDir, "sess-6", {
			active: true,
			session_id: "sess-6",
			rfc_ref: ".groundwork/rfcs/0004-impl-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Write",
				tool_input: {
					file_path: path.join(projectDir, "doc", "specs", "requirements", "my-req.md"),
				},
				cwd: projectDir,
				session_id: "sess-6",
			},
			{ CLAUDE_SESSION_ID: "sess-6" },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("permits when RFC is implementing and spec_delta covers path via prefix", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0005-impl-rfc");
		writeRfc(rfcDir, {
			uid: "0005",
			status: "implementing",
			spec_delta: [
				// Directory-level target covers all files under it
				{ op: "add", target: "doc/specs/artifacts/" },
			],
		});
		writeLedger(projectDir, "sess-7", {
			active: true,
			session_id: "sess-7",
			rfc_ref: ".groundwork/rfcs/0005-impl-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Edit",
				tool_input: {
					file_path: path.join(projectDir, "doc", "specs", "artifacts", "deep", "file.md"),
				},
				cwd: projectDir,
				session_id: "sess-7",
			},
			{ CLAUDE_SESSION_ID: "sess-7" },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("permits docs/steering/ path when covered by spec_delta", () => {
		const projectDir = makeProjectDir();
		const rfcDir = path.join(projectDir, ".groundwork", "rfcs", "0006-steering-rfc");
		writeRfc(rfcDir, {
			uid: "0006",
			status: "accepted",
			spec_delta: [{ op: "update", target: "docs/steering/vision.md" }],
		});
		writeLedger(projectDir, "sess-8", {
			active: true,
			session_id: "sess-8",
			rfc_ref: ".groundwork/rfcs/0006-steering-rfc",
			slices: [],
		});
		const r = runHook(
			{
				tool_name: "Write",
				tool_input: { file_path: path.join(projectDir, "docs", "steering", "vision.md") },
				cwd: projectDir,
				session_id: "sess-8",
			},
			{ CLAUDE_SESSION_ID: "sess-8" },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("fails open (exit 0) on malformed stdin", () => {
		const result = spawnSync("node", [HOOK], {
			input: "{ not json",
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});
});
