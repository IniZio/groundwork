import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const AGENTS_DIR = resolve(__dirname, "../../agents");

// Valid: Claude aliases or full claude-* / us.anthropic.claude-* IDs
const VALID_MODEL = /^(sonnet|opus|haiku|claude-.+|us\.anthropic\.claude-.+)$/;

function extractModel(content: string): string | null {
	const match = content.match(/^model:\s*(.+)$/m);
	return match ? match[1].trim() : null;
}

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));

describe("agent model: field — no broken provider IDs", () => {
	test.each(agentFiles)("%s uses a valid Claude model", (file) => {
		const content = readFileSync(join(AGENTS_DIR, file), "utf8");
		const model = extractModel(content);
		expect(model, `${file}: missing model: field`).not.toBeNull();
		expect(
			VALID_MODEL.test(model!),
			`${file}: invalid model "${model}" — must be sonnet|opus|haiku or claude-* pattern. ` +
				`Non-Claude provider IDs (openai-codex, cursor-agent, opencode-go, neuralwatt, kimi) ` +
				`are only valid in pi-model: not model:`
		).toBe(true);
	});
});
