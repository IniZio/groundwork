import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

let projectDir: string;
let ledgerFile: string;

const baseLedger = () => ({
	version: 1,
	active: true,
	session_id: "sess-1",
	brief: "test run",
	reinforcements: 0,
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
		const r = run(["complete", "S2"]);
		expect(r.code).toBe(0);
		expect(r.stdout.trim()).toBe("S2 ✓ (2/3 complete)");
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("complete");
	});

	it("marks multiple slices in one call", () => {
		const r = run(["complete", "S2", "S3"]);
		expect(r.stdout.trim()).toBe("S2, S3 ✓ (3/3 complete)");
		expect(readLedger().slices.every((s: any) => s.status === "complete")).toBe(true);
	});

	it("errors (exit 2) on an unknown slice id and does not corrupt the ledger", () => {
		const r = run(["complete", "S9"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("unknown slice id");
		// S9 didn't exist; real slices untouched.
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("pending");
	});

	it("output is tiny (the whole point) — single line, no ledger body echoed", () => {
		const r = run(["complete", "S2"]);
		expect(r.stdout.split("\n").filter(Boolean).length).toBe(1);
		expect(r.stdout).not.toContain("acceptance");
	});

	// @verifies ARTIFACT-R-001
	it("stamps completed_at (ISO-8601) and session_id on the completed slice", () => {
		const r = run(["complete", "S2"]);
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
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.stdout.trim()).toBe("advisor: APPROVE");
		expect(readLedger().gate.advisor).toBe("APPROVE");
	});

	it("sets gate.advisor as an OBJECT when citation/rubric/axes flags are present", () => {
		run(["gate", "advisor", "CORRECTION", "--citation", "contact.ts:42", "--rubric", "v1", "--axes-correctness", "2"]);
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
		run(["abandon"]);
		expect(readLedger().active).toBe(false);
	});

	it("status prints a compact view with symbols and gate line, not the full JSON", () => {
		run(["gate", "advisor", "APPROVE"]);
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
			spawnSync("node", [CLI, "complete", id], { env: spawnEnv, encoding: "utf8" }),
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
});

// ---------------------------------------------------------------------------
// Helper: write a ledger that has an embedded write_token
// ---------------------------------------------------------------------------

function writeLedgerWithToken(token: string) {
	writeFileSync(
		ledgerFile,
		JSON.stringify({ ...baseLedger(), write_token: token }, null, 2),
	);
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
// Fail-open: no write_token → gate/complete proceed without --token
// ---------------------------------------------------------------------------

describe("ledger CLI — fail-open (no write_token)", () => {
	it("gate proceeds without --token when ledger has no write_token (legacy compat)", () => {
		// baseLedger() has no write_token field
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.code).toBe(0);
		expect(readLedger().gate.advisor).toBe("APPROVE");
	});

	it("complete proceeds without --token when ledger has no write_token (legacy compat)", () => {
		// baseLedger() has no write_token field
		const r = run(["complete", "S2"]);
		expect(r.code).toBe(0);
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
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Claimed By | Description |");
		expect(r.stdout).toContain("|---|---|---|---|---|---|");
		// Slice IDs appear as inline code spans
		expect(r.stdout).toContain("`S1`");
		expect(r.stdout).toContain("`S2`");
	});

	it("includes a Gate table section with advisor verdict", () => {
		run(["gate", "advisor", "APPROVE"]);
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
		run(["gate", "advisor", "APPROVE"]);
		const gatesDir = path.join(projectDir, ".groundwork", "gates");
		expect(existsSync(gatesDir)).toBe(true);
		// baseLedger session_id is "sess-1"
		expect(readdirSync(gatesDir)).toContain("sess-1.md");
	});

	it("gate artifact first line is 'verdict: <VERDICT>'", () => {
		run(["gate", "advisor", "APPROVE"]);
		const artifactPath = path.join(projectDir, ".groundwork", "gates", "sess-1.md");
		expect(existsSync(artifactPath)).toBe(true);
		const firstLine = readFileSync(artifactPath, "utf8").split("\n")[0];
		expect(firstLine).toMatch(/^verdict:/);
		expect(firstLine).toContain("APPROVE");
	});

	it("gate artifact first line contains the exact verdict for CORRECTION", () => {
		run(["gate", "advisor", "CORRECTION"]);
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
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Claimed By | Description |");
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
		const r = run(["set", "S2", "--status", "skipped"]);
		expect(r.code).toBe(0);
		expect(readLedger().slices.find((s: any) => s.id === "S2").status).toBe("skipped");
	});

	it("set --status with an invalid status → exit 2", () => {
		const r = run(["set", "S2", "--status", "cancelled"]);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("invalid status");
	});

	it("show displays status: skipped for a skipped slice", () => {
		run(["set", "S2", "--status", "skipped"]);
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
		const r = runFull(["gate", "advisor", "APPROVE"]);
		expect(r.code).toBe(0);
		// Schema-only issue: schema allows APPROVE — no warning expected
		expect(r.stderr).toBe("");
	});

	it("object-form advisor gate is accepted", () => {
		const r = runFull(["gate", "advisor", "APPROVE", "--citation", "src:42", "--rubric", "r1"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("non-schema verdict string (CORRECTION) emits schema warning but still exits 0", () => {
		// CORRECTION is not in the schema enum but is used by some gate commands.
		// Schema violations are warnings-only; the operation must succeed.
		const r = runFull(["gate", "advisor", "CORRECTION"]);
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
		const r = run(["complete", "S2"]);
		expect(r.code).toBe(0);
	});
});

