import { describe, test, expect } from "vitest";
import {
	runPiPrompt,
	assertSkillUsed,
	assertSkillNotUsed,
	assertNoDirectImplementation,
	setupTestProject,
	cleanupTestProject,
} from "./harness.js";

interface RoutingTestCase {
	name: string;
	prompt: string;
	expectSkills: string[];
	forbidSkills: string[];
	shouldDelegate: boolean;
}

const TEST_CASES: RoutingTestCase[] = [
	{
		name: "trivial-bug",
		prompt: 'Fix the typo where it says "backgroud" instead of "background"',
		expectSkills: [],
		forbidSkills: ["diagnose", "create-prd", "bdd-implement"],
		shouldDelegate: false,
	},
	{
		name: "standard-bug",
		prompt: "The filters don't work. Debug and fix.",
		expectSkills: [],
		forbidSkills: ["create-prd", "bdd-implement"],
		shouldDelegate: true,
	},
	{
		name: "feature",
		prompt: "Build a workflow engine with triggers, conditions, and actions.",
		expectSkills: [],
		forbidSkills: ["diagnose"],
		shouldDelegate: true,
	},
	{
		name: "small-change-clear",
		prompt: "Add a missing null check to the user service.",
		expectSkills: [],
		forbidSkills: ["interview", "create-prd", "diagnose"],
		shouldDelegate: false,
	},
	{
		name: "small-change-risky",
		prompt:
			"Modify the shared data model to add a new field used across 5 modules.",
		expectSkills: [],
		forbidSkills: ["create-prd", "diagnose"],
		shouldDelegate: true,
	},
];

function assertSubagentUsed(
	result: Awaited<ReturnType<typeof runPiPrompt>>,
	shouldUse: boolean,
) {
	const hasSubagent = result.toolCalls.some((tc) => tc.name === "subagent");
	if (shouldUse && !hasSubagent) {
		throw new Error(
			`Expected subagent to be used for delegation, but no subagent calls found. ` +
				`Tool calls: [${result.toolCalls.map((tc) => tc.name).join(", ")}]`,
		);
	}
	if (!shouldUse && hasSubagent) {
		throw new Error(
			`Expected NO subagent delegation for trivial task, but found subagent calls. ` +
				`Tool calls: [${result.toolCalls.map((tc) => tc.name).join(", ")}]`,
		);
	}
}

describe("E2E Routing Tests", () => {
	for (const tc of TEST_CASES) {
		test(
			`routes "${tc.name}" correctly`,
			async () => {
				const projectDir = setupTestProject(tc.name);
				try {
					const result = await runPiPrompt(tc.prompt, {
						cwd: projectDir,
						timeoutMs: 120_000,
					});

					// Debug logging on failure
					try {
						for (const skill of tc.expectSkills) {
							assertSkillUsed(result, skill);
						}
						for (const skill of tc.forbidSkills) {
							assertSkillNotUsed(result, skill);
						}
						assertSubagentUsed(result, tc.shouldDelegate);
						if (tc.shouldDelegate) {
							assertNoDirectImplementation(result);
						}
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
								`\nTranscript: ${result.transcript.slice(0, 500)}\n` +
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
