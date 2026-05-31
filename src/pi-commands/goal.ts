// ─── /goal Command (Pi) ─────────────────────────────────────────────────────
// Quick command to check or set the active goal.

import { readGoal } from "../lib/goal.js";

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

			const criteria = goal.acceptanceCriteria
				.map(
					(c: string, i: number) =>
						`  ${i + 1}. [${goal.status === "achieved" ? "x" : " "}] ${c}`,
				)
				.join("\n");

			await ctx.ui?.notify?.(
				`Goal: ${goal.objective}\nStatus: ${goal.status}\nAcceptance Criteria:\n${criteria}`,
				"info",
			);
		},
	};
}
