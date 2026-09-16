/**
 * Deployed-path test for bin/ledger — exercises the bash wrapper itself,
 * not the underlying hooks/ledger.mjs module.
 *
 * The prior regression shape: a hook was 25/25 green under `node <path>`
 * while the real bare-path registration exited 126 (missing exec bit).
 * This test bites that failure mode by spawning bin/ledger directly with
 * NO `node` in argv[0], so the shebang and exec bit are required.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const WRAPPER = path.resolve(import.meta.dirname, "..", "..", "bin", "ledger");

// Minimal ledger fixture — status needs an active run to read.
const TEST_TOKEN = "testtoken-wrapper";
const baseLedger = () => ({
	version: 1,
	active: true,
	session_id: "sess-wrapper",
	brief: "wrapper test run",
	reinforcements: 0,
	write_token: TEST_TOKEN,
	slices: [
		{ id: "W1", name: "tracer", wave: 0, blocked_by: [], status: "complete", acceptance: ["a"] },
	],
	gate: {},
});

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-wrapper-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
	writeFileSync(
		path.join(projectDir, ".groundwork", "run.json"),
		JSON.stringify(baseLedger(), null, 2),
	);
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe("bin/ledger wrapper (deployed-path)", () => {
	it("executes via shebang — argv[0] is the wrapper path, not node", () => {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
		};
		delete env.CLAUDE_CODE_SESSION_ID;

		const r = spawnSync(WRAPPER, ["status"], { env, encoding: "utf8" });

		expect(r.status, `wrapper spawn failed: ${r.error ?? r.stderr}`).not.toBeNull();
		expect(
			r.status,
			`bin/ledger exited ${r.status} — expected 0.\n` +
				`Exit 126 = exec bit missing; 127 = wrapper path not found.\n` +
				`stderr: ${r.stderr}`,
		).toBe(0);

		expect(r.stdout).toMatch(/W1|tracer|wrapper test run/);
	});

	it("exits 0 for `help` with no ledger present (shebang + path resolution)", () => {
		const emptyDir = mkdtempSync(path.join(tmpdir(), "gw-wrapper-empty-"));
		try {
			const r = spawnSync(WRAPPER, ["help"], {
				env: { ...process.env, CLAUDE_PROJECT_DIR: emptyDir },
				encoding: "utf8",
			});
			expect(r.status, `wrapper spawn failed: ${r.error ?? r.stderr}`).not.toBeNull();
			expect(
				r.status,
				`bin/ledger help exited ${r.status}.\n` +
					`Exit 126 = exec bit missing; 127 = path resolution broken.\n` +
					`stderr: ${r.stderr}`,
			).toBe(0);
			expect(r.stdout + r.stderr).toMatch(/ledger|usage|commands?/i);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("resolves its real location via readlink when invoked through a symlink", () => {
		// Symlink in separate dir forces readlink-f resolution (dirname-based fails here).
		const symlinkDir = mkdtempSync(path.join(tmpdir(), "gw-symlink-"));
		const symlinkPath = path.join(symlinkDir, "ledger");

		let symlinkCreated = false;
		try {
			symlinkSync(WRAPPER, symlinkPath);
			symlinkCreated = true;
		} catch (e) {
			throw new Error(
				`Symlink creation failed — cannot verify readlink resolution: ${e}`,
			);
		}

		try {
			const env: NodeJS.ProcessEnv = {
				...process.env,
				CLAUDE_PROJECT_DIR: projectDir,
			};
			delete env.CLAUDE_CODE_SESSION_ID;

			const r = spawnSync(symlinkPath, ["help"], { env, encoding: "utf8" });

			expect(
				r.status,
				`Symlink spawn failed before exec (spawn error: ${r.error}).` +
					` Check ENOENT/EACCES on ${symlinkPath}.`,
			).not.toBeNull();
			expect(
				r.status,
				`bin/ledger via symlink exited ${r.status} — expected 0.\n` +
					`Symlink dir: ${symlinkDir} (≠ real bin/ dir — readlink must resolve).\n` +
					`stderr: ${r.stderr}`,
			).toBe(0);
		} finally {
			rmSync(symlinkDir, { recursive: true, force: true });
		}

		expect(symlinkCreated).toBe(true);
	});

	it("bite proof: naive dirname-based wrapper fails through symlink, readlink-based succeeds", () => {
		const tmpDir = mkdtempSync(path.join(tmpdir(), "gw-bite-"));
		const naiveSymlinkDir = mkdtempSync(path.join(tmpdir(), "gw-bite-sym-"));

		try {
			const naivePath = path.join(tmpDir, "ledger-naive");
			const naiveContent =
				"#!/usr/bin/env bash\n" +
				"# Naive: uses dirname of invocation path, not resolved real file.\n" +
				"_DIR=$(dirname \"$0\")\n" +
				"exec node \"$_DIR/../hooks/ledger.mjs\" \"$@\"\n";
			writeFileSync(naivePath, naiveContent, { mode: 0o775 });

			const naiveSymlink = path.join(naiveSymlinkDir, "ledger");
			const realSymlink = path.join(tmpDir, "ledger-real-sym");

			symlinkSync(naivePath, naiveSymlink);
			symlinkSync(WRAPPER, realSymlink);

			const env: NodeJS.ProcessEnv = {
				...process.env,
				CLAUDE_PROJECT_DIR: projectDir,
			};
			delete env.CLAUDE_CODE_SESSION_ID;

			const naiveResult = spawnSync(naiveSymlink, ["help"], {
				env,
				encoding: "utf8",
			});
			const realResult = spawnSync(realSymlink, ["help"], {
				env,
				encoding: "utf8",
			});

			const naiveFailed =
				naiveResult.status === null || naiveResult.status !== 0;
			expect(
				naiveFailed,
				`Naive wrapper (dirname "$0") through symlink unexpectedly succeeded` +
					` (exit ${naiveResult.status}).` +
					` The bite proof is not distinguishing the two resolution strategies.`,
			).toBe(true);

			expect(
				realResult.status,
				`Real wrapper spawn failed at exec level: ${realResult.error}`,
			).not.toBeNull();
			expect(
				realResult.status,
				`Real wrapper via symlink exited ${realResult.status} — expected 0.\n` +
					`stderr: ${realResult.stderr}`,
			).toBe(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
			rmSync(naiveSymlinkDir, { recursive: true, force: true });
		}
	});

	it("prints a deprecation notice to stderr that does not claim gw ledger init is unimplemented", () => {
		const r = spawnSync(WRAPPER, ["help"], {
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
			encoding: "utf8",
		});
		expect(r.status, `spawn failed: ${r.error ?? r.stderr}`).not.toBeNull();
		expect(r.stderr, "deprecation notice missing from stderr").toMatch(/DEPRECATED.*superseded/i);
		expect(
			r.stderr,
			"notice must not claim gw ledger init is unimplemented — it is implemented",
		).not.toMatch(/not yet implemented/i);
	});
});
