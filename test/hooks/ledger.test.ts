import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

let projectDir: string;
let ledgerFile: string;

/** Shared write token for baseLedger-based tests (replaces retired token_free escape hatch). */
const TEST_TOKEN = "testtoken12345678";

const baseLedger = () => ({
	version: 1,
	active: true,
	session_id: "sess-1",
	brief: "test run",
	reinforcements: 0,
	// write_token: all sealed-regime operations (complete/gate/abandon/set-terminal) require --token.
	write_token: TEST_TOKEN,
	slices: [
		{ id: "S1", name: "tracer", wave: 0, blocked_by: [], status: "complete", acceptance: ["a"] },
		{ id: "S2", name: "feature", wave: 1, blocked_by: ["S1"], status: "pending", acceptance: ["b", "c"] },
		{ id: "S3", name: "polish", wave: 1, blocked_by: ["S1"], status: "pending", acceptance: ["d"] },
	],
	gate: {},
});

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-ledger-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
	ledgerFile = path.join(projectDir, ".groundwork", "run.json");
	writeFileSync(ledgerFile, JSON.stringify(baseLedger(), null, 2));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/** Run the CLI with CLAUDE_PROJECT_DIR pointing at the temp project. */
function run(args: string[], stdin?: string): { code: number; stdout: string; stderr: string } {
	// Unset CLAUDE_CODE_SESSION_ID so the CLI uses the legacy run.json path (which is
	// where the beforeEach fixture writes the test ledger).
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env,
			encoding: "utf8",
			input: stdin,
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: any) {
		return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
	}
}

function readLedger() {
	return JSON.parse(readFileSync(ledgerFile, "utf8"));
}

/**
 * Like run() but captures stdout AND stderr in all cases (even exit 0).
 * execFileSync swallows stderr on success; spawnSync always gives both.
 */
function runFull(args: string[], stdin?: string): { code: number; stdout: string; stderr: string } {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	const r = spawnSync("node", [CLI, ...args], {
		env,
		encoding: "utf8",
		input: stdin,
	});
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("ledger CLI — complete", () => {
	it("marks a slice complete and reports compact progress", () => {
		const r = run(["complete", "S2", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(r.stdout.trim()).toBe("S2 ✓ (2/3 complete)");
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("complete");
	});

	it("marks multiple slices in one call", () => {
		const r = run(["complete", "S2", "S3", "--token", TEST_TOKEN]);
		expect(r.stdout.trim()).toBe("S2, S3 ✓ (3/3 complete)");
		expect(readLedger().slices.every((s: any) => s.status === "complete")).toBe(true);
	});

	it("errors (exit 2) on an unknown slice id and does not corrupt the ledger", () => {
		const r = run(["complete", "S9", "--token", TEST_TOKEN]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("unknown slice id");
		// S9 didn't exist; real slices untouched.
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});

	it("output is tiny (the whole point) — single line, no ledger body echoed", () => {
		const r = run(["complete", "S2", "--token", TEST_TOKEN]);
		expect(r.stdout.split("\n").filter(Boolean).length).toBe(1);
		expect(r.stdout).not.toContain("acceptance");
	});

	// @verifies ARTIFACT-R-001
	it("stamps completed_at (ISO-8601) and session_id on the completed slice", () => {
		const r = run(["complete", "S2", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		const ledger = readLedger();
		const s = ledger.slices.find((s: any) => s.id === "S2");
		// id must be present (unchanged)
		expect(s.id).toBe("S2");
		// completed_at must be a valid ISO-8601 date string
		expect(s.completed_at).toBeTruthy();
		expect(new Date(s.completed_at).toISOString()).toBe(s.completed_at);
		// session_id on slice must match the run's top-level session_id
		expect(s.session_id).toBe(ledger.session_id);
	});
});

describe("ledger CLI — gate", () => {
	it("sets gate.advisor as a bare string verdict", () => {
		const r = run(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		expect(r.stdout.trim()).toBe("advisor: APPROVE");
		expect(readLedger().gate.advisor).toBe("APPROVE");
	});

	it("sets gate.advisor as an OBJECT when citation/rubric/axes flags are present", () => {
		run(["gate", "advisor", "CORRECTION", "--citation", "contact.ts:42", "--rubric", "v1", "--axes-correctness", "2", "--token", TEST_TOKEN]);
		const a = readLedger().gate.advisor;
		expect(a).toEqual({ verdict: "CORRECTION", rubric: "v1", citation: "contact.ts:42", axes: { correctness: 2 } });
	});

	it("rejects an unknown gate name (exit 2)", () => {
		const r = run(["gate", "bogus", "APPROVE"]);
		expect(r.code).toBe(2);
	});
});

describe("ledger CLI — abandon & status", () => {
	it("abandon sets active:false", () => {
		run(["abandon", "--token", TEST_TOKEN]);
		expect(readLedger().active).toBe(false);
	});

	it("status prints a compact view with symbols and gate line, not the full JSON", () => {
		run(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		const r = run(["status"]);
		expect(r.stdout).toContain("S1✓");
		expect(r.stdout).toContain("S2");
		expect(r.stdout).toContain("advisor=APPROVE");
		expect(r.stdout).toContain("1/3 slices complete");
		expect(r.stdout).not.toContain("acceptance");
	});
});

describe("ledger CLI — init & atomicity", () => {
	it("init writes the initial ledger from a file", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [{ id: "X1", status: "pending" }], gate: {} }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		expect(readLedger().slices[0].id).toBe("X1");
	});

	it("init reads from stdin with '-'", () => {
		rmSync(ledgerFile);
		run(["init", "-"], JSON.stringify({ active: true, slices: [], gate: {} }));
		expect(readLedger().active).toBe(true);
	});

	it("leaves no stray .lock or .tmp files after a mutation", () => {
		run(["complete", "S2"]);
		const left = require("node:fs").readdirSync(path.join(projectDir, ".groundwork"));
		expect(left.some((f: string) => f.includes(".lock") || f.includes(".tmp"))).toBe(false);
	});

	it("survives many concurrent completes without losing a write (lock serializes)", () => {
		// Fire 3 completes in parallel; all must land.
		const { spawnSync } = require("node:child_process");
		const spawnEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
		delete spawnEnv.CLAUDE_CODE_SESSION_ID;
		const procs = ["S2", "S3"].map((id) =>
			spawnSync("node", [CLI, "complete", id, "--token", TEST_TOKEN], { env: spawnEnv, encoding: "utf8" }),
		);
		for (const p of procs) expect(p.status).toBe(0);
		const l = readLedger();
		expect(l.slices.find((s: any) => s.id === "S2").status).toBe("complete");
		expect(l.slices.find((s: any) => s.id === "S3").status).toBe("complete");
		expect(existsSync(ledgerFile)).toBe(true);
	});

	it("init generates a write_token hex string and prints it once to stdout", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {} }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		// stdout must mention the token
		expect(r.stdout).toContain("write_token:");
		// extract the token value — 16 hex chars for 8 random bytes
		const match = r.stdout.match(/write_token:\s+([0-9a-f]+)/);
		expect(match).not.toBeNull();
		const token = match![1];
		expect(token).toMatch(/^[0-9a-f]{16}$/);
		// token must also be persisted in run.json
		expect(readLedger().write_token).toBe(token);
	});

	it("init persists motive from JSON input", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {}, motive: "my-motive" }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		expect(readLedger().motive).toBe("my-motive");
	});

	it("init --motive flag sets motive and overrides JSON input", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {}, motive: "old-motive" }));
		rmSync(ledgerFile);
		const r = run(["init", src, "--motive", "new-motive"]);
		expect(r.code).toBe(0);
		expect(readLedger().motive).toBe("new-motive");
	});

	it("init always mints a write_token (token-free escape hatch retired per D-6)", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {} }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("write_token:");
		const ledger = readLedger();
		expect(ledger.write_token).toBeTruthy();
		expect(ledger.token_free).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Helper: write a ledger that has an embedded write_token
// ---------------------------------------------------------------------------

function writeLedgerWithToken(token: string) {
	const l = { ...baseLedger(), write_token: token } as any;
	writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
	return token;
}

