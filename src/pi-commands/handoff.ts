// ─── /handoff Command (Pi) ───────────────────────────────────────────────────
// Generates a handoff prompt for the user to copy into a new session.

export function createHandoffCommand(deps: { directory: string }) {
  return {
    description: "Create a handoff prompt for a new session",
    handler: async (_args: string, ctx: any) => {
      const sessionID = ctx?.sessionManager?.getSessionId?.() ?? "";
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
        '```\nhandoff_session({\n' +
        '  prompt: "Implementing auth middleware. Blocked on session validation logic.",\n' +
        '  files: ["src/auth.ts", "src/middleware.ts"]\n' +
        "})\n" +
        "```"
      );
    },
  };
}
