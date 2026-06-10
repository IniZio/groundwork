import { describe, test } from "vitest";
import {
	runPiPrompt,
	assertUATVerifyUsed,
	assertAdvisorGateAtEnd,
	assertClassificationOutput,
	setupTestProject,
	cleanupTestProject,
} from "./harness.js";

/**
 * UAT verification tests verify that the uat-verify skill is invoked
 * between implementation and advisor-gate.
 *
 * With subagentDepth=1, the orchestrator can delegate to coder agents
 * who implement the fix, then the orchestrator runs UAT before advisor-gate.
 */

interface UATTestCase {
	name: string;
	prompt: string;
	scenarioSetup: string;
}

const TEST_CASES: UATTestCase[] = [
	{
		name: "cli-bug-with-uat",
		prompt:
			"The filterItems function in src/app.js always returns all items instead of filtering. Fix it and verify the fix works by running the code.",
		scenarioSetup: "standard-bug",
	},
	{
		name: "null-check-with-uat",
		prompt:
			"The getUserName function in src/app.js crashes when user is null. Add a null check and verify it handles null input correctly.",
		scenarioSetup: "small-change-clear",
	},
];

describe("E2E UAT Verification Tests", () => {
	for (const tc of TEST_CASES) {
		test(
			`verifies UAT for "${tc.name}"`,
			async () => {
				const projectDir = setupTestProject(tc.scenarioSetup);
				try {
					const result = await runPiPrompt(tc.prompt, {
						cwd: projectDir,
						timeoutMs: 120_000,
					});

					try {
						assertClassificationOutput(result);
						assertUATVerifyUsed(result);
						assertAdvisorGateAtEnd(result);
					} catch (err) {
						console.error(
							`\n=== DEBUG: ${tc.name} ===\n` +
								`Duration: ${result.durationMs}ms\n` +
								`ForceKilled: ${result.forceKilled}\n` +
								`ExitCode: ${result.exitCode}\n` +
								`SkillsLoaded: [${result.skillsLoaded.join(", ")}]\n` +
								`ToolCalls:\n` +
								result.toolCalls
									.map(
										(tc) =>
											`  - ${tc.name}: ${JSON.stringify(tc.args)?.slice(0, 200)}`,
									)
									.join("\n") +
								`\nTranscript: ${result.transcript.slice(0, 800)}\n` +
								`========================\n`,
						);
						throw err;
					}
				} finally {
					cleanupTestProject(projectDir);
				}
			},
			150_000,
		);
	}
});
