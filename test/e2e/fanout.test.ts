import { describe, test, expect } from "vitest";
import { runPiPrompt, assertFanOut } from "./harness.js";

describe("E2E Fan-Out Tests", () => {
	test(
		"orchestrator fans out parallel coder tasks for multi-file feature",
		async () => {
			const prompt = `
Build a todo app with these features:
1. Add / complete / delete todos
2. Filter by active/completed/all
3. Persist to localStorage
4. Add tests

The codebase is empty — create all files from scratch.
			`.trim();

			const result = await runPiPrompt(prompt, {
				timeoutMs: 300_000,
			});

			// We expect the orchestrator to delegate to multiple parallel
			// subagents (coder, designer, explore) rather than doing
			// everything sequentially itself.
			expect(() => assertFanOut(result, 3)).not.toThrow();

			// Sanity: there should be tool calls at all
			expect(result.toolCalls.length).toBeGreaterThan(0);

			// The orchestrator should NOT be editing files directly
			const orchestratorEdits = result.toolCalls.filter(
				(tc) =>
					(tc.name === "edit" || tc.name === "write") &&
					// Heuristic: if edit/write happens after subagent tasks,
					// it might be the orchestrator fixing things — allow small count
					result.toolCalls.indexOf(tc) < result.toolCalls.findIndex((t) => t.name === "task"),
			);
			expect(orchestratorEdits.length).toBeLessThanOrEqual(2);
		},
		300_000,
	);

	test(
		"orchestrator uses explore + coder + designer for UI feature",
		async () => {
			const prompt = `
Add a settings page to the existing React app.
It should have:
- Theme toggle (light/dark)
- Notification preferences
- Account linking

Match the existing design system. Read the codebase first.
			`.trim();

			const result = await runPiPrompt(prompt, {
				timeoutMs: 300_000,
			});

			// Should fan out to at least 2 parallel tasks
			expect(() => assertFanOut(result, 2)).not.toThrow();

			// Should include exploration
			const hasExplore = result.toolCalls.some(
				(tc) => tc.name === "task" && JSON.stringify(tc.args).toLowerCase().includes("explore"),
			);
			expect(hasExplore).toBe(true);
		},
		300_000,
	);
});
