// ─── handoff_session Tool (Pi) ──────────────────────────────────────────────

import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { ToolDeps } from "../tools/deps.js";

export function createHandoffSessionTool(deps: ToolDeps) {
  return defineTool({
    name: "handoff_session" as const,
    label: "Handoff Session",
    description:
      "Create a handoff prompt for continuing work in a new session. " +
      "Outputs a formatted handoff message with file references that the user can paste into a new session.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "The generated handoff prompt summarizing the work to continue.",
      }),
      files: Type.Optional(
        Type.Array(Type.String(), {
          description: "Array of file paths to include in the handoff context.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
      if (!sessionID) {
        return {
          content: [
            { type: "text", text: "Error: No session ID available. Cannot perform handoff." },
          ],
          details: undefined,
        };
      }

      const sessionReference = `Continuing work from session ${sessionID}. When you lack specific information you can use read_session to get it.`;
      const fileRefs = (params.files as string[] | undefined)?.length
        ? (params.files as string[])
            .map((f: string) => `@${f.replace(/^@/, "")}`)
            .join(" ")
        : "";

      const fullPrompt = fileRefs
        ? `${sessionReference}\n\n${fileRefs}\n\n${params.prompt}`
        : `${sessionReference}\n\n${params.prompt}`;

      return {
        content: [
          {
            type: "text",
            text: `## Handoff Prompt\n\nCopy the text below into a new session to continue work:\n\n\`\`\`\n${fullPrompt}\n\`\`\`\n\n**Tip:** Create a new session, then paste the prompt above into the input field.`,
          },
        ],
        details: undefined,
      };
    },
  });
}
