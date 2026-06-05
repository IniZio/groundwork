import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureAgentsInstalled } from "./lib/agent-setup.js";
import { getBootstrapForAgent } from "./lib/skills.js";
import { readGoal, goalReminder, injectGoalAndBootstrap } from "./lib/goal.js";
import { registerGroundworkProviders } from "./lib/provider-registry.js";
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
	// Register custom model providers so pi-subagents can resolve our model strings
	// (e.g. "kimi-for-coding", "opencode-go/deepseek-v4-flash", etc.)
	registerGroundworkProviders(pi);

	const runtime = createGroundworkRuntime();
	const directory = process.cwd();

	// Set PI_SUBAGENTS_EXTRA_AGENTS_DIR early so pi-subagents discovers our
	// package-local agents/ directory. No runtime file writing needed.
	ensureAgentsInstalled(directory);

	// ---- Tools ----
	pi.registerTool(createHandoffSessionTool({ directory }));
	pi.registerTool(createSetGoalTool({ directory }));

	// ---- Commands ----
	pi.registerCommand("handoff", createHandoffCommand({ directory }));
	pi.registerCommand("goal", createGoalCommand({ directory }));

	// ---- Events ----
	pi.on("session_start", (_event, ctx) => {
		const cwd = (ctx as any)?.cwd ?? process.cwd();
		runtime.cwd = cwd;
	});

	pi.on("session_shutdown", (_event, _ctx) => {
		// No-op: agent dir is now static (package-local), no per-session cleanup needed.
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
		const hardRules = `=== HARD RULES (VIOLATE = WRONG) — EXTREME FAN-OUT / ULTRAWORK MODE ===
1. For trivial one-line fixes (typos, missing null checks, obvious config changes) AND clear low-risk small changes (add validation rule, extract helper, add null check): fix DIRECTLY with edit/write tools.
2. For ALL bugs, features, ambiguous changes, or anything touching shared code / multiple modules: delegate ALL work to subagent agents. NO EXCEPTIONS.
3. NEVER explore files with bash/grep yourself. ALWAYS delegate exploration to subagent agent="explorer".
4. You ONLY classify, delegate, review. ALL implementation work goes to subagents.
5. SEMANTIC SLICING: each task must have ONE clear objective. If a task touches many files or feels complex, split it into smaller independent tasks.
6. Fan out aggressively: launch ALL independent subagent calls in ONE message. Sequential execution is only for dependencies.
7. Use the cheapest capable model for each slice. coder = kimi-for-coding. advisor = gpt-5.4 for hard decisions only.
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
			const lastUser = messages.filter((m: any) => getRole(m) === "user").pop();
			const content = getContent(lastUser);
			if (Array.isArray(content) && content.length > 0) {
				const nudge =
					"\n\nDELEGATION RULE: Trivial one-line fixes (typos, missing null checks, obvious config changes) AND clear low-risk small changes (add validation rule, extract helper, add null check) may be fixed directly with edit/write. ALL bugs, features, ambiguous changes, or anything touching shared code / multiple modules MUST delegate to subagent agents. Do NOT use bash, codebase_map, or exploration tools yourself. EXTREME FAN-OUT: decompose into semantic slices (one clear objective per task), then launch ALL independent subagent calls in ONE message.";
				const lastTextPart = content
					.filter((p: any) => p.type === "text")
					.pop();
				if (lastTextPart && !lastTextPart.text.includes(nudge.trim())) {
					lastTextPart.text += nudge;
				}
			}
		}
	});
}
