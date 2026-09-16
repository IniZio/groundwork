/**
 * test/gw/ledger-init-motive-required.test.ts
 *
 * Proves that bin/ledger init (hooks/ledger.mjs) refuses to create a motive-less
 * ledger and that a ledger produced by real init carries the motive field,
 * allowing subsequent gw ledger commands to accept a matching --motive flag.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO_ROOT, "hooks", "ledger.mjs");
const GW_MAIN = path.join(REPO_ROOT, "src", "gw", "cli", "main.ts");
const SESSION = "ledger-init-motive-test";

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-init-motive-"));
	mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function env(): NodeJS.ProcessEnv {
	return { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: SESSION };
}

function runInit(args: string[], stdin?: string): { code: number; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("node", [CLI, "init", ...args], {
			env: env(),
			encoding: "utf8",
			input: stdin,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: any) {
		return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
	}
}

function runGwLedger(args: string[]): { code: number; stdout: string } {
	const r = spawnSync("bun", ["run", GW_MAIN, "ledger", ...args], {
		env: env(),
		encoding: "utf8",
	});
	return { code: r.status ?? 1, stdout: r.stdout ?? "" };
}

describe("bin/ledger init — motive required", () => {
	it("exits 2 when JSON input has no motive and --motive is omitted", () => {
		const r = runInit(["-"], JSON.stringify({ active: true, slices: [], gate: {} }));
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/motive/i);
	});

	it("exits 2 when seed file has no motive and --motive is omitted", () => {
		const seed = path.join(projectDir, "plan.json");
		writeFileSync(seed, JSON.stringify({ active: true, slices: [], gate: {} }));
		const r = runInit([seed]);
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/motive/i);
	});

	it("exits 0 and writes motive field when --motive flag is provided", () => {
		const r = runInit(["-", "--motive", "my-run"], JSON.stringify({ active: true, slices: [], gate: {} }));
		expect(r.code).toBe(0);
		const ledger = JSON.parse(
			readFileSync(path.join(projectDir, ".groundwork", "runs", `${SESSION}.json`), "utf8"),
		) as { motive?: string };
		expect(ledger.motive).toBe("my-run");
	});

	it("exits 0 and writes motive field when JSON input contains motive", () => {
		const r = runInit(["-"], JSON.stringify({ active: true, motive: "from-json", slices: [], gate: {} }));
		expect(r.code).toBe(0);
		const ledger = JSON.parse(
			readFileSync(path.join(projectDir, ".groundwork", "runs", `${SESSION}.json`), "utf8"),
		) as { motive?: string };
		expect(ledger.motive).toBe("from-json");
	});

	it("gw ledger hold accepts --motive matching the ledger produced by init", () => {
		const init = runInit(["-", "--motive", "my-run"], JSON.stringify({
			active: true,
			slices: [{ id: "S1", wave: 1, status: "pending", kind: "impl" }],
			gate: {},
		}));
		expect(init.code).toBe(0);
		const tokenMatch = /write_token:\s+(\S+)/.exec(init.stdout);
		expect(tokenMatch).not.toBeNull();
		const token = tokenMatch![1];

		const hold = runGwLedger(["hold", "--motive", "my-run", "--phase", "wave-1", "--token", token]);
		expect(hold.code).toBe(0);
	});
});
