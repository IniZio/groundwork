import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "ledger.mjs");

// Pre-existing init tests use a non-git mkdtemp dir, so `git rev-parse HEAD` fails and
// base_commit is never emitted; a real git repo is required to exercise the writer.
let projectDir: string;
let headSha: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-ledger-basecommit-"));
	execFileSync("git", ["init", "-q", "."], { cwd: projectDir });
	execFileSync(
		"git",
		["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"],
		{ cwd: projectDir },
	);
	headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim();
	mkdirSync(path.join(projectDir, ".groundwork"), { recursive: true });
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function runInit(seed: unknown): { code: number; stdout: string; stderr: string } {
	const seedPath = path.join(projectDir, "seed.json");
	writeFileSync(seedPath, JSON.stringify(seed));
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	const r = spawnSync("node", [CLI, "init", seedPath, "--motive", "m"], { env, encoding: "utf8" });
	return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("ledger init — base_commit inside a git repository", () => {
	it("succeeds and persists base_commit as the current HEAD sha", () => {
		const r = runInit({ motive: "m", active: true, slices: [] });
		expect(r.stderr).not.toContain("additional properties");
		expect(r.code, `init exited ${r.code}; stderr:\n${r.stderr}`).toBe(0);

		const written = JSON.parse(readFileSync(path.join(projectDir, ".groundwork", "run.json"), "utf8"));
		expect(written.base_commit).toBe(headSha);
	});
});
