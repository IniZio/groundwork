/**
 * Regression: `ledger init` must leave a usable seal key behind.
 *
 * Defect: cmdInit minted the seal key (ensureKey) BEFORE calling
 * pruneStaleSessionLedgers().  When the previous run for the SAME session id
 * had been abandoned (active:false), prune co-deleted that ledger's
 * `<session>.seal.key` sibling — which is the very key just minted for the new
 * run.  init then wrote the .json and reported success, but every subsequent
 * token-authenticated write failed with ENOENT on the key.
 *
 * These tests drive the real CLI in an isolated CLAUDE_PROJECT_DIR with an
 * explicit CLAUDE_CODE_SESSION_ID, so they never read the ambient project tree.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");
const SESSION = "gw-seal-regress-session";

let projectDir: string;
let seed: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-seal-prune-"));
	mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
	seed = path.join(projectDir, "plan.json");
	writeFileSync(
		seed,
		JSON.stringify({
			active: true,
			slices: [{ id: "T1", wave: 0, blocked_by: [], status: "pending", acceptance: ["a"] }],
			gate: {},
		}),
	);
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/**
 * Run the CLI against the isolated temp project with an explicit session id.
 * Both CLAUDE_PROJECT_DIR and CLAUDE_CODE_SESSION_ID are set (never inherited),
 * so the assertions cannot silently target the real repo tree.
 */
function run(args: string[], sessionId: string = SESSION, stdin?: string) {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId };
	try {
		const stdout = execFileSync("node", [CLI, ...args], { env, encoding: "utf8", input: stdin });
		return { code: 0, stdout, stderr: "" };
	} catch (e: any) {
		return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
	}
}

function tokenOf(stdout: string): string {
	const m = stdout.match(/^write_token: ([0-9a-f]+)/m);
	if (!m) throw new Error(`no write_token in init output: ${stdout}`);
	return m[1];
}

const keyFile = (sessionId = SESSION) =>
	path.join(projectDir, ".groundwork", "runs", `${sessionId}.seal.key`);
const jsonFile = (sessionId = SESSION) =>
	path.join(projectDir, ".groundwork", "runs", `${sessionId}.json`);

describe("ledger init — seal key survives the stale-ledger prune", () => {
	for (const mode of ["file", "stdin"] as const) {
		it(`re-init over an abandoned same-session ledger leaves a writable ledger (${mode} input)`, () => {
			// 1. First run for this session, then genuinely abandon it (active:false).
			const first = run(["init", seed]);
			expect(first.code).toBe(0);
			const abandoned = run(["abandon", "--token", tokenOf(first.stdout)]);
			expect(abandoned.code).toBe(0);

			// 2. Re-init the SAME session id — this is the defect path.
			const second =
				mode === "stdin"
					? run(["init", "-"], SESSION, JSON.stringify({ active: true, slices: [{ id: "T1", wave: 0, blocked_by: [], status: "pending", acceptance: ["a"] }], gate: {} }))
					: run(["init", seed]);
			expect(second.code).toBe(0);
			expect(existsSync(jsonFile())).toBe(true);

			// 3. The key must exist alongside the ledger init just reported as written.
			expect(existsSync(keyFile())).toBe(true);

			// 4. The real defect path: a token-authenticated write must succeed.
			//    Before the fix this failed with ENOENT on the .seal.key.
			const write = run(["complete", "T1", "--token", tokenOf(second.stdout)]);
			expect(write.stderr + write.stdout).not.toMatch(/ENOENT/);
			expect(write.code).toBe(0);
		});
	}

	it("a plain init on a fresh session id still yields a writable ledger (control)", () => {
		const r = run(["init", seed], "gw-seal-fresh-session");
		expect(r.code).toBe(0);
		expect(existsSync(keyFile("gw-seal-fresh-session"))).toBe(true);
		const write = run(["complete", "T1", "--token", tokenOf(r.stdout)], "gw-seal-fresh-session");
		expect(write.code).toBe(0);
	});

	it("prune still co-deletes an abandoned OTHER session's ledger and its seal key", () => {
		// Guards the fix against regressing the co-delete behaviour it reorders:
		// a different session's abandoned ledger must still be swept, key included.
		const other = "gw-seal-other-session";
		const first = run(["init", seed], other);
		expect(first.code).toBe(0);
		expect(run(["abandon", "--token", tokenOf(first.stdout)], other).code).toBe(0);
		expect(existsSync(keyFile(other))).toBe(true);

		// An init for a DIFFERENT session triggers the prune pass.
		expect(run(["init", seed]).code).toBe(0);
		expect(existsSync(jsonFile(other))).toBe(false);
		expect(existsSync(keyFile(other))).toBe(false);
	});
});
