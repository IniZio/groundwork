// ─── /handoff Command (Pi) ───────────────────────────────────────────────────
// Generates a handoff prompt for the user to copy into a new session.

import { buildHandoffInstructions } from "../../src/lib/handoff-instructions.js";

export function createHandoffCommand(_deps: { directory: string }) {
	return {
		description: "Create a handoff prompt for a new session",
		handler: async (_args: string, ctx: any) => {
			const sessionID = ctx?.sessionManager?.getSessionId?.() ?? "";
			const output = buildHandoffInstructions(sessionID);
			// Pi commands don't return values directly; send as message.
			await ctx.ui?.notify?.(output, "info");
		},
	};
}
