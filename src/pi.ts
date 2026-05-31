import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureAgentsInstalled } from "./lib/agent-setup.js";
import { getBootstrapForAgent } from "./lib/skills.js";
import { readGoal, goalReminder, injectGoalAndBootstrap } from "./lib/goal.js";
import { createHandoffSessionTool } from "./pi-tools/handoff-session.js";
import { createSetGoalTool } from "./pi-tools/set-goal.js";
import { createHandoffCommand } from "./pi-commands/handoff.js";
import { createGoalCommand } from "./pi-commands/goal.js";
import { createGroundworkRuntime } from "./runtime.js";

/** True when running inside a subagent child process (depth > 0). */
function isSubagent(): boolean {
	const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
	return depth > 0;
}

export default function (pi: ExtensionAPI) {
	const runtime = createGroundworkRuntime();
	const directory = process.cwd();

	// ---- Tools ----
	pi.registerTool(createHandoffSessionTool({ directory }));
	pi.registerTool(createSetGoalTool({ directory }));

	// ---- Commands ----
	pi.registerCommand("handoff", createHandoffCommand({ directory }));
	pi.registerCommand("goal", createGoalCommand({ directory }));

	// ---- Events ----
	pi.on("session_start", (_event, ctx) => {
		const cwd = (ctx as any)?.cwd ?? process.cwd();
		const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
		runtime.cwd = cwd;

		if (sessionID && !runtime.agentsInstalledForSessions.has(sessionID)) {
			runtime.agentsInstalledForSessions.add(sessionID);
			ensureAgentsInstalled(cwd);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
		if (sessionID) {
			runtime.agentsInstalledForSessions.delete(sessionID);
		}
	});

	// Inject orchestrator identity into the SYSTEM PROMPT for the main session.
	// Subagents get their prompts from their agent .md files; skip them here.
	pi.on("before_agent_start", (event) => {
		if (isSubagent()) return;

		const bootstrap = getBootstrapForAgent("orchestrator");
		if (!bootstrap) return;

		const evt = event as any;
		const original = evt.systemPrompt ?? "";
		if (original.includes("EXTREMELY_IMPORTANT")) return; // already injected

		evt.systemPrompt = `${bootstrap}\n\n${original}`;
	});

	// Goal reminders + subagent bootstrap injection via user-message parts.
	// For subagents this supplements their agent .md system prompt.
	pi.on("context", (event, ctx) => {
		const messages = (event as any).messages;
		if (!Array.isArray(messages)) return;

		const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
		const agent = (ctx as any)?.agent ?? "orchestrator";

		// Only inject bootstrap into user messages for subagents;
		// the main session gets it via before_agent_start system prompt.
		const bootstrap = isSubagent() ? getBootstrapForAgent(agent) : null;

		let goalReminderText: string | null = null;
		if (sessionID) {
			const goal = readGoal(directory, sessionID);
			if (goal?.status === "active") {
				goalReminderText = goalReminder(goal);
			}
		}

		injectGoalAndBootstrap(messages, {
			bootstrap,
			goalReminder: goalReminderText,
		});
	});
}
