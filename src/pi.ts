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

		// Ultra-hard rule block injected FIRST so the model cannot miss it.
		const hardRules = `=== HARD RULES (VIOLATE = WRONG) ===
1. For trivial one-line fixes (typos, missing null checks): fix DIRECTLY with edit/write tools. Do NOT delegate.
2. For bugs, features, or any multi-file changes: delegate ALL work to subagent agents.
3. NEVER explore files with bash/grep yourself. ALWAYS delegate exploration to subagent agent="explorer".
4. You ONLY classify, delegate, review. ALL implementation work goes to subagents.
=== END HARD RULES ===`;

		evt.systemPrompt = `${hardRules}\n\n${bootstrap}\n\n${original}`;


	});

	// Goal reminders + subagent bootstrap injection via user-message parts.
	// For subagents this supplements their agent .md system prompt.
	pi.on("context", (event, ctx) => {
		const messages = (event as any).messages;
		if (!Array.isArray(messages)) return;

		const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
		const agent = (ctx as any)?.agent ?? "orchestrator";

		// For subagents: inject full bootstrap into user messages.
		// For main session: inject an explicit delegation command into the LAST
		// user message so models that ignore system prompts still see it.
		let bootstrap: string | null = null;
		if (isSubagent()) {
			bootstrap = getBootstrapForAgent(agent);
		}

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

		// Extra nudge for main session: append explicit delegation instruction
		// to the last user message. Some fast models (e.g. kimi-for-coding)
		// ignore system prompts but obey direct commands in the user message.
		if (!isSubagent()) {
			const getRole = (m: any) => m.role ?? m.info?.role;
			const getContent = (m: any) => m.content ?? m.parts;
			const lastUser = messages.filter((m: any) => getRole(m) === 'user').pop();
			const content = getContent(lastUser);
			if (Array.isArray(content) && content.length > 0) {
				const nudge = '\n\nDELEGATION RULE: Trivial one-line fixes ONLY (typos, missing null checks) may be fixed directly with edit/write. ALL bugs, features, or anything requiring investigation MUST delegate to subagent agents. Do NOT use bash, codebase_map, or exploration tools yourself.';
				const lastTextPart = content.filter((p: any) => p.type === 'text').pop();
				if (lastTextPart && !lastTextPart.text.includes(nudge.trim())) {
					lastTextPart.text += nudge;
				}
			}
		}
	});
}
