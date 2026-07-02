// ─── /goal Command ──────────────────────────────────────────────────────────
// Quick command to check or set the active goal.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readGoal } from "../lib/goal.js";
import { formatGoal } from "../lib/goal-format.js";

export function createGoalCommand(deps: { directory: string }) {
	return {
		description: "Check or manage the active project goal",
		handler: async (_args: string[], ctx: ExtensionContext) => {
			const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
			if (!sessionID) {
				return "Error: No session ID available.";
			}

			return formatGoal(readGoal(deps.directory, sessionID));
		},
	};
}
