import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
	gate: { critic: "pending", advisor: "pending" },
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
	it("sets gate.critic as a string", () => {
		run(["gate", "critic", "passed"]);
		expect(readLedger().gate.critic).toBe("passed");
	});

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
});
