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

function runBinLedger(args: string[], envOverride?: NodeJS.ProcessEnv): { code: number; stdout: string; stderr: string } {
	const r = spawnSync("node", [CLI, ...args], {
		env: { ...env(), ...envOverride },
		encoding: "utf8",
	});
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeLedger(motive: string | null, writeToken = "tok-abc"): string {
	const p = path.join(projectDir, ".groundwork", "runs", `${SESSION}.json`);
	const obj: Record<string, unknown> = {
		active: true,
		session_id: SESSION,
		write_token: writeToken,
		slices: [{ id: "S1", wave: 0, status: "pending", kind: "impl" }],
		gate: {},
	};
	if (motive !== null) obj.motive = motive;
	writeFileSync(p, JSON.stringify(obj));
	return p;
}

describe("bin/ledger mutations — motive guard (S45-GUARD-SCOPE)", () => {
	const REAL = "test-motive";
	const WRONG = "wrong-motive";

	it("complete: exits 1 with MOTIVE_MISMATCH when --motive disagrees", () => {
		writeLedger(REAL);
		const r = runBinLedger(["complete", "S1", "--motive", WRONG, "--token", "tok-abc"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("MOTIVE_MISMATCH");
		expect(r.stderr).toContain(WRONG);
		expect(r.stderr).toContain(REAL);
	});

	it("set: exits 1 with MOTIVE_MISMATCH when --motive disagrees", () => {
		writeLedger(REAL);
		const r = runBinLedger(["set", "S1", "--motive", WRONG, "--status", "in_progress"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("MOTIVE_MISMATCH");
	});

	it("gate: exits 1 with MOTIVE_MISMATCH when --motive disagrees", () => {
		writeLedger(REAL);
		const r = runBinLedger(["gate", "advisor", "APPROVE", "--motive", WRONG, "--token", "tok-abc"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("MOTIVE_MISMATCH");
	});

	it("rm: exits 1 with MOTIVE_MISMATCH when --motive disagrees", () => {
		writeLedger(REAL);
		const r = runBinLedger(["rm", "S1", "--motive", WRONG]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("MOTIVE_MISMATCH");
	});

	it("complete: exits 1 with MOTIVE_MISSING when ledger has no motive", () => {
		writeLedger(null);
		const r = runBinLedger(["complete", "S1", "--motive", REAL, "--token", "tok-abc"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("MOTIVE_MISSING");
	});

	it("recovery: motive-less ledger repaired via init, then bin/ledger and gw ledger accept it", () => {
		const ledgerP = writeLedger(null);

		const refuse = runGwLedger(["status", "--motive", REAL]);
		expect(refuse.code, "gw ledger must refuse motive-less ledger").not.toBe(0);

		const repair = runInit([ledgerP, "--motive", REAL, "--token", "tok-abc"]);
		expect(repair.code, "init repair must succeed").toBe(0);

		const tokenMatch = /write_token:\s+(\S+)/.exec(repair.stdout);
		expect(tokenMatch, "init must print new write_token").not.toBeNull();
		const newToken = tokenMatch![1];

		const accept = runGwLedger(["status", "--motive", REAL]);
		expect(accept.code, "gw ledger must accept repaired ledger").toBe(0);

		const complete = runBinLedger(["complete", "S1", "--motive", REAL, "--token", newToken]);
		expect(complete.code, "bin/ledger complete must succeed after repair").toBe(0);
	});
});

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
