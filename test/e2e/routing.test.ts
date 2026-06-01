import { describe, test, expect } from "vitest";
import { runPiPrompt, assertSkillUsed, assertSkillNotUsed } from "./harness.js";

interface RoutingTestCase {
	name: string;
	prompt: string;
	expectSkills: string[];
	forbidSkills: string[];
	timeoutMs?: number;
}

const TEST_CASES: RoutingTestCase[] = [
	{
		name: "trivial-bug",
		prompt: 'Fix the typo where it says "backgroud" instead of "background"',
		expectSkills: [],
		forbidSkills: ["diagnose", "create-prd", "bdd-implement"],
	},
	{
		name: "standard-bug",
		prompt: "The filters don't work. Debug and fix.",
		expectSkills: ["diagnose"],
		forbidSkills: ["create-prd", "bdd-implement"],
	},
	{
		name: "feature",
		prompt: "Build a workflow engine with triggers, conditions, and actions.",
		expectSkills: ["interview", "create-prd"],
		forbidSkills: ["diagnose"],
		timeoutMs: 180_000,
	},
	{
		name: "small-change-clear",
		prompt: "Add a missing null check to the user service.",
		expectSkills: [],
		forbidSkills: ["interview", "create-prd", "diagnose"],
	},
	{
		name: "small-change-risky",
		prompt: "Modify the shared data model to add a new field used across 5 modules.",
		expectSkills: ["interview"],
		forbidSkills: ["create-prd", "diagnose"],
		timeoutMs: 180_000,
	},
];

describe("E2E Routing Tests", () => {
	for (const tc of TEST_CASES) {
		test(
			`routes "${tc.name}" correctly`,
			async () => {
				const result = await runPiPrompt(tc.prompt, {
					timeoutMs: tc.timeoutMs ?? 120_000,
				});

				for (const skill of tc.expectSkills) {
					expect(() => assertSkillUsed(result, skill)).not.toThrow();
				}
				for (const skill of tc.forbidSkills) {
					expect(() => assertSkillNotUsed(result, skill)).not.toThrow();
				}
			},
			tc.timeoutMs ?? 120_000,
		);
	}
});
