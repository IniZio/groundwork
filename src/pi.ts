import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureAgentsInstalled } from "./lib/agent-setup.js";
import { getBootstrapForAgent, injectGoalAndBootstrap } from "./lib/skills.js";
import { readGoal, goalReminder } from "./lib/goal.js";
import { createHandoffSessionTool } from "./pi-tools/handoff-session.js";
import { createSetGoalTool } from "./pi-tools/set-goal.js";
import { createHandoffCommand } from "./pi-commands/handoff.js";
import { createGoalCommand } from "./pi-commands/goal.js";
import { createGroundworkRuntime } from "./runtime.js";

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

  // Bootstrap + goal injection before every LLM call
  pi.on("context", (event, ctx) => {
    const messages = (event as any).messages;
    if (!Array.isArray(messages)) return;

    const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";
    const agent = (ctx as any)?.agent ?? "orchestrator";
    const bootstrap = getBootstrapForAgent(agent);

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
