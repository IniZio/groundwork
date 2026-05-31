// ─── handoff_session Tool ──────────────────────────────────────────────────

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { ToolDeps } from "./deps.js";

export function createHandoffSessionTool(deps: ToolDeps) {
	const { client } = deps;
	return tool({
		description:
			"Create a new session with the handoff prompt as an editable draft. Called after /handoff command generates the summary.",
		args: {
			prompt: z.string().describe("The generated handoff prompt"),
			files: z
				.array(z.string())
				.optional()
				.describe("Array of file paths to load into the new session context"),
		},
		async execute(args: any, context: any) {
			const sessionID = context?.sessionID;
			if (!sessionID) {
				return "Error: No session ID available. Cannot perform handoff.";
			}

			const sessionReference = `Continuing work from session ${sessionID}. When you lack specific information you can use read_session to get it.`;
			const fileRefs = args.files?.length
				? args.files.map((f: string) => `@${f.replace(/^@/, "")}`).join(" ")
				: "";

			const fullPrompt = fileRefs
				? `${sessionReference}\n\n${fileRefs}\n\n${args.prompt}`
				: `${sessionReference}\n\n${args.prompt}`;

			await client.tui.executeCommand({ body: { command: "session_new" } });
			// session_new is fire-and-forget. The TUI needs time to navigate and mount
			// the new prompt input before appendPrompt can insert text.
			await new Promise((r) => setTimeout(r, 150));
			await client.tui.appendPrompt({ body: { text: fullPrompt } });
			await client.tui.showToast({
				body: {
					title: "Handoff Ready",
					message: "Review and edit the draft, then send",
					variant: "success",
					duration: 4000,
				},
			});

			return "Handoff prompt created in new session. Review and edit before sending.";
		},
	});
}
