/**
 * TBD-15 (claim-collision): Two real OS processes race to claim the same slice.
 * Exactly one must win; the other must be refused with the winner named.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

let projectDir: string;
let ledgerFile: string;

/**
 * session_id: null so resolveLedgerPath falls back to the legacy run.json for ANY
 * value of CLAUDE_CODE_SESSION_ID — both racers operate on the same fixture file.
 * See ledger-claim.test.ts comment for the full back-compat explanation.
 */
const makeLedger = () => ({
	version: 1,
	active: true,
	session_id: null,
	brief: "concurrency test run",
	reinforcements: 0,
	slices: [
		{ id: "RACE", wave: 0, blocked_by: [], status: "pending", acceptance: ["x"] },
	],
	gate: {},
});

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-ledger-concurrency-"));
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
	ledgerFile = path.join(projectDir, ".groundwork", "run.json");
	writeFileSync(ledgerFile, JSON.stringify(makeLedger(), null, 2));
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/**
 * Spawn a `ledger claim RACE --json` process asynchronously and return a
 * Promise that resolves when the process exits. Both callers spawn their child
 * processes before either awaits, so the children are genuinely running
 * concurrently and racing for the O_EXCL lock on the ledger file.
 */
function spawnClaim(
	sessionId: string,
	cli: string = CLI,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const env = {
		...process.env,
		CLAUDE_PROJECT_DIR: projectDir,
		CLAUDE_CODE_SESSION_ID: sessionId,
	};
	return new Promise((resolve, reject) => {
		const child = spawn("node", [cli, "claim", "RACE", "--json"], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

describe("ledger claim — OS-process race", () => {
	it("exactly one process wins when two race to claim the same slice", async () => {
		// Spawn both children before awaiting either — they are genuinely running
		// in parallel, racing each other for the O_EXCL lockfile.
		const p1 = spawnClaim("session-A");
		const p2 = spawnClaim("session-B");
		const [r1, r2] = await Promise.all([p1, p2]);

		// Both must exit 0 (claim is non-strict by default).
		expect(r1.code).toBe(0);
		expect(r2.code).toBe(0);

		const out1 = JSON.parse(r1.stdout.trim());
		const out2 = JSON.parse(r2.stdout.trim());

		// Exactly one must have claimed RACE; the other must have been refused.
		const winners = [out1, out2].filter((o) => o.claimed?.includes("RACE"));
		const losers  = [out1, out2].filter((o) => o.refused?.some((r: any) => r.id === "RACE"));

		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);

		// The loser's refusal must name the winner.
		const winnerSession = winners[0] === out1 ? "session-A" : "session-B";
		const loserRefusal = losers[0].refused.find((r: any) => r.id === "RACE");
		expect(loserRefusal.claimed_by).toBe(winnerSession);

		// The ledger file must be valid JSON with a single claimed_by value.
		const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
		const raceSlice = ledger.slices.find((s: any) => s.id === "RACE");
		expect(raceSlice).toBeDefined();
		expect(typeof raceSlice.claimed_by).toBe("string");
		expect(["session-A", "session-B"]).toContain(raceSlice.claimed_by);
	});
});
