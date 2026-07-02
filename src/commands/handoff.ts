// ─── /handoff Command ───────────────────────────────────────────────────────
// Generates a handoff prompt for the user to copy into a new session.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildHandoffInstructions } from "../lib/handoff-instructions.js";

export function createHandoffCommand(_deps: { directory: string }) {
	return {
		description: "Create a handoff prompt for a new session",
		handler: async (_args: string[], ctx: ExtensionContext) => {
			const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
			return buildHandoffInstructions(sessionID);
		},
	};
}
