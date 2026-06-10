import { describe, test } from "vitest";
import {
	runPiPrompt,
	assertSkillUsed,
	assertSkillNotUsed,
	assertClassificationOutput,
	assertAdvisorGateAtEnd,
	assertUATVerifyUsed,
	assertSkillChain,
	assertFanOut,
	setupTestProject,
	cleanupTestProject,
} from "./harness.js";

/**
 * Flow cohesion tests verify the COMPLETE groundwork skill chain works end-to-end.
 *
 * With subagentDepth=1 (default), the orchestrator CAN delegate to specialist agents,
 * enabling full skill chain execution:
 *   classify → skill routing → subagent delegation → UAT verify → advisor gate
 *
 * These tests are slower than routing tests but validate the full workflow.
 */

interface FlowTestCase {
	name: string;
	prompt: string;
	scenarioSetup: string;
	/** Full expected skill chain (all must be loaded, in any order) */
	expectedSkills: string[];
	/** Skills that must NOT appear */
	forbiddenSkills: string[];
	/** Whether UAT verification should appear */
	expectUAT: boolean;
	/** Whether fan-out (multiple subagents) should happen */
	expectFanOut: boolean;
}

const FLOW_CASES: FlowTestCase[] = [
	{
		name: "bug-full-flow",
		prompt:
			"The filter function in src/app.js is broken — it returns all items instead of filtering. Debug and fix it.",
		scenarioSetup: "standard-bug",
		expectedSkills: ["diagnose"],
		forbiddenSkills: ["create-prd", "bdd-implement"],
		expectUAT: true, // diagnose → fix → UAT verify → advisor gate
		expectFanOut: true, // diagnose delegates to explore/coder
	},
	{
		name: "feature-full-flow",
		prompt:
			"Build a todo app with add, toggle, delete, filter, and persistence to localStorage. Include unit tests and a responsive UI.",
		scenarioSetup: "feature",
		expectedSkills: [], // may load interview or go direct depending on model judgment
		forbiddenSkills: ["diagnose"],
		expectUAT: false, // full feature won't complete in test timeout; verify routing only
		expectFanOut: true,
	},
];

describe("E2E Flow Cohesion Tests", () => {
	for (const tc of FLOW_CASES) {
		test(
			`complete flow for "${tc.name}"`,
			async () => {
				const projectDir = setupTestProject(tc.scenarioSetup);
				try {
					const result = await runPiPrompt(tc.prompt, {
						cwd: projectDir,
						timeoutMs: 120_000,
					});

					try {
						// 1. Classification gate — orchestrator must classify before acting
						assertClassificationOutput(result);

						// 2. Skill routing — correct skills loaded, forbidden skills not
						for (const skill of tc.expectedSkills) {
							assertSkillUsed(result, skill);
						}
						for (const skill of tc.forbiddenSkills) {
							assertSkillNotUsed(result, skill);
						}

						// 3. Delegation — non-trivial work delegates to subagents
						if (tc.expectFanOut) {
							assertFanOut(result, 1);
						}

						// 4. UAT verification — if expected and flow completed
						if (tc.expectUAT) {
							assertUATVerifyUsed(result);
						}

						// 5. Advisor gate at completion
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
								`\nTranscript: ${result.transcript.slice(0, 1000)}\n` +
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
