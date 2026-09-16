/**
 * test/gw/ledger-stamp-motive.test.ts
 *
 * Covers S65-FORCE-FUNNEL:
 * (a) MOTIVE_MISSING remedy names stamp-motive, not bin/ledger init
 * (b) --force pre-flight surfaces victim motive + slice count
 * (c) stamp-motive stamps non-destructively (end-to-end via spawned CLI)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const GW_MAIN = path.join(REPO_ROOT, "src", "gw", "cli", "main.ts");
const BIN_LEDGER = path.join(REPO_ROOT, "hooks", "ledger.mjs");
const SESSION = "stamp-motive-test";

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-stamp-motive-"));
	mkdirSync(path.join(projectDir, ".groundwork", "runs"), { recursive: true });
});

afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function env(): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? "",
		HOME: process.env.HOME ?? "",
		CLAUDE_PROJECT_DIR: projectDir,
		CLAUDE_CODE_SESSION_ID: SESSION,
		GROUNDWORK_COMMENT_DENSITY: "0",
		GROUNDWORK_COMMIT_LINT: "0",
	};
}

function runGw(args: string[]): { code: number; stdout: string; stderr: string } {
	const r = spawnSync("bun", ["run", GW_MAIN, ...args, "--json"], { env: env(), encoding: "utf8" });
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runBinLedger(args: string[]): { code: number; stdout: string; stderr: string } {
	const r = spawnSync("node", [BIN_LEDGER, ...args], { env: env(), encoding: "utf8" });
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function writeLedger(opts: {
	motive?: string | null;
	writeToken?: string | null;
	slices?: unknown[];
}): string {
	const p = path.join(projectDir, ".groundwork", "runs", `${SESSION}.json`);
	const obj: Record<string, unknown> = {
		active: true,
		session_id: SESSION,
		slices: opts.slices ?? [],
		gate: {},
	};
	if (opts.motive != null) obj.motive = opts.motive;
	if (opts.writeToken != null) obj.write_token = opts.writeToken;
	writeFileSync(p, JSON.stringify(obj));
	return p;
}

// ---------------------------------------------------------------------------
// (a) MOTIVE_MISSING remedy points at stamp-motive, not bin/ledger init
// ---------------------------------------------------------------------------

describe("MOTIVE_MISSING remedy text", () => {
	it("gw ledger status names stamp-motive and not bin/ledger init", () => {
		writeLedger({ motive: null });
		const r = runGw(["ledger", "status", "--motive", "my-motive"]);
		expect(r.code, "exit code non-zero").not.toBe(0);
		const envelope = JSON.parse(r.stdout) as {
			ok: boolean;
			error: { code: string; message: string };
		};
		expect(envelope.error.code).toBe("MOTIVE_MISSING");
		expect(envelope.error.message).toContain("stamp-motive");
		expect(envelope.error.message).not.toContain("bin/ledger init");
	});

	it("bin/ledger status names stamp-motive and not ledger init", () => {
		writeLedger({ motive: null });
		const r = runBinLedger(["status", "--motive", "my-motive"]);
		expect(r.code, "exit code non-zero").not.toBe(0);
		expect(r.stderr).toContain("stamp-motive");
		expect(r.stderr).not.toContain("repair with: ledger init");
	});
});

// ---------------------------------------------------------------------------
// (b) stamp-motive end-to-end: tokenless motive-less ledger gets motive stamped
// ---------------------------------------------------------------------------

describe("stamp-motive non-destructive end-to-end", () => {
	it("gw ledger stamp-motive stamps motive on tokenless motive-less ledger", () => {
		const ledgerPath = writeLedger({
			motive: null,
			writeToken: null,
			slices: [
				{ id: "S1", wave: 0, status: "pending", kind: "impl" },
				{ id: "S2", wave: 0, status: "pending", kind: "impl" },
			],
		});

		const refuse = runGw(["ledger", "status", "--motive", "my-motive"]);
		expect(refuse.code, "gw ledger must refuse motive-less ledger").not.toBe(0);
		const refuseEnv = JSON.parse(refuse.stdout) as { error: { message: string } };
		expect(refuseEnv.error.message).toContain("stamp-motive my-motive");

		const stamp = runGw(["ledger", "stamp-motive", "my-motive"]);
		expect(stamp.code, `stamp-motive must succeed; stderr: ${stamp.stderr}`).toBe(0);
		const stampEnv = JSON.parse(stamp.stdout) as { ok: boolean; data?: { content?: string } };
		expect(stampEnv.ok).toBe(true);
		expect(stampEnv.data?.content).toContain("motive stamped: my-motive");

		const accept = runGw(["ledger", "status", "--motive", "my-motive"]);
		expect(accept.code, "gw ledger must accept stamped ledger").toBe(0);

		const raw = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
			motive?: string;
			slices?: unknown[];
			write_token?: string;
		};
		expect(raw.motive).toBe("my-motive");
		expect(raw.slices).toHaveLength(2);
		expect(raw.write_token).toBeUndefined();
	});

	it("bin/ledger stamp-motive stamps motive on tokenless motive-less ledger", () => {
		writeLedger({ motive: null, writeToken: null });
		const r = runBinLedger(["stamp-motive", "bin-motive"]);
		expect(r.code, `should succeed; stderr: ${r.stderr}`).toBe(0);
		expect(r.stdout).toContain("motive stamped: bin-motive");
	});

	it("stamp-motive refuses when motive is already set", () => {
		writeLedger({ motive: "existing-motive" });
		const r = runGw(["ledger", "stamp-motive", "other-motive"]);
		expect(r.code).not.toBe(0);
		const env2 = JSON.parse(r.stdout) as { error: { code: string } };
		expect(env2.error.code).toBe("ALREADY_STAMPED");
	});

	it("stamp-motive on tokened motive-less run refuses without --token", () => {
		writeLedger({ motive: null, writeToken: "secret-tok" });
		const r = runGw(["ledger", "stamp-motive", "my-motive"]);
		expect(r.code).not.toBe(0);
		const env2 = JSON.parse(r.stdout) as { error: { code: string } };
		expect(env2.error.code).toBe("AUTH_REQUIRED");
	});

	it("stamp-motive on tokened motive-less run succeeds with correct --token", () => {
		writeLedger({ motive: null, writeToken: "secret-tok" });
		const r = runGw(["ledger", "stamp-motive", "my-motive", "--token", "secret-tok"]);
		expect(r.code, `should succeed; stderr: ${r.stderr}`).toBe(0);
		const env2 = JSON.parse(r.stdout) as { ok: boolean };
		expect(env2.ok).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (c) --force pre-flight surfaces victim motive and slice count
// ---------------------------------------------------------------------------

describe("--force pre-flight warning", () => {
	it("bin/ledger init --force prints victim motive and slice count to stderr", () => {
		const ledgerPath = writeLedger({
			motive: "old-motive",
			writeToken: null,
			slices: [
				{ id: "S1", wave: 0, status: "pending", kind: "impl" },
				{ id: "S2", wave: 0, status: "pending", kind: "impl" },
				{ id: "S3", wave: 0, status: "pending", kind: "impl" },
			],
		});

		const r = runBinLedger(["init", ledgerPath, "--motive", "new-motive", "--force"]);
		expect(r.code, `should succeed; stderr: ${r.stderr}`).toBe(0);
		expect(r.stderr).toContain("WARNING: --force: destroying active run");
		expect(r.stderr).toContain("motive: old-motive");
		expect(r.stderr).toContain("3 slices");
	});

	it("gw ledger init --force prints victim motive and slice count to stderr", () => {
		writeLedger({
			motive: "victim-motive",
			writeToken: null,
			slices: [
				{ id: "A1", wave: 0, status: "pending", kind: "impl" },
				{ id: "A2", wave: 0, status: "pending", kind: "impl" },
			],
		});

		const ledgerSrc = path.join(projectDir, ".groundwork", "runs", `${SESSION}.json`);
		const r = runGw(["ledger", "init", ledgerSrc, "--motive", "fresh-motive", "--force"]);
		expect(r.code, `should succeed; stderr: ${r.stderr}`).toBe(0);
		const envelope = JSON.parse(r.stdout) as { ok: boolean };
		expect(envelope.ok).toBe(true);
		expect(r.stderr).toContain("WARNING: --force: destroying active run");
		expect(r.stderr).toContain("motive: victim-motive");
		expect(r.stderr).toContain("2 slices");
	});
});

// ---------------------------------------------------------------------------
// regression: existing tokenless-run guard still holds
// ---------------------------------------------------------------------------

describe("init --force guard regression", () => {
	it("tokenless active run refuses without --force", () => {
		const ledgerPath = writeLedger({ motive: "some-motive", writeToken: null });
		const r = runBinLedger(["init", ledgerPath, "--motive", "new-motive"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--force");
	});

	it("tokened active run refuses without --token", () => {
		const ledgerPath = writeLedger({ motive: "some-motive", writeToken: "my-tok" });
		const r = runBinLedger(["init", ledgerPath, "--motive", "new-motive"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--token");
	});
});
