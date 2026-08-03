/**
 * Tests for S5: ledger claiming (claimed_by / ledger claim).
 * All tests pin their own mkdtemp working dir — never rely on ambient CLAUDE_PROJECT_DIR.
 *
 * The base ledger has session_id: null so resolveLedgerPath falls back to the legacy
 * run.json path for ANY value of CLAUDE_CODE_SESSION_ID (back-compat: !legacyOwner → true).
 * This lets SESSION_A and SESSION_B both operate on the same fixture.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

let projectDir: string;
let ledgerFile: string;

const SESSION_A = "sess-alpha";
const SESSION_B = "sess-beta";

/**
 * Base ledger has session_id: null so resolveLedgerPath falls back to legacy
 * run.json for any CLAUDE_CODE_SESSION_ID value.
 */
const baseLedger = () => ({
	version: 1,
	active: true,
	session_id: null,
	brief: "claim test run",
	reinforcements: 0,
	slices: [
		{ id: "S1", name: "tracer", wave: 0, blocked_by: [], status: "pending", acceptance: ["a"] },
		{ id: "S2", name: "feature", wave: 1, blocked_by: [], status: "pending", acceptance: ["b"] },
	],
	gate: {},
});

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-ledger-claim-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
	ledgerFile = path.join(projectDir, ".groundwork", "run.json");
	writeFileSync(ledgerFile, JSON.stringify(baseLedger(), null, 2));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function readLedger() {
	return JSON.parse(readFileSync(ledgerFile, "utf8"));
}

/**
 * Run CLI with CLAUDE_PROJECT_DIR and optional CLAUDE_CODE_SESSION_ID.
 * Session id (for claiming) is passed via CLAUDE_CODE_SESSION_ID.
 */
function run(
	args: string[],
	session?: string,
): { code: number; stdout: string; stderr: string } {
	const env: Record<string, string> = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	if (session) env.CLAUDE_CODE_SESSION_ID = session;
	const r = spawnSync("node", [CLI, ...args], { env, encoding: "utf8" });
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("ledger claim — S5-AC1: basic claim and idempotency", () => {
	it("sets claimed_by to the current session id", () => {
		const r = run(["claim", "S1"], SESSION_A);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("S1");
		expect(r.stdout).toContain(SESSION_A);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBe(SESSION_A);
		expect(s1.claimed_at).toBeTruthy();
	});

	it("re-claiming by the same session is idempotent (exit 0, owner unchanged)", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "S1"], SESSION_A);
		expect(r.code).toBe(0);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBe(SESSION_A);
	});

	it("can claim multiple slices in one call", () => {
		const r = run(["claim", "S1", "S2"], SESSION_A);
		expect(r.code).toBe(0);
		const l = readLedger();
		expect(l.slices.find((s: any) => s.id === "S1").claimed_by).toBe(SESSION_A);
		expect(l.slices.find((s: any) => s.id === "S2").claimed_by).toBe(SESSION_A);
	});
});

describe("ledger claim — S5-AC2: different session cannot overwrite, exits 0", () => {
	it("prints warning to stderr and exits 0 when another session holds the claim", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "S1"], SESSION_B);
		expect(r.code).toBe(0);
		expect(r.stderr).toContain("already claimed by");
		expect(r.stderr).toContain(SESSION_A);
		// original owner unchanged
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBe(SESSION_A);
	});
});

describe("ledger claim — S5-AC3: completing a slice clears claimed_by", () => {
	it("ledger set --status complete removes claimed_by", () => {
		run(["claim", "S1"], SESSION_A);
		run(["set", "S1", "--status", "complete"]);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBeUndefined();
		expect(s1.claimed_at).toBeUndefined();
	});

	it("ledger set --status skipped also clears claimed_by", () => {
		run(["claim", "S1"], SESSION_A);
		run(["set", "S1", "--status", "skipped"]);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBeUndefined();
	});
});

describe("ledger claim — S5-AC4: inactive ledger allows reclaiming", () => {
	it("stale claim from a different session is reclaimable when ledger is inactive", () => {
		run(["claim", "S1"], SESSION_A);
		// Mark ledger inactive
		const l = readLedger();
		l.active = false;
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		// Session B can now reclaim
		const r = run(["claim", "S1"], SESSION_B);
		expect(r.code).toBe(0);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBe(SESSION_B);
	});
});

