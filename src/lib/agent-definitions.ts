// ─── Embedded Agent Definitions ─────────────────────────────────────────────
// Types and re-exports. Content is generated from agents-pi/*.md — see
// scripts/generate-agent-definitions.ts and `pnpm run generate:agents`.

export interface AgentDefinition {
	name: string;
	content: string;
	version: string;
}

export { GROUNDWORK_VERSION, EMBEDDED_AGENTS } from "./agent-definitions.generated.js";
