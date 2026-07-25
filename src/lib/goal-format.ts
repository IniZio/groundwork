// ─── Shared goal formatting content ──────────────────────────────────────────
// Used by both src/commands/goal.ts (returns string) and
// pi/pi-commands/goal.ts (emits via ctx.ui.notify).

import type { Goal } from "./goal.js";

/**
 * Formats a loaded goal into the display string used by the /goal command.
 * Returns the "no goal" message if no goal is set.
 */
export function formatGoal(goal: Goal | null): string {
	if (!goal) {
		return "No active goal set. Use the `set_goal` tool to create one.";
	}

	const criteria = goal.acceptanceCriteria
		.map(
			(c: string, i: number) =>
				`  ${i + 1}. [${goal.status === "achieved" ? "x" : " "}] ${c}`,
		)
		.join("\n");

	return `Goal: ${goal.objective}\nStatus: ${goal.status}\nAcceptance Criteria:\n${criteria}`;
}
