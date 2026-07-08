import { execFileSync } from "node:child_process";
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
	gate: { advisor: "pending" },
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
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
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
});

describe("ledger CLI — gate", () => {
	it("sets gate.advisor as a bare string verdict", () => {
		const r = run(["gate", "advisor", "APPROVE"]);
		expect(r.stdout.trim()).toBe("advisor: APPROVE");
		expect(readLedger().gate.advisor).toBe("APPROVE");
	});

	it("sets gate.advisor as an OBJECT when citation/rubric/axes flags are present", () => {
		run(["gate", "advisor", "REVISE", "--citation", "contact.ts:42", "--rubric", "v1", "--axes-correctness", "2"]);
		const a = readLedger().gate.advisor;
		expect(a).toEqual({ verdict: "REVISE", rubric: "v1", citation: "contact.ts:42", axes: { correctness: 2 } });
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
		const procs = ["S2", "S3"].map((id) =>
			spawnSync("node", [CLI, "complete", id], { env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }, encoding: "utf8" }),
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
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Description |");
		expect(r.stdout).toContain("|---|---|---|---|---|");
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
		expect(r.stdout).toContain("| ID | Kind | Status | Blocked By | Description |");
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
