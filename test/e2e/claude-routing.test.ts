import { describe, test, afterEach } from "vitest";
import {
	runClaudePrompt,
	setupClaudeTestEnv,
} from "./claude-harness.js";
import {
	assertSkillUsed,
	assertSkillNotUsed,
} from "./harness.js";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// Only run when claude binary is available and GW_CLAUDE_E2E is set
const E2E_ENABLED = !!process.env.GW_CLAUDE_E2E;

// Helper to create a minimal test project
function makeProject(_scenario: string): string {
	const dir = mkdtempSync(join(tmpdir(), "gw-claude-proj-"));
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "test-proj", version: "1.0.0" }),
	);
	if (_scenario === "bug") {
		writeFileSync(
			join(dir, "src/app.js"),
			`function filter(items) { return items; } // bug: always returns all`,
		);
	} else {
		writeFileSync(
			join(dir, "src/app.js"),
			`const users = []; function getUser(id) { return users.find(u => u.id === id); }`,
		);
	}
	return dir;
}

describe.skipIf(!E2E_ENABLED)("Claude Plugin Routing E2E", () => {
	const envs: Array<{ cleanup: () => void }> = [];
	const projects: string[] = [];

	afterEach(() => {
		envs.forEach((e) => e.cleanup());
		envs.length = 0;
		projects.forEach((p) => {
			try {
				rmSync(p, { recursive: true, force: true });
			} catch {
				// ignore
			}
		});
		projects.length = 0;
	});

	test("trivial-typo: direct fix, no skill loading", async () => {
		const proj = makeProject("trivial");
		projects.push(proj);
		const env = setupClaudeTestEnv(proj);
		envs.push(env);
		writeFileSync(join(proj, "src/style.css"), ".app { backgroud: white; }");

		const result = await runClaudePrompt(
			'Fix the CSS typo "backgroud" → "background"',
			{ cwd: proj, timeoutMs: 120_000 },
		);

		assertSkillNotUsed(result, "diagnose");
		assertSkillNotUsed(result, "interview");
		assertSkillNotUsed(result, "create-prd");
	}, 150_000);

	test("standard-bug: diagnose skill loaded", async () => {
		const proj = makeProject("bug");
		projects.push(proj);
		const env = setupClaudeTestEnv(proj);
		envs.push(env);

		const result = await runClaudePrompt(
			"The filter function doesn't work — it always returns all items. Debug and fix.",
			{ cwd: proj, timeoutMs: 120_000 },
		);

		// Orchestrator must load the diagnose skill — routing signal
		assertSkillUsed(result, "diagnose");
	}, 150_000);

	test("feature-request: interview skill loaded", async () => {
		const proj = makeProject("feature");
		projects.push(proj);
		const env = setupClaudeTestEnv(proj);
		envs.push(env);

		const result = await runClaudePrompt(
			"Build a full authentication system with login, signup, JWT tokens, and role-based access control.",
			{ cwd: proj, timeoutMs: 120_000 },
		);

		// Orchestrator must load the interview skill for multi-day features
		assertSkillUsed(result, "interview");
	}, 150_000);

	test("risky-shared-change: interview skill loaded", async () => {
		const proj = makeProject("shared");
		projects.push(proj);
		const env = setupClaudeTestEnv(proj);
		envs.push(env);
		writeFileSync(
			join(proj, "src/model.js"),
			`// Shared UserModel used across 8 modules\nconst UserModel = { id: null, name: null };`,
		);

		const result = await runClaudePrompt(
			"Add an 'avatarUrl' string field to the shared UserModel used across 8 modules.",
			{ cwd: proj, timeoutMs: 120_000 },
		);

		// Risky shared change must trigger interview for requirements gathering
		assertSkillUsed(result, "interview");
	}, 150_000);

	test("config-isolation: no groundwork state artifacts from run", async () => {
		const proj = makeProject("trivial");
		projects.push(proj);
		const env = setupClaudeTestEnv(proj);
		envs.push(env);

		// Snapshot global ~/.claude/.groundwork BEFORE the run
		const globalStateDir = join(homedir(), ".claude", ".groundwork");
		const snapshotBefore: string[] = existsSync(globalStateDir)
			? (readdirSync(globalStateDir, { recursive: true }) as string[]).sort()
			: [];

		await runClaudePrompt("What is 2 + 2?", {
			cwd: proj,
			timeoutMs: 60_000,
		});

		// Groundwork state dir must not have grown during this run
		const snapshotAfter: string[] = existsSync(globalStateDir)
			? (readdirSync(globalStateDir, { recursive: true }) as string[]).sort()
			: [];

		if (snapshotAfter.length > snapshotBefore.length) {
			throw new Error(
				`Unexpected state written: ${snapshotAfter.length - snapshotBefore.length} new file(s) appeared in ` +
					`${globalStateDir} during the run.`,
			);
		}
	}, 90_000);
});
