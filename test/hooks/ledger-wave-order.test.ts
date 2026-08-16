import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

let projectDir: string;
let ledgerFile: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-wave-order-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
	ledgerFile = path.join(projectDir, ".groundwork", "run.json");
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/**
 * Run the CLI via spawnSync so both stdout AND stderr are captured even on exit 0.
 * (execFileSync swallows stderr on success.)
 */
function runFull(args: string[]): { code: number; stdout: string; stderr: string } {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	const r = spawnSync("node", [CLI, ...args], { env, encoding: "utf8" });
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeLedger(obj: object) {
	writeFileSync(ledgerFile, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Wave-order invariant — blocked_by and depends_on (legacy alias)
//
// Invariant: for every slice S with a blocked_by list, each blocker B must
// satisfy wave(B) < wave(S).  Violations surface as warnings (not hard errors)
// so existing runs with this inconsistency are not bricked.
// ---------------------------------------------------------------------------

describe("ledger CLI — wave-order validation", () => {
	// (a) A slice sharing a wave with its blocker warns, quoting both ids.
	//     Uses the ORCA-P1/ORCA-P2 shape from the motivating real-world failure.
	it("warns when a slice shares a wave with its blocker — ORCA-P1/ORCA-P2 shape (a)", () => {
		writeLedger({
			session_id: "orca-sess",
			active: true,
			brief: "orca run",
			slices: [
				{ id: "ORCA-P1", wave: 3, status: "pending", acceptance: ["p1 done"] },
				{
					id: "ORCA-P2",
					wave: 3,
					blocked_by: ["ORCA-P1"],
					status: "pending",
					acceptance: ["p2 done"],
				},
			],
			gate: {},
		});
		const r = runFull(["status"]);
		// Warn-only — must exit 0 and NOT hard-fail existing runs
		expect(r.code).toBe(0);
		// Warning must name both ids
		expect(r.stderr).toContain("ORCA-P1");
		expect(r.stderr).toContain("ORCA-P2");
		// Warning must name both wave numbers
		expect(r.stderr).toContain("wave 3");
		// Warning must mention the ordering requirement
		expect(r.stderr).toMatch(/strictly earlier wave/i);
	});

	// (b) A correctly-ordered ledger produces no wave-order warning.
	it("does not warn when every blocker is in a strictly earlier wave (b)", () => {
		writeLedger({
			session_id: "ok-sess",
			active: true,
			brief: "clean run",
			slices: [
				{ id: "P1", wave: 1, status: "complete", acceptance: ["done"] },
				{ id: "P2", wave: 2, blocked_by: ["P1"], status: "pending", acceptance: ["todo"] },
			],
			gate: {},
		});
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		// No wave-order warning should appear
		expect(r.stderr).not.toMatch(/strictly earlier wave|wave order cannot/i);
	});

	// (c) A blocked_by pointing at a nonexistent id warns distinctly and does not throw.
	it("warns distinctly when blocked_by references a nonexistent id — does not throw (c)", () => {
		writeLedger({
			session_id: "ghost-sess",
			active: true,
			brief: "ghost run",
			slices: [
				{
					id: "X1",
					wave: 2,
					blocked_by: ["GHOST"],
					status: "pending",
					acceptance: ["x"],
				},
			],
			gate: {},
		});
		const r = runFull(["status"]);
		// Must exit 0 — warn only, no throw
		expect(r.code).toBe(0);
		// The unknown blocker id must appear in stderr (either from integrity or wave check)
		expect(r.stderr).toContain("GHOST");
		// The wave-check specific message must also appear
		expect(r.stderr).toMatch(/wave order cannot be verified/i);
	});

	// (d) A missing wave field does not throw — check is skipped gracefully.
	it("does not throw when a slice has no wave field — graceful skip (d)", () => {
		writeLedger({
			session_id: "no-wave-sess",
			active: true,
			brief: "no wave run",
			slices: [
				// Neither slice has a wave field
				{ id: "P1", status: "complete", acceptance: ["done"] },
				{ id: "P2", blocked_by: ["P1"], status: "pending", acceptance: ["todo"] },
			],
			gate: {},
		});
		const r = runFull(["status"]);
		// Must exit 0 — undefined wave must never crash the CLI
		expect(r.code).toBe(0);
	});

	// (e) The legacy depends_on alias is subject to the same wave-order check.
	it("warns on a wave-order violation expressed via the legacy depends_on alias (e)", () => {
		writeLedger({
			session_id: "legacy-wave-sess",
			active: true,
			brief: "legacy wave run",
			slices: [
				{ id: "L1", wave: 2, status: "pending", acceptance: ["done"] },
				{
					id: "L2",
					wave: 2,
					depends_on: ["L1"],
					status: "pending",
					acceptance: ["todo"],
				},
			],
			gate: {},
		});
		const r = runFull(["status"]);
		expect(r.code).toBe(0);
		// Both ids must appear
		expect(r.stderr).toContain("L1");
		expect(r.stderr).toContain("L2");
		// Wave ordering message must appear
		expect(r.stderr).toMatch(/strictly earlier wave/i);
	});
});
