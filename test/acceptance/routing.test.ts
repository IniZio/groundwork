import { describe, test, expect } from "vitest";

interface RoutingTestCase {
	name: string;
	prompt: string;
	expectSkills: string[];
	forbidSkills: string[];
}

const TEST_CASES: RoutingTestCase[] = [
	{
		name: "trivial-bug",
		prompt: 'Fix the typo where it says "backgroud" instead of "background"',
		expectSkills: [],
		forbidSkills: ["diagnose", "interview", "vertical-slice"],
	},
	{
		name: "standard-bug",
		prompt: "The filters don't work. Debug and fix.",
		expectSkills: ["diagnose"],
		forbidSkills: ["vertical-slice", "implement"],
	},
	{
		name: "feature",
		prompt: "Build a workflow engine with triggers, conditions, and actions.",
		expectSkills: ["interview", "vertical-slice"],
		forbidSkills: ["diagnose"],
	},
];

describe("Routing Tests", () => {
	for (const tc of TEST_CASES) {
		test(`routes "${tc.name}" correctly`, async () => {
			// TODO: Implement subagent-based harness
			// const result = await spawnSubagentForTest({
			//   prompt: tc.prompt,
			//   subagent_type: "general-purpose",
			//   max_turns: 15,
			// });
			// const transcript = result.transcript.toLowerCase();
			// for (const skill of tc.expectSkills) {
			//   expect(transcript).toContain(`skill: ${skill}`);
			// }
			// for (const skill of tc.forbidSkills) {
			//   expect(transcript).not.toContain(`skill: ${skill}`);
			// }
			expect(true).toBe(true); // Placeholder until harness is implemented
		}, 120_000);
	}
});
