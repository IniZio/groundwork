// ─── /agents Command (Pi) ───────────────────────────────────────────────────
// List agents, view details, and manage model overrides.

import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface AgentInfo {
	name: string;
	model: string;
}

interface AgentOverrides {
	[agentName: string]: {
		model?: string;
	};
}

interface Settings {
	subagents?: {
		agentOverrides?: AgentOverrides;
	};
}

function resolveAgentsDir(): string {
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);
	return join(thisDir, "..", "..", "agents");
}

function discoverAgents(): AgentInfo[] {
	const agentsDir = resolveAgentsDir();
	if (!existsSync(agentsDir)) return [];

	const entries = readdirSync(agentsDir, { withFileTypes: true });
	const agents: AgentInfo[] = [];

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

		const filePath = join(agentsDir, entry.name);
		const content = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter(content);
		const name = entry.name.replace(/\.md$/, "");
		const model = (frontmatter?.model as string) ?? "(none)";

		agents.push({ name, model });
	}

	return agents.sort((a, b) => a.name.localeCompare(b.name));
}

function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

function readSettings(): Settings {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};
	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as Settings;
	} catch {
		return {};
	}
}

function writeSettings(settings: Settings): void {
	const path = getSettingsPath();
	writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

function getAgentOverrides(settings: Settings): AgentOverrides {
	return settings.subagents?.agentOverrides ?? {};
}

export function createAgentsCommand() {
	return {
		description: "List agents, view details, or override models",
		handler: async (args: string, ctx: any) => {
			const agents = discoverAgents();
			const parts = args.trim().split(/\s+/).filter(Boolean);

			if (parts.length === 0) {
				const settings = readSettings();
				const overrides = getAgentOverrides(settings);

				const lines = agents.map((agent) => {
					const override = overrides[agent.name]?.model;
					const displayModel = override
						? `${override} (overridden)`
						: agent.model;
					return `  ${agent.name.padEnd(15)} ${displayModel}`;
				});

				lines.push("");
				lines.push("Use: /agents <name> [model] to view or override");

				await ctx.ui?.notify?.(lines.join("\n"), "info");
				return;
			}

			const agentName = parts[0];
			const agent = agents.find((a) => a.name === agentName);

			if (!agent) {
				await ctx.ui?.notify?.(`Unknown agent: ${agentName}`, "error");
				return;
			}

			if (parts.length === 1) {
				const settings = readSettings();
				const overrides = getAgentOverrides(settings);
				const override = overrides[agentName]?.model;

				const lines = [
					`Agent: ${agentName}`,
					`Model: ${agent.model} (default)`,
					`Override: ${override ?? "(none)"}`,
					"",
					`/agents ${agentName} <model>  — override model`,
					`/agents ${agentName} --reset    — remove override`,
				];

				await ctx.ui?.notify?.(lines.join("\n"), "info");
				return;
			}

			if (parts[1] === "--reset") {
				const settings = readSettings();
				if (!settings.subagents?.agentOverrides?.[agentName]) {
					await ctx.ui?.notify?.(`No override set for ${agentName}`, "info");
					return;
				}

				delete settings.subagents.agentOverrides[agentName];
				writeSettings(settings);
				await ctx.ui?.notify?.(
					`Removed model override for ${agentName}`,
					"success",
				);
				return;
			}

			const model = parts[1];
			const settings = readSettings();

			if (!settings.subagents) {
				settings.subagents = {};
			}
			if (!settings.subagents.agentOverrides) {
				settings.subagents.agentOverrides = {};
			}

			settings.subagents.agentOverrides[agentName] = { model };
			writeSettings(settings);
			await ctx.ui?.notify?.(`Set ${agentName} model to ${model}`, "success");
		},
	};
}