describe("ledger claim — S5-AC5: validation accepts claimed_by, old ledgers still load", () => {
	it("a slice with claimed_by passes validation (no unknown-key warnings for claimed_by)", () => {
		run(["claim", "S1"], SESSION_A);
		// ledger status should not emit warnings about claimed_by
		const r = run(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).not.toContain("claimed_by");
		expect(r.stderr).not.toMatch(/unknown key.*claimed/);
	});

	it("a ledger without claimed_by still loads fine", () => {
		const r = run(["status"]);
		expect(r.code).toBe(0);
	});
});

describe("ledger claim — S5-AC6: no --token required", () => {
	it("claim works without write_token in ledger", () => {
		const r = run(["claim", "S1"], SESSION_A);
		expect(r.code).toBe(0);
	});

	it("claim works even when ledger has a write_token (no --token needed)", () => {
		const l = readLedger();
		l.write_token = "secret-token-abc";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["claim", "S1"], SESSION_A);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S1").claimed_by).toBe(SESSION_A);
	});
});

describe("ledger claim — surface in status and view", () => {
	it("claimed slice shows claim marker in ledger status", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["status"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain(`claimed:${SESSION_A}`);
	});

	it("claimed slice shows claimed_by in ledger view table", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["view"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain(SESSION_A);
	});
});

describe("ledger claim — error cases", () => {
	it("exits 2 on unknown slice id", () => {
		const r = run(["claim", "BOGUS"], SESSION_A);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("unknown slice id");
	});

	it("exits 1 when no session id is available", () => {
		// No CLAUDE_CODE_SESSION_ID and no session passed
		const r = run(["claim", "S1"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("session id");
	});

	it("exits 2 with no ids given", () => {
		const r = run(["claim"], SESSION_A);
		expect(r.code).toBe(2);
	});
});

describe("ledger claim --json", () => {
	it("--json: all claimed → {claimed:[…], refused:[], ok:true} on stdout, exit 0", () => {
		const r = run(["claim", "--json", "S1", "S2"], SESSION_A);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.ok).toBe(true);
		expect(out.claimed).toEqual(expect.arrayContaining(["S1", "S2"]));
		expect(out.refused).toEqual([]);
	});

	it("--json: refused → {claimed:[], refused:[{id,claimed_by}], ok:false} on stdout, exit 0", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "--json", "S1"], SESSION_B);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.ok).toBe(false);
		expect(out.claimed).toEqual([]);
		expect(out.refused).toEqual([{ id: "S1", claimed_by: SESSION_A }]);
	});

	it("--json: partial (one claimed, one refused) → ok:false, both lists populated", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "--json", "S1", "S2"], SESSION_B);
		expect(r.code).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.ok).toBe(false);
		expect(out.claimed).toEqual(["S2"]);
		expect(out.refused).toEqual([{ id: "S1", claimed_by: SESSION_A }]);
	});
});

describe("ledger claim --strict", () => {
	it("--strict: all claimed → exit 0", () => {
		const r = run(["claim", "--strict", "S1"], SESSION_A);
		expect(r.code).toBe(0);
	});

	it("--strict: refusal → exit 1 (text mode)", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "--strict", "S1"], SESSION_B);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("already claimed by");
	});

	it("--strict --json: refusal → exit 1, JSON on stdout", () => {
		run(["claim", "S1"], SESSION_A);
		const r = run(["claim", "--strict", "--json", "S1"], SESSION_B);
		expect(r.code).toBe(1);
		const out = JSON.parse(r.stdout);
		expect(out.ok).toBe(false);
		expect(out.refused).toEqual([{ id: "S1", claimed_by: SESSION_A }]);
	});
});

describe("ledger add/set --claimed-by", () => {
	it("ledger add --claimed-by sets claimed_by on the new slice", () => {
		const r = run(["add", "S3", "--desc", "new", "--claimed-by", SESSION_A]);
		expect(r.code).toBe(0);
		const s3 = readLedger().slices.find((s: any) => s.id === "S3");
		expect(s3.claimed_by).toBe(SESSION_A);
		expect(s3.claimed_at).toBeTruthy();
	});

	it("ledger set --claimed-by updates claimed_by on existing slice", () => {
		const r = run(["set", "S1", "--claimed-by", SESSION_B]);
		expect(r.code).toBe(0);
		const s1 = readLedger().slices.find((s: any) => s.id === "S1");
		expect(s1.claimed_by).toBe(SESSION_B);
	});
});
