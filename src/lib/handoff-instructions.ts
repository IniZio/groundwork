// ─── Shared handoff instruction content ──────────────────────────────────────
// Used by both src/commands/handoff.ts (returns string) and
// pi/pi-commands/handoff.ts (emits via ctx.ui.notify).

/**
 * Builds the handoff instructions string for the /handoff command.
 * Returns an error message if no session ID is available.
 */
export function buildHandoffInstructions(sessionID: string): string {
	if (!sessionID) {
		return "Error: No session ID available.";
	}

	return (
		"## Handoff Instructions\n\n" +
		"To create a handoff for a new session:\n\n" +
		"1. Summarize what you've been working on\n" +
		"2. List key files that should be loaded\n" +
		"3. Call the `handoff_session` tool with your summary and file list\n\n" +
		"Example:\n" +
		"```\nhandoff_session({\n" +
		'  prompt: "Implementing auth middleware. Blocked on session validation logic.",\n' +
		'  files: ["src/auth.ts", "src/middleware.ts"]\n' +
		"})\n" +
		"```"
	);
}
