/**
 * Deployed-path test for bin/ledger — exercises the bash wrapper itself,
 * not the underlying hooks/ledger.mjs module.
 *
 * The prior regression shape: a hook was 25/25 green under `node <path>`
 * while the real bare-path registration exited 126 (missing exec bit).
 * This test bites that failure mode by spawning bin/ledger directly with
 * NO `node` in argv[0], so the shebang and exec bit are required.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
		// Spawn the wrapper DIRECTLY — no "node" prefix — so the OS must
		// honour the shebang and the exec bit must be set (exit 126 otherwise).
		const env: NodeJS.ProcessEnv = {
			...process.env,
			CLAUDE_PROJECT_DIR: projectDir,
		};
		// Unset session-id so CLI resolves the legacy run.json path, matching
		// the fixture written in beforeEach.
		delete env.CLAUDE_CODE_SESSION_ID;

		const r = spawnSync(WRAPPER, ["status"], { env, encoding: "utf8" });

		// r.status === null means the process could not be spawned (e.g. ENOENT /
		// EACCES before exec). Treat null as a hard failure so the message is clear.
		expect(r.status, `wrapper spawn failed: ${r.error ?? r.stderr}`).not.toBeNull();
		expect(
			r.status,
			`bin/ledger exited ${r.status} — expected 0.\n` +
				`Exit 126 = exec bit missing; 127 = wrapper path not found.\n` +
				`stderr: ${r.stderr}`,
		).toBe(0);

		// Sanity: output mentions the fixture slice so we know the right ledger
		// was read (not some ambient session ledger).
		expect(r.stdout).toMatch(/W1|tracer|wrapper test run/);
	});

	it("exits 0 for `help` with no ledger present (shebang + path resolution)", () => {
		// help should work even in an empty project dir — good isolation.
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
			// help output must contain something useful
			expect(r.stdout + r.stderr).toMatch(/ledger|usage|commands?/i);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});
