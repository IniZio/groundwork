// ─── /goal Command (Pi) ─────────────────────────────────────────────────────
// Quick command to check or set the active goal.

import { readGoal } from "../../src/lib/goal.js";
import { formatGoal } from "../../src/lib/goal-format.js";

export function createGoalCommand(deps: { directory: string }) {
	return {
		description: "Check or manage the active project goal",
		handler: async (_args: string, ctx: any) => {
			const sessionID = ctx?.sessionManager?.getSessionId?.() ?? "";
			if (!sessionID) {
				await ctx.ui?.notify?.("Error: No session ID available.", "error");
				return;
			}

			const goal = readGoal(deps.directory, sessionID);
			if (!goal) {
				await ctx.ui?.notify?.(
					"No active goal set. Use the `set_goal` tool to create one.",
					"info",
				);
				return;
			}

			await ctx.ui?.notify?.(formatGoal(goal), "info");
		},
	};
}
