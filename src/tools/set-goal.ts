// ─── set_goal Tool ──────────────────────────────────────────────────────────

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { ToolDeps } from "./deps.js";
import { readGoal, writeGoal, clearGoal, type Goal } from "../lib/goal.js";

export function createSetGoalTool(deps: ToolDeps) {
	const { client, directory } = deps;
	return tool({
		description:
			"Manage the active session goal. Set a new goal, check status, pause, resume, mark achieved, or clear. The goal is scoped to the current session and is injected into every message as a reminder.",
		args: {
			action: z
				.enum(["set", "status", "pause", "resume", "achieved", "clear"])
				.describe(
					"Action to perform: set (create/replace goal), status (read current), pause, resume, achieved (mark done), clear (delete)",
				),
			objective: z
				.string()
				.optional()
				.describe('Goal objective text (required for "set" action)'),
			acceptanceCriteria: z
				.array(z.string())
				.optional()
				.describe(
					'List of verifiable acceptance criteria (required for "set" action)',
				),
		},
		async execute(args: any, context: any) {
			const { action, objective, acceptanceCriteria } = args;
			const sessionID = context?.sessionID;
			if (!sessionID) {
				return "Error: No session ID available. Cannot manage goal.";
			}

			switch (action) {
				case "status": {
					const goal = readGoal(directory, sessionID);
					if (!goal) return "No active goal set.";
					const criteria = goal.acceptanceCriteria
						.map((c: string, i: number) => `  ${i + 1}. [ ] ${c}`)
						.join("\n");
					return `Goal: ${goal.objective}\nStatus: ${goal.status}\nCreated: ${goal.createdAt}\nUpdated: ${goal.updatedAt}\nAcceptance Criteria:\n${criteria}`;
				}

				case "set": {
					if (!objective || !acceptanceCriteria?.length) {
						return 'Error: "objective" and "acceptanceCriteria" are required for the "set" action.';
					}
					const existing = readGoal(directory, sessionID);
					if (existing?.status === "active") {
						return `Error: An active goal already exists: "${existing.objective}". Clear it first with action "clear", or mark it "achieved".`;
					}
					const goal: Goal = {
						objective,
						acceptanceCriteria,
						status: "active",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};
					writeGoal(directory, sessionID, goal);
					return `Goal set: "${objective}"\nAcceptance Criteria:\n${acceptanceCriteria.map((c: string, i: number) => `  ${i + 1}. ${c}`).join("\n")}\n\nThis goal will be injected into every message as a reminder. It is scoped to the current session.`;
				}

				case "pause": {
					const goal = readGoal(directory, sessionID);
					if (!goal) return "No active goal to pause.";
					if (goal.status !== "active")
						return `Goal is already ${goal.status}.`;
					goal.status = "paused";
					writeGoal(directory, sessionID, goal);
					return `Goal paused: "${goal.objective}"`;
				}

				case "resume": {
					const goal = readGoal(directory, sessionID);
					if (!goal) return "No goal to resume.";
					if (goal.status !== "paused")
						return `Goal is ${goal.status}, not paused.`;
					goal.status = "active";
					writeGoal(directory, sessionID, goal);
					return `Goal resumed: "${goal.objective}"`;
				}

				case "achieved": {
					const goal = readGoal(directory, sessionID);
					if (!goal) return "No goal to mark as achieved.";
					goal.status = "achieved";
					writeGoal(directory, sessionID, goal);
					return `Goal marked as achieved: "${goal.objective}"\nClear it with action "clear" when ready.`;
				}

				case "clear": {
					const removed = clearGoal(directory, sessionID);
					return removed ? "Goal cleared." : "No goal to clear.";
				}

				default:
					return `Unknown action: ${action}`;
			}
		},
	});
}