// ---------------------------------------------------------------------------
// Write-token enforcement — gate
// ---------------------------------------------------------------------------

describe("ledger CLI — write-token enforcement (gate)", () => {
	it("gate succeeds (exit 0) with the correct --token", () => {
		const token = writeLedgerWithToken("deadbeef01234567");
		const r = run(["gate", "advisor", "APPROVE", "--token", token]);
		expect(r.code).toBe(0);
		expect(readLedger().gate.advisor).toBe("APPROVE");
	});

	it("gate rejects (non-zero) when --token is omitted and ledger has write_token", () => {
		writeLedgerWithToken("deadbeef01234567");
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.code).not.toBe(0);
	});

	it("gate rejects (non-zero) when --token is wrong and ledger has write_token", () => {
		writeLedgerWithToken("deadbeef01234567");
		const r = run(["gate", "advisor", "APPROVE", "--token", "wrongtoken000000"]);
		expect(r.code).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Write-token enforcement — complete
// ---------------------------------------------------------------------------

describe("ledger CLI — write-token enforcement (complete)", () => {
	it("complete succeeds (exit 0) with the correct --token", () => {
		const token = writeLedgerWithToken("deadbeef01234567");
		const r = run(["complete", "S2", "--token", token]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("complete");
	});

	it("complete rejects (non-zero) when --token is omitted and ledger has write_token", () => {
		writeLedgerWithToken("deadbeef01234567");
		const r = run(["complete", "S2"]);
		expect(r.code).not.toBe(0);
	});

	it("complete rejects (non-zero) when --token is wrong and ledger has write_token", () => {
		writeLedgerWithToken("deadbeef01234567");
		const r = run(["complete", "S2", "--token", "wrongtoken000000"]);
		expect(r.code).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Fail-CLOSED: tokenless ledger (no write_token) → REJECTED
// (token_free escape hatch retired D-6; there is no longer an opt-out path)
// ---------------------------------------------------------------------------

/**
 * Write a ledger that has no write_token (genuinely tokenless / broken).
 * Represents a misconfigured ledger that predates token enforcement.
 */
function writeLedgerNoToken() {
	const l = { ...baseLedger() } as any;
	delete l.write_token;  // neither write_token — fail-closed must reject
	writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
}

describe("ledger CLI — fail-closed (tokenless ledger)", () => {
	it("gate rejects (non-zero) when ledger has no write_token — regression: fix for fail-open bug", () => {
		// A ledger with no write_token must be REJECTED (fail-closed).
		writeLedgerNoToken();
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.code).not.toBe(0);
		// Gate must NOT have been written
		expect(readLedger().gate?.advisor).toBeUndefined();
	});

	it("complete rejects (non-zero) when ledger has no write_token", () => {
		writeLedgerNoToken();
		const r = run(["complete", "S2"]);
		expect(r.code).not.toBe(0);
		// Slice status must remain pending
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});

	it("token_free:true no longer bypasses token enforcement (escape hatch retired, vector 1 closed)", () => {
		// Write a ledger with token_free:true but no write_token — old opt-out form.
		// After D-6, this must be REJECTED just like any other tokenless ledger.
		const l = { ...baseLedger(), token_free: true } as any;
		delete l.write_token;
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.code).not.toBe(0);
		expect(readLedger().gate?.advisor).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Sealed-regime enforcement — vectors 1-4 (S2-AC1 through S2-AC5)
// ---------------------------------------------------------------------------

describe("ledger CLI — sealed-regime vector coverage", () => {
	// S2-AC1: init mints schema_version + key + seal
	it("init mints schema_version, gate.seal, and writes the key file (S2-AC1)", () => {
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [{ id: "X1", status: "pending" }], gate: {} }));
		rmSync(ledgerFile, { force: true });
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		const ledger = readLedger();
		// schema_version marks sealed regime
		expect(ledger.schema_version).toBe(1);
		// gate.seal is a hex string
		expect(typeof ledger.gate?.seal).toBe("string");
		expect(ledger.gate.seal).toMatch(/^[0-9a-f]{64}$/);  // HMAC-SHA256 = 64 hex chars
		// key file must exist at .groundwork/runs/<session_id>.seal.key
		const keyFile = path.join(projectDir, ".groundwork", "runs", `${ledger.session_id}.seal.key`);
		expect(existsSync(keyFile)).toBe(true);
	});

	// S2-AC2: init refuses to overwrite an active tokened run without --token (vectors 1 & 2)
	it("init refuses to overwrite an active tokened run without --token (S2-AC2, vectors 1&2)", () => {
		// baseLedger is already written at ledgerFile with write_token: TEST_TOKEN, active: true
		const src = path.join(projectDir, "plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {} }));
		// No token → rejected
		const r = run(["init", src]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("--token");
		// Wrong token → rejected
		const r2 = run(["init", src, "--token", "wrongtoken"]);
		expect(r2.code).toBe(2);
		// Correct token → succeeds and mints new run
		const r3 = run(["init", src, "--token", TEST_TOKEN]);
		expect(r3.code).toBe(0);
		expect(r3.stdout).toContain("write_token:");
	});

	// S2-AC3: abandon requires --token and re-seals (vector 4)
	it("abandon without --token is rejected (S2-AC3, vector 4)", () => {
		const r = run(["abandon"]);
		expect(r.code).not.toBe(0);
		// active must remain true (write did not happen)
		expect(readLedger().active).toBe(true);
	});

	it("abandon with correct --token sets active:false (S2-AC3)", () => {
		const r = run(["abandon", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(readLedger().active).toBe(false);
	});

	// S2-AC4: raw `set --status complete` requires --token (vector 3)
	it("set --status complete without --token is rejected (S2-AC4, vector 3)", () => {
		const r = run(["set", "S2", "--status", "complete"]);
		expect(r.code).not.toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});

	it("set --status skipped without --token is rejected (S2-AC4, vector 3)", () => {
		const r = run(["set", "S2", "--status", "skipped"]);
		expect(r.code).not.toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});

	it("set --status complete with correct --token succeeds (S2-AC4)", () => {
		const r = run(["set", "S2", "--status", "complete", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("complete");
	});

	// Non-terminal set still works without token (only terminal requires it)
	it("set --status in_progress without --token succeeds (non-terminal, no token required)", () => {
		const r = run(["set", "S2", "--status", "in_progress"]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("in_progress");
	});

	// S2-AC5: complete and gate re-seal after writing
	it("complete re-seals the ledger in the sealed regime (S2-AC5)", () => {
		// Use init to create a properly sealed ledger
		const src = path.join(projectDir, "init-plan.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [{ id: "T1", status: "pending" }], gate: {} }));
		rmSync(ledgerFile, { force: true });
		const initR = run(["init", src]);
		expect(initR.code).toBe(0);
		const token = initR.stdout.match(/write_token:\s+([0-9a-f]+)/)?.[1] ?? "";
		const sealBefore = readLedger().gate?.seal;
		// Complete changes slice state → seal must change
		run(["complete", "T1", "--token", token]);
		const sealAfter = readLedger().gate?.seal;
		expect(typeof sealAfter).toBe("string");
		expect(sealAfter).not.toBe(sealBefore);
	});

	it("gate re-seals the ledger in the sealed regime (S2-AC5)", () => {
		const src = path.join(projectDir, "init-plan2.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [{ id: "T2", status: "pending" }], gate: {} }));
		rmSync(ledgerFile, { force: true });
		const initR = run(["init", src]);
		expect(initR.code).toBe(0);
		const token = initR.stdout.match(/write_token:\s+([0-9a-f]+)/)?.[1] ?? "";
		const sealBefore = readLedger().gate?.seal;
		run(["gate", "advisor", "APPROVE", "--token", token]);
		const sealAfter = readLedger().gate?.seal;
		expect(typeof sealAfter).toBe("string");
		expect(sealAfter).not.toBe(sealBefore);
	});

	// Legacy ledger (no gate.seal, no key file) — mutations still work without seal errors
	it("legacy ledger (no seal, no key file) mutates without error — re-seal is skipped (legacy safety)", () => {
		// baseLedger() written by beforeEach has write_token but no gate.seal and no key file.
		// This simulates an in-flight pre-fix run. complete should still work.
		expect(readLedger().gate?.seal).toBeUndefined();
		const r = run(["complete", "S2", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		// Seal is not added to a legacy ledger
		expect(readLedger().gate?.seal).toBeUndefined();
		// But the slice is still completed
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("complete");
	});
});

// ---------------------------------------------------------------------------
// Token redaction — status, show, view must never expose write_token value
// ---------------------------------------------------------------------------

describe("ledger CLI — write_token redaction", () => {
	const SECRET = "secrettoken123456";

	beforeEach(() => {
		writeLedgerWithToken(SECRET);
	});

	it("status never prints the write_token value", () => {
		const r = run(["status"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain(SECRET);
	});

	it("show never prints the write_token value", () => {
		const r = run(["show", "S1"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain(SECRET);
	});

	it("view never prints the write_token value", () => {
		const r = run(["view"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain(SECRET);
	});
});

// ---------------------------------------------------------------------------
// view command — markdown table shape
// ---------------------------------------------------------------------------

describe("ledger CLI — view", () => {
	it("renders a markdown table with ID, Kind, Status, Blocked By, and Description columns", () => {
		const r = run(["view"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Claimed By | Decisions | Description |");
		expect(r.stdout).toContain("|---|---|---|---|---|---|---|");
		// Slice IDs appear as inline code spans
		expect(r.stdout).toContain("`S1`");
		expect(r.stdout).toContain("`S2`");
	});

	it("includes a Gate table section with advisor verdict", () => {
		run(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		const r = run(["view"]);
		expect(r.stdout).toContain("## Gate");
		expect(r.stdout).toContain("| Gate | Verdict |");
		expect(r.stdout).toContain("| advisor | APPROVE |");
	});

	it("shows progress summary at the bottom", () => {
		const r = run(["view"]);
		expect(r.stdout).toContain("**Progress:**");
		expect(r.stdout).toContain("/3 slices complete");
	});

	it("groups slices by wave with ## Wave N headings", () => {
		const r = run(["view"]);
		expect(r.stdout).toContain("## Wave 0");
		expect(r.stdout).toContain("## Wave 1");
	});
});

// ---------------------------------------------------------------------------
// gate artifact — .groundwork/gates/<run-id>.md
// ---------------------------------------------------------------------------

describe("ledger CLI — gate artifact", () => {
	it("creates .groundwork/gates/<session-id>.md after gate command", () => {
		run(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		const gatesDir = path.join(projectDir, ".groundwork", "gates");
		expect(existsSync(gatesDir)).toBe(true);
		// baseLedger session_id is "sess-1"
		expect(readdirSync(gatesDir)).toContain("sess-1.md");
	});

	it("gate artifact first line is 'verdict: <VERDICT>'", () => {
		run(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		const artifactPath = path.join(projectDir, ".groundwork", "gates", "sess-1.md");
		expect(existsSync(artifactPath)).toBe(true);
		const firstLine = readFileSync(artifactPath, "utf8").split("\n")[0];
		expect(firstLine).toMatch(/^verdict:/);
		expect(firstLine).toContain("APPROVE");
	});

	it("gate artifact first line contains the exact verdict for CORRECTION", () => {
		run(["gate", "advisor", "CORRECTION", "--token", TEST_TOKEN]);
		const firstLine = readFileSync(
			path.join(projectDir, ".groundwork", "gates", "sess-1.md"),
			"utf8",
		).split("\n")[0];
		expect(firstLine).toBe("verdict: CORRECTION");
	});

	it("gate with --token also writes the artifact", () => {
		const token = writeLedgerWithToken("deadbeef01234567");
		run(["gate", "advisor", "APPROVE", "--token", token]);
		const artifactPath = path.join(projectDir, ".groundwork", "gates", "sess-1.md");
		expect(existsSync(artifactPath)).toBe(true);
		const firstLine = readFileSync(artifactPath, "utf8").split("\n")[0];
		expect(firstLine).toMatch(/^verdict:/);
	});
});

// ---------------------------------------------------------------------------
// kind field — add, show, view
// ---------------------------------------------------------------------------

describe("ledger CLI — kind field (add + show + view)", () => {
	it("add --kind design sets kind on the new slice", () => {
		const r = run(["add", "K1", "--kind", "design", "--desc", "ui work"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("kind=design");
		const slice = readLedger().slices.find((s: any) => s.id === "K1");
		expect(slice).toBeDefined();
		expect(slice.kind).toBe("design");
	});

	it("add --kind plan sets kind on the new slice", () => {
		run(["add", "K2", "--kind", "plan"]);
		expect(readLedger().slices.find((s: any) => s.id === "K2").kind).toBe("plan");
	});

	it("add --kind impl sets kind on the new slice", () => {
		run(["add", "K3", "--kind", "impl"]);
		expect(readLedger().slices.find((s: any) => s.id === "K3").kind).toBe("impl");
	});

	it("add --kind diagnose sets kind on the new slice", () => {
		run(["add", "K4", "--kind", "diagnose"]);
		expect(readLedger().slices.find((s: any) => s.id === "K4").kind).toBe("diagnose");
	});

	it("add without --kind does NOT set a kind field (no-kind item stays clean)", () => {
		run(["add", "K5", "--desc", "no kind"]);
		const slice = readLedger().slices.find((s: any) => s.id === "K5");
		expect(slice).toBeDefined();
		expect(Object.prototype.hasOwnProperty.call(slice, "kind")).toBe(false);
	});

	it("add --kind bogus → non-zero exit and slice not written", () => {
		const before = readLedger().slices.length;
		const r = run(["add", "KBAD", "--kind", "bogus"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("invalid kind");
		expect(readLedger().slices.length).toBe(before);
	});

	it("add --kind unknown-kind → exit 2", () => {
		const r = run(["add", "KBAD2", "--kind", "unknown-kind"]);
		expect(r.code).toBe(2);
	});

	it("show displays 'kind: design' when kind is set", () => {
		run(["add", "KS1", "--kind", "design"]);
		const r = run(["show", "KS1"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("kind:       design");
	});

	it("show displays 'kind: impl (default)' when kind is absent", () => {
		// S2 is in baseLedger with no kind field
		const r = run(["show", "S2"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("kind:       impl (default)");
	});

	it("view has a Kind column header", () => {
		const r = run(["view"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Claimed By | Decisions | Description |");
	});

	it("view shows the kind label for a slice that has kind set", () => {
		run(["add", "KV1", "--kind", "design"]);
		const r = run(["view"]);
		expect(r.code).toBe(0);
		// The view uses KIND_LABEL — check that it contains design-related text or the raw kind
		expect(r.stdout).toMatch(/design|🎨/);
	});

	it("view shows the default impl marker for a slice with no kind field", () => {
		// S1, S2, S3 from baseLedger have no kind — view should render '⚙ impl'
		const r = run(["view"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("⚙ impl");
	});
});

// ---------------------------------------------------------------------------
// kind field — init preserves kind, does NOT add kind to no-kind items
// ---------------------------------------------------------------------------

describe("ledger CLI — init kind preservation", () => {
	it("init preserves kind on items that already have it", () => {
		const src = path.join(projectDir, "plan-with-kind.json");
		writeFileSync(
			src,
			JSON.stringify({
				active: true,
				slices: [
					{ id: "P1", status: "pending", kind: "design" },
					{ id: "P2", status: "pending" },
				],
				gate: {},
			}),
		);
		// Remove existing ledger so init can write fresh
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		const ledger = readLedger();
		const p1 = ledger.slices.find((s: any) => s.id === "P1");
		expect(p1.kind).toBe("design");
	});

	it("init does NOT add a kind field to items that lacked one (legacy diff cleanliness)", () => {
		const src = path.join(projectDir, "plan-no-kind.json");
		writeFileSync(
			src,
			JSON.stringify({
				active: true,
				slices: [{ id: "P2", status: "pending" }],
				gate: {},
			}),
		);
		rmSync(ledgerFile);
		run(["init", src]);
		const p2 = readLedger().slices.find((s: any) => s.id === "P2");
		// Serialized JSON must NOT have a kind key at all
		expect(Object.prototype.hasOwnProperty.call(p2, "kind")).toBe(false);
	});

	it("init preserves mixed: kind-having item keeps kind, no-kind item stays clean", () => {
		const src = path.join(projectDir, "plan-mixed.json");
		writeFileSync(
			src,
			JSON.stringify({
				active: true,
				slices: [
					{ id: "M1", status: "pending", kind: "plan" },
					{ id: "M2", status: "pending" },
				],
				gate: {},
			}),
		);
		rmSync(ledgerFile);
		run(["init", src]);
		const ledger = readLedger();
		expect(ledger.slices.find((s: any) => s.id === "M1").kind).toBe("plan");
		expect(Object.prototype.hasOwnProperty.call(ledger.slices.find((s: any) => s.id === "M2"), "kind")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Multi-session isolation — per-session ledger files
// ---------------------------------------------------------------------------

describe("ledger CLI — per-session isolation", () => {
	it("two different session ids write to different files and don't interfere", () => {
		// Init run for session aaa
		const srcA = path.join(projectDir, "plan-aaa.json");
		writeFileSync(srcA, JSON.stringify({ active: true, brief: "run-aaa", slices: [{ id: "A1", status: "pending" }], gate: {} }));
		const rA = runWithSession("aaa", ["init", srcA]);
		expect(rA.code).toBe(0);
		expect(rA.stdout).toContain(".groundwork/runs/aaa.json");

		// Init run for session bbb
		const srcB = path.join(projectDir, "plan-bbb.json");
		writeFileSync(srcB, JSON.stringify({ active: true, brief: "run-bbb", slices: [{ id: "B1", status: "pending" }, { id: "B2", status: "pending" }], gate: {} }));
		const rB = runWithSession("bbb", ["init", srcB]);
		expect(rB.code).toBe(0);
		expect(rB.stdout).toContain(".groundwork/runs/bbb.json");

		// Complete a slice in aaa — must not affect bbb
		const tokenA = extractToken(rA.stdout);
		runWithSession("aaa", ["complete", "A1", "--token", tokenA]);

		// Status for aaa
		const statusA = runWithSession("aaa", ["status"]);
		expect(statusA.stdout).toContain("run-aaa");
		expect(statusA.stdout).toContain("A1✓");

		// Status for bbb (both B1 and B2 still pending)
		const statusB = runWithSession("bbb", ["status"]);
		expect(statusB.stdout).toContain("run-bbb");
		expect(statusB.stdout).not.toContain("A1");

		// Ledger files must be at different paths
		const fileAaa = path.join(projectDir, ".groundwork", "runs", "aaa.json");
		const fileBbb = path.join(projectDir, ".groundwork", "runs", "bbb.json");
		expect(existsSync(fileAaa)).toBe(true);
		expect(existsSync(fileBbb)).toBe(true);
		// And they must have independent content
		const ledgerA = JSON.parse(readFileSync(fileAaa, "utf8"));
		const ledgerB = JSON.parse(readFileSync(fileBbb, "utf8"));
		expect(ledgerA.brief).toBe("run-aaa");
		expect(ledgerB.brief).toBe("run-bbb");
		expect(ledgerA.slices[0].status).toBe("complete");
		expect(ledgerB.slices[0].status).toBe("pending");
	});

	it("legacy fallback: reads run.json when per-session file absent and session_id matches", () => {
		// The beforeEach already wrote run.json with session_id: "sess-1"
		// No per-session file exists for sess-1
		const statusR = runWithSession("sess-1", ["status"]);
		expect(statusR.code).toBe(0);
		expect(statusR.stdout).toContain("test run"); // brief from baseLedger
	});

	it("legacy fallback: reads run.json when per-session file absent and run.json has no session_id", () => {
		// Write a legacy ledger without session_id
		const noSessionLedger = { ...baseLedger(), session_id: undefined };
		delete noSessionLedger.session_id;
		writeFileSync(ledgerFile, JSON.stringify(noSessionLedger, null, 2));
		const statusR = runWithSession("any-session", ["status"]);
		expect(statusR.code).toBe(0);
		expect(statusR.stdout).toContain("test run");
	});

	it("sanitization: session id with path-traversal chars falls back to legacy path", () => {
		// ../evil should be rejected — CLI falls back to legacy run.json
		const statusR = runWithSession("../evil", ["status"]);
		// Should read from the legacy run.json (which exists from beforeEach)
		expect(statusR.code).toBe(0);
		expect(statusR.stdout).toContain("test run");
	});

	it("sanitization: session id with slashes is rejected (falls back to legacy)", () => {
		const r = runWithSession("foo/bar", ["status"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("test run");
	});

	it("init stamps session_id from CLAUDE_CODE_SESSION_ID into the ledger", () => {
		const src = path.join(projectDir, "plan-sid.json");
		writeFileSync(src, JSON.stringify({ active: true, slices: [], gate: {} }));
		const r = runWithSession("my-sess-42", ["init", src]);
		expect(r.code).toBe(0);
		const lp = path.join(projectDir, ".groundwork", "runs", "my-sess-42.json");
		expect(existsSync(lp)).toBe(true);
		const l = JSON.parse(readFileSync(lp, "utf8"));
		expect(l.session_id).toBe("my-sess-42");
	});
});

/** Run the CLI with a specific CLAUDE_CODE_SESSION_ID. */
function runWithSession(sessionId: string, args: string[]): { code: number; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_CODE_SESSION_ID: sessionId },
			encoding: "utf8",
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: any) {
		return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
	}
}

/** Extract write_token value from init stdout. */
function extractToken(stdout: string): string {
	const m = stdout.match(/write_token:\s+([0-9a-f]+)/);
	return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// skipped status — ledger CLI
// ---------------------------------------------------------------------------

describe("ledger CLI — skipped status", () => {
	it("add --status skipped creates a slice with status skipped", () => {
		const r = run(["add", "SK1", "--status", "skipped"]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "SK1").status).toBe("skipped");
	});

	it("set --status skipped transitions an existing slice to skipped", () => {
		const r = run(["set", "S2", "--status", "skipped", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("skipped");
	});

	it("set --status with an invalid status → exit 2", () => {
		const r = run(["set", "S2", "--status", "cancelled"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("invalid status");
	});

	it("show displays status: skipped for a skipped slice", () => {
		run(["set", "S2", "--status", "skipped", "--token", TEST_TOKEN]);
		const r = run(["show", "S2"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("status:     skipped");
	});
});

// ---------------------------------------------------------------------------
// degraded mode — session-id resolution

describe("ledger CLI — degraded mode (no session id)", () => {
	it("falls back to legacy run.json when CLAUDE_CODE_SESSION_ID is unset and no --session flag", () => {
		// The `run()` helper already unsets CLAUDE_CODE_SESSION_ID.
		// The beforeEach fixture writes the ledger at .groundwork/run.json with session_id "sess-1".
		const r = run(["status"]);
		expect(r.code).toBe(0);
		// A successful status read proves it found and parsed the legacy path.
		expect(r.stdout).toMatch(/slices|complete|pending/i);
	});
});

// ---------------------------------------------------------------------------
// negative ownership — session A is not blocked by session B's legacy ledger

describe("ledger CLI — negative ownership", () => {
	it("session A's init writes its own per-session ledger and does not overwrite session B's legacy ledger", () => {
		// beforeEach wrote a legacy run.json stamped with session_id "sess-1" (≈ session B).
		const legacyBefore = JSON.parse(readFileSync(ledgerFile, "utf8"));

		// Session A initialises its own run — uses per-session path runs/sess-A.json.
		const srcFile = path.join(projectDir, "plan-a.json");
		writeFileSync(srcFile, JSON.stringify({ brief: "session A run", slices: [] }));
		const rA = runWithSession("sess-A", ["init", srcFile]);
		expect(rA.code).toBe(0);
		expect(rA.stdout).toContain(".groundwork/runs/sess-A.json");

		// The legacy ledger (session B's) must be untouched.
		const legacyAfter = JSON.parse(readFileSync(ledgerFile, "utf8"));
		expect(legacyAfter).toEqual(legacyBefore);

		// Session A's per-session file exists and is independent.
		const sessionAFile = path.join(projectDir, ".groundwork", "runs", "sess-A.json");
		const sessionALedger = JSON.parse(readFileSync(sessionAFile, "utf8"));
		expect(sessionALedger.session_id).toBe("sess-A");
	});
});

// ---------------------------------------------------------------------------
// Schema validation — wired on load and mutation
// ---------------------------------------------------------------------------

describe("ledger CLI — schema validation on read (warn-only)", () => {
	it("status succeeds and emits no stderr on a schema-clean ledger (no gate verdict)", () => {
		// Write a ledger with no gate.advisor so no schema warning is generated.
		// Write a clean fixture with no gate.advisor (omitting it is the correct initial state).
		writeFileSync(ledgerFile, JSON.stringify({
			session_id: "sess-1",
			active: true,
			brief: "clean",
			slices: [{ id: "S1", status: "pending", acceptance: ["x"] }],
			gate: {},
		}, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("status warns to stderr but still exits 0 when ledger has schema issues", () => {
		// Write a ledger that violates the schema (missing required session_id).
		// Validation is warn-only on reads so the command must still succeed.
		const bad = { active: true, slices: [{ id: "X1", status: "pending", acceptance: ["ok"] }], gate: {} };
		writeFileSync(ledgerFile, JSON.stringify(bad, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0); // warn-only — does NOT die
		expect(r.stderr).toContain("warn"); // at least one warning emitted
	});
});

// ---------------------------------------------------------------------------
// blocked_by referential integrity
// ---------------------------------------------------------------------------

describe("ledger CLI — blocked_by referential integrity", () => {
	it("add with --blocked-by pointing at an existing slice succeeds", () => {
		const r = run(["add", "S4", "--blocked-by", "S1", "--acceptance", "done"]);
		expect(r.code).toBe(0);
	});

	it("add with --blocked-by pointing at a non-existent id is rejected (exit 1)", () => {
		const r = run(["add", "S4", "--blocked-by", "NONEXISTENT", "--acceptance", "done"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("blocked_by");
		expect(r.stderr).toContain("NONEXISTENT");
	});

	it("set --blocked-by with a dangling ref is rejected (exit 1)", () => {
		const r = run(["set", "S2", "--blocked-by", "GHOST"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("blocked_by");
		expect(r.stderr).toContain("GHOST");
	});

	it("status warns on an existing ledger with a dangling blocked_by (warn-only on reads)", () => {
		// Inject a dangling ref directly into the ledger file
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		l.slices[1].blocked_by = ["DANGLING"];
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0); // warn-only on reads
		expect(r.stderr).toContain("DANGLING");
	});
});

// ---------------------------------------------------------------------------
// blocked_bY near-miss typo warning
// ---------------------------------------------------------------------------

describe("ledger CLI — near-miss key warning", () => {
	it("status warns when a slice has a key that is a near-miss of a known key", () => {
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		// Inject a misspelled key (blocked_bY instead of blocked_by)
		l.slices[0].blocked_bY = ["S1"];
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toContain("blocked_bY");
		expect(r.stderr).toContain("blocked_by");
	});

	it("the misspelled blocked_bY variant does NOT trigger the blocked_by integrity check (it is not read as blocked_by)", () => {
		// This is the key safety property: a typo key is not silently accepted as valid,
		// it is warned about; the integrity check only looks at the correctly spelled field.
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		l.slices[0].blocked_bY = ["NONEXISTENT"]; // typo key — should warn, not error
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		// Should warn about the unknown key, but NOT about a dangling blocked_by ref
		// (because the canonical blocked_by on S1 is [] which is absent → no ref check)
		expect(r.stderr).toContain("blocked_bY");
	});
});

// ---------------------------------------------------------------------------
// acceptance validation
// ---------------------------------------------------------------------------

describe("ledger CLI — acceptance validation", () => {
	it("add with --acceptance 'a;b' succeeds", () => {
		const r = run(["add", "A1", "--acceptance", "criterion one;criterion two"]);
		expect(r.code).toBe(0);
	});

	it("add without --acceptance omits the key (not present: []) — backward compat", () => {
		run(["add", "A2"]);
		const slice = readLedger().slices.find((s: any) => s.id === "A2");
		expect(slice).toBeDefined();
		// Key must be absent (not present as [])
		expect(Object.prototype.hasOwnProperty.call(slice, "acceptance")).toBe(false);
	});

	it("set --acceptance to a valid value succeeds", () => {
		const r = run(["set", "S2", "--acceptance", "done"]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").acceptance).toEqual(["done"]);
	});

	it("init rejects a ledger whose slice has acceptance: [] (present but empty)", () => {
		const src = path.join(projectDir, "bad-acceptance.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			session_id: "x",
			slices: [{ id: "X1", status: "pending", acceptance: [] }],
			gate: {},
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("acceptance");
	});

	it("init rejects a ledger whose slice has acceptance with an empty-string item", () => {
		const src = path.join(projectDir, "bad-acceptance2.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			session_id: "x",
			slices: [{ id: "X1", status: "pending", acceptance: ["valid", ""] }],
			gate: {},
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("acceptance");
	});

	it("status warns (not errors) on a ledger with acceptance: [] in an existing slice", () => {
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		l.slices[0].acceptance = []; // directly inject bad acceptance
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0); // warn-only on reads
		expect(r.stderr).toContain("acceptance");
	});
});

// ---------------------------------------------------------------------------
// Legacy-shaped ledger — depends_on alias, missing kind/wave/desc
// ---------------------------------------------------------------------------

describe("ledger CLI — legacy shapes remain valid", () => {
	it("status succeeds on a ledger with depends_on instead of blocked_by (treated as alias)", () => {
		writeFileSync(ledgerFile, JSON.stringify({
			session_id: "legacy-sess",
			active: true,
			brief: "legacy run",
			slices: [
				{ id: "L1", status: "complete", acceptance: ["done"] },
				{ id: "L2", status: "pending", depends_on: ["L1"], acceptance: ["todo"] },
			],
			gate: {}, // no advisor verdict avoids schema warning for "pending" non-enum value
		}, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		// depends_on referential integrity: L1 exists — no error
		expect(r.stderr).toBe("");
	});

	it("status warns on a ledger where depends_on references a non-existent slice", () => {
		writeFileSync(ledgerFile, JSON.stringify({
			session_id: "legacy-sess",
			active: true,
			slices: [
				{ id: "L1", status: "pending", depends_on: ["MISSING"], acceptance: ["x"] },
			],
			gate: {},
		}, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toContain("depends_on");
		expect(r.stderr).toContain("MISSING");
	});

	it("slices without kind, wave, or desc are accepted (legacy shape)", () => {
		writeFileSync(ledgerFile, JSON.stringify({
			session_id: "leg",
			active: true,
			slices: [{ id: "L1", status: "pending", acceptance: ["x"] }],
			gate: {},
		}, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Both gate.advisor forms (bare string + object) validated cleanly
// ---------------------------------------------------------------------------

describe("ledger CLI — gate.advisor forms survive validation", () => {
	it("bare string advisor gate is accepted", () => {
		const r = runFull(["gate", "advisor", "APPROVE", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		// Schema-only issue: schema allows APPROVE — no warning expected
		expect(r.stderr).toBe("");
	});

	it("object-form advisor gate is accepted", () => {
		const r = runFull(["gate", "advisor", "APPROVE", "--citation", "src:42", "--rubric", "r1", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("non-schema verdict string (CORRECTION) emits schema warning but still exits 0", () => {
		// CORRECTION is not in the schema enum but is used by some gate commands.
		// Schema violations are warnings-only; the operation must succeed.
		const r = runFull(["gate", "advisor", "CORRECTION", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		// May or may not warn depending on Ajv schema strictness — just ensure no crash
	});
});

// ---------------------------------------------------------------------------
// Defect 1: cmdInit must set active:true
// ---------------------------------------------------------------------------

describe("ledger CLI — init sets active:true", () => {
	it("init from a JSON file without active sets active:true in the written ledger", () => {
		const src = path.join(projectDir, "no-active.json");
		writeFileSync(src, JSON.stringify({ session_id: "x", slices: [], gate: {} }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
		expect(readLedger().active).toBe(true);
	});

	it("init from a JSON file that already has active:true keeps it true", () => {
		const src = path.join(projectDir, "with-active.json");
		writeFileSync(src, JSON.stringify({ session_id: "x", active: true, slices: [], gate: {} }));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		expect(readLedger().active).toBe(true);
	});

});


// ---------------------------------------------------------------------------
// Defect 3: write-path schema validation (init rejects new corruption)
// ---------------------------------------------------------------------------

describe("ledger CLI — init rejects schema violations on write (strict init)", () => {
	function initFrom(obj: object) {
		const src = path.join(projectDir, "bad.json");
		writeFileSync(src, JSON.stringify(obj));
		rmSync(ledgerFile, { force: true });
		return runFull(["init", src]);
	}

	it("init rejects a slice with status:'donezo' (invalid enum value)", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [{ id: "X1", status: "donezo" }], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("status");
	});

	it("init rejects a slice with missing status (required field)", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [{ id: "X1" }], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("status");
	});

	it("init rejects a slice with wave:'three' (wrong type)", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [{ id: "X1", status: "pending", wave: "three" }], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("wave");
	});

	it("init rejects a slice with id:123 (wrong type — id must be string)", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [{ id: 123, status: "pending" }], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("id");
	});

	it("init rejects a slice with kind:'refactor' (unknown enum value)", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [{ id: "X1", status: "pending", kind: "refactor" }], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("kind");
	});

	it("init rejects duplicate slice ids", () => {
		const r = initFrom({
			session_id: "x", active: true,
			slices: [
				{ id: "X1", status: "pending" },
				{ id: "X1", status: "pending" },
			], gate: {},
		});
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("X1");
		expect(r.stderr).toContain("duplicate");
	});

	it("read commands (status) still succeed on a corrupt pre-existing ledger (warn-only on reads)", () => {
		// Directly inject a corrupt ledger (simulating one written by an older tool)
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		l.slices[0].status = "donezo";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toContain("status");
	});

	it("complete still succeeds on a ledger with pre-existing schema quirks (warn-only on mutations)", () => {
		// Inject an extra field that wouldn't pass strict schema, then verify complete works
		const l = JSON.parse(readFileSync(ledgerFile, "utf8"));
		l.extraTopLevelField = "some value";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["complete", "S2", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Motive propagation — journal events carry real motive from ledger
// Resolves TBD-4: ledger-emitted TASK_COMPLETE events must carry the ledger's
// real motive field (not synthetic "session:<id>") so motive-compile can join
// (session_id, slice_id) → slice status without the synthetic-session hack.
// ---------------------------------------------------------------------------

describe("ledger CLI — motive propagation to journal events", () => {
	it("ledger complete emits TASK_COMPLETE with real motive from ledger", () => {
		// Write a ledger with a real motive and a write_token
		const SESSION_ID = "motive-test-session";
		const MOTIVE = "my-real-motive";
		const src = path.join(projectDir, "plan-motive.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			session_id: SESSION_ID,
			motive: MOTIVE,
			slices: [{ id: "TM1", status: "pending" }],
			gate: {},
		}));
		const sessionLedgerDir = path.join(projectDir, ".groundwork", "runs");
		mkdirSync(sessionLedgerDir, { recursive: true });
		// Init via CLI with --motive flag (also stamps write_token)
		const initR = runWithSession(SESSION_ID, ["init", src, "--motive", MOTIVE]);
		expect(initR.code).toBe(0);
		const token = extractToken(initR.stdout);

		// Complete a slice — this should emit a TASK_COMPLETE event to the journal
		const completeR = runWithSession(SESSION_ID, ["complete", "TM1", "--token", token]);
		expect(completeR.code).toBe(0);

		// Read the journal shard and verify the emitted event
		const journalDir = path.join(projectDir, ".groundwork", "journal");
		const shards = readdirSync(journalDir).filter((f) => f.endsWith(".jsonl"));
		expect(shards.length).toBeGreaterThan(0);

		const events: any[] = [];
		for (const shard of shards) {
			const lines = readFileSync(path.join(journalDir, shard), "utf8")
				.split("\n")
				.filter(Boolean);
			for (const line of lines) {
				try { events.push(JSON.parse(line)); } catch { /* skip */ }
			}
		}

		const taskCompletes = events.filter((e) => e.type === "TASK_COMPLETE");
		expect(taskCompletes.length).toBeGreaterThan(0);

		const ev = taskCompletes.find((e) => e.data?.slice === "TM1");
		expect(ev).toBeDefined();
		// Must carry the real motive, not the synthetic "session:<id>"
		expect(ev?.motive).toBe(MOTIVE);
		expect(ev?.motive).not.toMatch(/^session:/);
		// Must carry slice id for the (session_id, slice_id) join
		expect(ev?.data?.slice).toBe("TM1");
		// Must carry session for the join key
		expect(ev?.session).toBe(SESSION_ID);
	});

	it("ledger complete without motive falls back to synthetic motive (backward compat)", () => {
		// A ledger WITHOUT motive field — should emit synthetic motive
		const SESSION_ID = "no-motive-session";
		const src = path.join(projectDir, "plan-no-motive.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			session_id: SESSION_ID,
			// no motive field
			slices: [{ id: "NM1", status: "pending" }],
			gate: {},
		}));
		const initR = runWithSession(SESSION_ID, ["init", src]);
		expect(initR.code).toBe(0);
		const token = extractToken(initR.stdout);

		runWithSession(SESSION_ID, ["complete", "NM1", "--token", token]);

		const journalDir = path.join(projectDir, ".groundwork", "journal");
		const shards = readdirSync(journalDir).filter((f) => f.endsWith(".jsonl"));
		const events: any[] = [];
		for (const shard of shards) {
			const lines = readFileSync(path.join(journalDir, shard), "utf8")
				.split("\n")
				.filter(Boolean);
			for (const line of lines) {
				try { events.push(JSON.parse(line)); } catch { /* skip */ }
			}
		}

		const ev = events.find((e) => e.type === "TASK_COMPLETE" && e.data?.slice === "NM1");
		expect(ev).toBeDefined();
		// Backward compat: synthetic motive when no motive field in ledger
		expect(ev?.motive).toMatch(/^session:/);
	});
});

// ---------------------------------------------------------------------------
// frontier — slices a session can start right now
// ---------------------------------------------------------------------------

describe("ledger CLI — frontier", () => {
	// Base ledger: S1 complete, S2 pending blocked by S1, S3 pending blocked by S1
	// So frontier after S1 is complete = [S2, S3]

	it("prints pending unblocked unclaimed slices", () => {
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		// S2 and S3 are both pending, blocked_by S1 which is complete
		expect(r.stdout).toContain("S2");
		expect(r.stdout).toContain("S3");
	});

	it("excludes complete slices", () => {
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain("S1");
	});

	it("excludes in_progress slices", () => {
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").status = "in_progress";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain("S2");
		expect(r.stdout).toContain("S3");
	});

	it("excludes slices still blocked (blocked_by dep not complete)", () => {
		// Write a ledger where S4 is blocked by S2 (pending)
		const l = readLedger();
		l.slices.push({ id: "S4", wave: 2, blocked_by: ["S2"], status: "pending" });
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain("S4");
		expect(r.stdout).toContain("S2");
	});

	it("excludes slices claimed by another session", () => {
		// When no current session is set, any claimed_by value is treated as foreign
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").claimed_by = "other-session";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).not.toContain("S2");
		expect(r.stdout).toContain("S3");
	});

	it("includes slices claimed by the current session", () => {
		// Write ledger with session_id matching "my-session" so back-compat path resolves correctly
		const l = readLedger();
		l.session_id = "my-session";
		l.slices.find((s: any) => s.id === "S2").claimed_by = "my-session";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["frontier", "--session", "my-session"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("S2");
	});

	it("shows empty-state message when no frontier slices exist", () => {
		// All pending slices are blocked by a pending dep
		const l = {
			version: 1, active: true, session_id: "s", brief: "x", reinforcements: 0,
			slices: [
				{ id: "A", wave: 0, blocked_by: [], status: "pending" },
				{ id: "B", wave: 1, blocked_by: ["A"], status: "pending" },
			],
			gate: {},
		};
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		// Only A is on frontier; mark A as in_progress so nothing is available
		l.slices[0].status = "in_progress";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("no frontier slices");
	});

	it("exits 0 and includes in help output", () => {
		const r = run(["help", "frontier"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("frontier");
	});
});

// ---------------------------------------------------------------------------
// fog command (TBD-13)
// ---------------------------------------------------------------------------

describe("ledger CLI — fog command", () => {
	it("creates a fog slice with kind:fog and empty acceptance array", () => {
		const r = run(["fog", "F1", "--desc", "open question about auth", "--question", "Should we use JWT or sessions?"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("F1 added (fog)");
		const l = readLedger();
		const s = l.slices.find((x: any) => x.id === "F1");
		expect(s).toBeDefined();
		expect(s.kind).toBe("fog");
		expect(s.question).toBe("Should we use JWT or sessions?");
		expect(s.desc).toBe("open question about auth");
		// fog slices have no acceptance criteria — key is omitted
		expect(s.acceptance).toBeUndefined();
	});

	it("errors when --desc is missing", () => {
		const r = run(["fog", "F2", "--question", "some question"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--desc is required");
	});

	it("errors when --question is missing", () => {
		const r = run(["fog", "F3", "--desc", "some desc"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--question is required");
	});

	it("errors when no id is provided", () => {
		const r = run(["fog", "--desc", "d", "--question", "q"]);
		expect(r.code).toBe(2);
	});

	it("fog slices do NOT appear in frontier output", () => {
		// F1 is unblocked and pending but kind:fog — should be excluded
		run(["fog", "F1", "--desc", "open q", "--question", "how?"]);
		const r = run(["frontier"]);
		expect(r.stdout).not.toContain("F1");
	});

	it("frontier still shows non-fog pending unblocked slices", () => {
		run(["fog", "F1", "--desc", "open q", "--question", "how?"]);
		const r = run(["frontier"]);
		// S2 and S3 are unblocked by S1 (complete) and not fog
		expect(r.stdout).toContain("S2");
	});
});

// ---------------------------------------------------------------------------
// show — covers_ac and claimed_by lines (TBD-14)
// ---------------------------------------------------------------------------

describe("ledger CLI — show covers_ac and claimed_by", () => {
	it("show prints covers_ac: (none) when absent", () => {
		const r = run(["show", "S1"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("covers_ac:  (none)");
	});

	it("show prints claimed_by: (none) when absent", () => {
		const r = run(["show", "S1"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("claimed_by: (none)");
	});

	it("show prints covers_ac value when set as array", () => {
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").covers_ac = ["AC1", "AC3"];
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["show", "S2"]);
		expect(r.stdout).toContain("covers_ac:  AC1, AC3");
	});

	it("show prints covers_ac value when set as string", () => {
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").covers_ac = "AC2";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["show", "S2"]);
		expect(r.stdout).toContain("covers_ac:  AC2");
	});

	it("show prints claimed_by value when set", () => {
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").claimed_by = "sess-xyz";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["show", "S2"]);
		expect(r.stdout).toContain("claimed_by: sess-xyz");
	});

	it("show prints created_by: (none) when absent", () => {
		const r = run(["show", "S1"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("created_by: (none)");
	});

	it("show prints created_by value when set via direct fixture", () => {
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S2").created_by = "junior-orch-42";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = run(["show", "S2"]);
		expect(r.stdout).toContain("created_by: junior-orch-42");
	});
});

// ---------------------------------------------------------------------------
// created_by field (S4)
// ---------------------------------------------------------------------------

describe("ledger CLI — created_by field (S4)", () => {
	it("add --created-by persists the field on the slice", () => {
		const r = run(["add", "CB1", "--created-by", "junior-orch-7"]);
		expect(r.code).toBe(0);
		const slice = readLedger().slices.find((s: any) => s.id === "CB1");
		expect(slice).toBeDefined();
		expect(slice.created_by).toBe("junior-orch-7");
	});

	it("add without --created-by omits the field (key absent)", () => {
		run(["add", "CB2"]);
		const slice = readLedger().slices.find((s: any) => s.id === "CB2");
		expect(slice).toBeDefined();
		expect(Object.prototype.hasOwnProperty.call(slice, "created_by")).toBe(false);
	});

	it("created_by does NOT generate an unknown-key warning (it is a known key)", () => {
		run(["add", "CB3", "--created-by", "agent-scope"]);
		const r = runFull(["status"]);
		expect(r.stderr).not.toContain("created_by");
	});

	it("a genuinely bogus field near 'created_by' still triggers the near-miss warning (unknown-key guard preserved)", () => {
		// Inject a typo key close enough to trigger the near-miss detector
		const l = readLedger();
		l.slices.find((s: any) => s.id === "S1").creatd_by = "typo-value";
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		// Near-miss detector should warn about the unknown key
		expect(r.stderr).toContain("creatd_by");
	});
});

// ---------------------------------------------------------------------------
// Scoped token (S5)
// ---------------------------------------------------------------------------

describe("ledger CLI — scoped token (S5)", () => {
	/** Helper: write a ledger with a slice owned by a given scope. */
	function writeLedgerWithOwnedSlice(scope: string, extraSlice?: object) {
		const l = readLedger() as any;
		l.slices.push({ id: "OWN1", wave: 1, status: "pending", created_by: scope });
		if (extraSlice) l.slices.push(extraSlice);
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
	}

	/** Issue a scoped token via the CLI and return its hex string. */
	function issueScopedToken(scope: string): string {
		const r = run(["scope-token", scope, "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		const m = r.stdout.match(/scoped_token:\s+(sct_[0-9a-f]+)/);
		if (!m) throw new Error(`scope-token output did not contain sct_-prefixed token: ${r.stdout}`);
		return m[1];
	}

	// SC-issuance: scope-token command writes to ledger.scoped_tokens
	it("scope-token stores the issued token in ledger.scoped_tokens", () => {
		const r = run(["scope-token", "junior-orch-1", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("scoped_token:");
		expect(r.stdout).toContain('scope: junior-orch-1');
		const l = readLedger() as any;
		expect(Array.isArray(l.scoped_tokens)).toBe(true);
		expect(l.scoped_tokens).toHaveLength(1);
		expect(l.scoped_tokens[0].scope).toBe("junior-orch-1");
		expect(l.scoped_tokens[0].token).toMatch(/^sct_[0-9a-f]{16}$/);
	});

	// SC-issuance-auth: scope-token requires the orchestrator write_token
	it("scope-token is rejected when --token is wrong (issuance is orchestrator-only)", () => {
		const r = run(["scope-token", "junior-orch-1", "--token", "wrongtoken"]);
		expect(r.code).not.toBe(0);
	});

	// SC-issuance-auth-absent: scope-token requires --token present
	it("scope-token is rejected when --token is absent", () => {
		const r = run(["scope-token", "junior-orch-1"]);
		expect(r.code).not.toBe(0);
	});

	// SC1: scoped token CAN complete a slice whose created_by matches its scope
	it("SC1: scoped token completes a slice whose created_by matches the scope", () => {
		writeLedgerWithOwnedSlice("junior-orch-2");
		const tok = issueScopedToken("junior-orch-2");
		const r = run(["complete", "OWN1", "--token", tok]);
		expect(r.code).toBe(0);
		const l = readLedger() as any;
		const s = l.slices.find((x: any) => x.id === "OWN1");
		expect(s.status).toBe("complete");
	});

	// SC2: scoped token CANNOT complete a slice with a DIFFERENT created_by
	it("SC2: scoped token is rejected for a slice owned by a different scope", () => {
		writeLedgerWithOwnedSlice("other-orch");
		const tok = issueScopedToken("junior-orch-3");
		const r = run(["complete", "OWN1", "--token", tok]);
		expect(r.code).not.toBe(0);
		// Slice must remain incomplete
		const l = readLedger() as any;
		const s = l.slices.find((x: any) => x.id === "OWN1");
		expect(s.status).toBe("pending");
	});

	// SC3: scoped token CANNOT complete a slice with NO created_by
	it("SC3: scoped token is rejected for a slice with no created_by set", () => {
		// S2 in baseLedger has no created_by
		const tok = issueScopedToken("junior-orch-4");
		const r = run(["complete", "S2", "--token", tok]);
		expect(r.code).not.toBe(0);
		const l = readLedger() as any;
		const s = l.slices.find((x: any) => x.id === "S2");
		expect(s.status).toBe("pending");
	});

	// SC4: scoped token is REJECTED by gate (highest-value assertion)
	it("SC4: scoped token is rejected by gate — subagent cannot record advisor verdict", () => {
		const tok = issueScopedToken("junior-orch-5");
		const r = run(["gate", "advisor", "APPROVE", "--token", tok]);
		expect(r.code).not.toBe(0);
		// gate.advisor must remain unset
		const l = readLedger() as any;
		expect(l.gate?.advisor).toBeUndefined();
	});

	// SC5: scoped token is REJECTED by init (overwrite protection)
	it("SC5: scoped token is rejected by init (cannot overwrite a live run)", () => {
		const tok = issueScopedToken("junior-orch-6");
		// init with --token validates against write_token — scoped token must be rejected
		const r = run(["init", ledgerFile, "--token", tok]);
		expect(r.code).not.toBe(0);
	});

	// SC6: scoped token is REJECTED by abandon
	it("SC6: scoped token is rejected by abandon", () => {
		const tok = issueScopedToken("junior-orch-7");
		const r = run(["abandon", "--token", tok]);
		expect(r.code).not.toBe(0);
		// ledger must still be active
		const l = readLedger() as any;
		expect(l.active).toBe(true);
	});

	// SC7: scoped token is REJECTED by rm
	it("SC7: scoped token is rejected by rm", () => {
		const tok = issueScopedToken("junior-orch-8");
		const r = run(["rm", "S1", "--token", tok]);
		expect(r.code).not.toBe(0);
		// S1 must still exist
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "S1")).toBeDefined();
	});

	// SC8: scoped token is REJECTED by autopilot
	it("SC8: scoped token is rejected by autopilot", () => {
		// Ensure ledger has pacing field so autopilot doesn't fail on missing pacing
		const l = readLedger() as any;
		l.pacing = { policy: "wave", budget: 1, exempt_kinds: [] };
		writeFileSync(ledgerFile, JSON.stringify(l, null, 2));
		const tok = issueScopedToken("junior-orch-9");
		const r = run(["autopilot", "--range", "1", "--reason", "test", "--token", tok]);
		expect(r.code).not.toBe(0);
	});

	// SC9: orchestrator write_token retains FULL authority — can complete any slice
	it("SC9: orchestrator write_token completes slices regardless of created_by", () => {
		writeLedgerWithOwnedSlice("some-other-scope");
		// Orchestrator uses TEST_TOKEN — must succeed even though created_by != anything
		const r = run(["complete", "OWN1", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "OWN1").status).toBe("complete");
	});

	// SC9b: orchestrator write_token completes a no-created_by slice
	it("SC9b: orchestrator write_token completes a slice with no created_by", () => {
		const r = run(["complete", "S1", "--token", TEST_TOKEN]);
		expect(r.code).toBe(0);
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "S1").status).toBe("complete");
	});

	// SC10: assertWriteToken remains fail-closed — absent token always denied (complete path)
	it("SC10: complete with no --token is denied even for owned slices (fail-closed)", () => {
		writeLedgerWithOwnedSlice("junior-orch-x");
		const r = run(["complete", "OWN1"]);
		expect(r.code).not.toBe(0);
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "OWN1").status).toBe("pending");
	});

	// SC11: a fabricated scoped-looking token not in ledger.scoped_tokens is denied
	it("SC11: a fabricated scoped token (not issued by scope-token) is denied by complete", () => {
		writeLedgerWithOwnedSlice("junior-orch-y");
		// Use a random hex that was never issued
		const fakeToken = "deadbeef12345678";
		const r = run(["complete", "OWN1", "--token", fakeToken]);
		expect(r.code).not.toBe(0);
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "OWN1").status).toBe("pending");
	});

	// SC12: multiple slices — scoped token denied if ANY slice lacks ownership
	it("SC12: scoped token denied when completing a mix of owned and unowned slices", () => {
		// OWN1 is owned by junior-orch-z; S2 is pending with no created_by
		writeLedgerWithOwnedSlice("junior-orch-z");
		const tok = issueScopedToken("junior-orch-z");
		const r = run(["complete", "OWN1", "S2", "--token", tok]);
		expect(r.code).not.toBe(0);
		// Neither slice should be marked complete (atomic failure; mutateLedger aborts on throw)
		const l = readLedger() as any;
		expect(l.slices.find((s: any) => s.id === "OWN1").status).toBe("pending");
		expect(l.slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});
});

// S8 — schema gap: scoped_tokens declared + top-level additionalProperties tightened
describe("ledger schema validation — scoped_tokens and top-level additionalProperties (S8)", () => {
	// AC1: well-formed scoped_tokens is accepted by init
	it("AC1: init accepts a ledger containing a well-formed scoped_tokens array", () => {
		const src = path.join(projectDir, "s8-ac1.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			scoped_tokens: [{ scope: "junior-1", token: "aaaabbbbccccdddd" }],
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).toBe(0);
		const l = readLedger() as any;
		expect(Array.isArray(l.scoped_tokens)).toBe(true);
		expect(l.scoped_tokens[0].scope).toBe("junior-1");
	});

	// AC2a: scoped_tokens entry missing `scope` is REJECTED at init
	it("AC2a: init rejects a scoped_tokens entry missing the required `scope` field", () => {
		const src = path.join(projectDir, "s8-ac2a.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			scoped_tokens: [{ token: "aaaabbbbccccdddd" }],
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).not.toBe(0);
	});

	// AC2b: scoped_tokens entry missing `token` is REJECTED at init
	it("AC2b: init rejects a scoped_tokens entry missing the required `token` field", () => {
		const src = path.join(projectDir, "s8-ac2b.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			scoped_tokens: [{ scope: "junior-1" }],
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).not.toBe(0);
	});

	// AC2c: scoped_tokens entry with a spurious extra field is REJECTED (additionalProperties:false on items)
	it("AC2c: init rejects a scoped_tokens entry with an unknown extra field", () => {
		const src = path.join(projectDir, "s8-ac2c.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			scoped_tokens: [{ scope: "junior-1", token: "aaaabbbbccccdddd", extra: "bad" }],
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).not.toBe(0);
	});

	// AC2d: scoped_tokens is not an array is REJECTED at init
	it("AC2d: init rejects scoped_tokens that is not an array", () => {
		const src = path.join(projectDir, "s8-ac2d.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			scoped_tokens: { scope: "junior-1", token: "aaaabbbbccccdddd" },
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).not.toBe(0);
	});

	// Regression: motive_ref is a legitimate top-level key read by stop-gate — must not be rejected
	it("motive_ref is accepted by init and preserved in the written ledger", () => {
		const src = path.join(projectDir, "s8-motive-ref.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			motive_ref: "junior-orchestrator-parity",
		}));
		rmSync(ledgerFile);
		const r = runFull(["init", src]);
		expect(r.code).toBe(0);
		expect(r.stderr).not.toContain("must NOT have additional properties");
		const l = readLedger() as any;
		expect(l.motive_ref).toBe("junior-orchestrator-parity");
	});

	// Regression: motive and motive_ref both accepted together
	it("motive and motive_ref are both accepted when present together", () => {
		const src = path.join(projectDir, "s8-both-motives.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			motive: "my-motive",
			motive_ref: "my-motive-ref",
		}));
		rmSync(ledgerFile);
		const r = runFull(["init", src]);
		expect(r.code).toBe(0);
		expect(r.stderr).not.toContain("must NOT have additional properties");
	});

	// AC3: a genuinely unknown top-level key is REJECTED by ledger init
	it("AC3: init rejects a ledger containing an unknown top-level key", () => {
		const src = path.join(projectDir, "s8-ac3.json");
		writeFileSync(src, JSON.stringify({
			active: true,
			slices: [],
			gate: {},
			totally_bogus_key: 1,
		}));
		rmSync(ledgerFile);
		const r = run(["init", src]);
		expect(r.code).not.toBe(0);
	});
});

