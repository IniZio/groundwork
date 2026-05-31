// ─── set_goal Tool (Pi) ─────────────────────────────────────────────────────

import {
	defineTool,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { PiToolDeps } from "./deps.js";
import { readGoal, writeGoal, clearGoal, type Goal } from "../lib/goal.js";

export function createSetGoalTool(deps: PiToolDeps) {
	const { directory } = deps;

	return defineTool({
		name: "set_goal" as const,
		label: "Set Goal",
		description:
			"Manage the active session goal. Set a new goal, check status, pause, resume, mark achieved, or clear. " +
			"The goal is scoped to the current session and is injected into every message as a reminder.",
		parameters: Type.Object({
			action: Type.String({
				description:
					'Action to perform: "set", "status", "pause", "resume", "achieved", or "clear".',
			}),
			objective: Type.Optional(
				Type.String({
					description: 'Goal objective text (required for "set" action).',
				}),
			),
			acceptanceCriteria: Type.Optional(
				Type.Array(Type.String(), {
					description:
						'List of verifiable acceptance criteria (required for "set" action).',
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
			const action = params.action as string;
			const objective = params.objective as string | undefined;
			const acceptanceCriteria = params.acceptanceCriteria as
				| string[]
				| undefined;
			const sessionID = (ctx as any)?.sessionManager?.getSessionId?.() ?? "";

			if (!sessionID) {
				return {
					content: [
						{
							type: "text",
							text: "Error: No session ID available. Cannot manage goal.",
						},
					],
					details: undefined,
				};
			}

			switch (action) {
				case "status": {
					const goal = readGoal(directory, sessionID);
					if (!goal) {
						return {
							content: [{ type: "text", text: "No active goal set." }],
							details: undefined,
						};
					}
					const criteria = goal.acceptanceCriteria
						.map((c: string, i: number) => `  ${i + 1}. [ ] ${c}`)
						.join("\n");
					return {
						content: [
							{
								type: "text",
								text: `Goal: ${goal.objective}\nStatus: ${goal.status}\nCreated: ${goal.createdAt}\nUpdated: ${goal.updatedAt}\nAcceptance Criteria:\n${criteria}`,
							},
						],
						details: undefined,
					};
				}

				case "set": {
					if (!objective || !acceptanceCriteria?.length) {
						return {
							content: [
								{
									type: "text",
									text: 'Error: "objective" and "acceptanceCriteria" are required for the "set" action.',
								},
							],
							details: undefined,
						};
					}
					const existing = readGoal(directory, sessionID);
					if (existing?.status === "active") {
						return {
							content: [
								{
									type: "text",
									text: `Error: An active goal already exists: "${existing.objective}". Clear it first with action "clear", or mark it "achieved".`,
								},
							],
							details: undefined,
						};
					}
					const goal: Goal = {
						objective,
						acceptanceCriteria,
						status: "active",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};
					writeGoal(directory, sessionID, goal);
					return {
						content: [
							{
								type: "text",
								text: `Goal set: "${objective}"\nAcceptance Criteria:\n${acceptanceCriteria
									.map((c: string, i: number) => `  ${i + 1}. ${c}`)
									.join(
										"\n",
									)}\n\nThis goal will be injected into every message as a reminder. It is scoped to the current session.`,
							},
						],
						details: undefined,
					};
				}

				case "pause": {
					const goal = readGoal(directory, sessionID);
					if (!goal) {
						return {
							content: [{ type: "text", text: "No active goal to pause." }],
							details: undefined,
						};
					}
					if (goal.status !== "active") {
						return {
							content: [
								{ type: "text", text: `Goal is already ${goal.status}.` },
							],
							details: undefined,
						};
					}
					goal.status = "paused";
					writeGoal(directory, sessionID, goal);
					return {
						content: [
							{ type: "text", text: `Goal paused: "${goal.objective}"` },
						],
						details: undefined,
					};
				}

				case "resume": {
					const goal = readGoal(directory, sessionID);
					if (!goal) {
						return {
							content: [{ type: "text", text: "No goal to resume." }],
							details: undefined,
						};
					}
					if (goal.status !== "paused") {
						return {
							content: [
								{ type: "text", text: `Goal is ${goal.status}, not paused.` },
							],
							details: undefined,
						};
					}
					goal.status = "active";
					writeGoal(directory, sessionID, goal);
					return {
						content: [
							{ type: "text", text: `Goal resumed: "${goal.objective}"` },
						],
						details: undefined,
					};
				}

				case "achieved": {
					const goal = readGoal(directory, sessionID);
					if (!goal) {
						return {
							content: [{ type: "text", text: "No goal to mark as achieved." }],
							details: undefined,
						};
					}
					goal.status = "achieved";
					writeGoal(directory, sessionID, goal);
					return {
						content: [
							{
								type: "text",
								text: `Goal marked as achieved: "${goal.objective}"\nClear it with action "clear" when ready.`,
							},
						],
						details: undefined,
					};
				}

				case "clear": {
					const removed = clearGoal(directory, sessionID);
					return {
						content: [
							{
								type: "text",
								text: removed ? "Goal cleared." : "No goal to clear.",
							},
						],
						details: undefined,
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${action}` }],
						details: undefined,
					};
			}
		},
	});
}
