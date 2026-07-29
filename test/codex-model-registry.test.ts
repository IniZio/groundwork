import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
	applyCodexModelGuidance,
	renderCodexModelGuidance,
	type ModelRegistry,
} from "../scripts/generate-agent-definitions.js";

const root = resolve(__dirname, "..");
const registry = JSON.parse(
	readFileSync(resolve(root, "model-registry.json"), "utf8"),
) as ModelRegistry;

describe("Codex model registry generation", () => {
	test("preserves the requested specialist assignments", () => {
		expect(registry.agents.explore.codex).toBe("gpt-5.6-luna");
		expect(registry.agents["general-purpose"].codex).toBe("gpt-5.6-sol");
		expect(registry.agents.planner.codex).toBeUndefined();
		expect(registry.agents.advisor.codex).toBeUndefined();
	});

	test("emits deterministic Codex-facing routing guidance", () => {
		const output = renderCodexModelGuidance(registry);

		expect(output).toBe(
			[
				"<!-- CODEX-MODEL-ROUTING:BEGIN -->",
				"## Codex model routing",
				"",
				"Use these registry-backed assignments when Codex exposes model-selectable delegation.",
				"",
				"| Agent | Model |",
				"| --- | --- |",
				"| explore | gpt-5.6-luna |",
				"| general-purpose | gpt-5.6-sol |",
				"<!-- CODEX-MODEL-ROUTING:END -->",
				"",
			].join("\n"),
		);
		expect(
			applyCodexModelGuidance(
				"use-groundwork/reference/agent-selection.md",
				"# Agent selection\n",
				registry,
			),
		).toContain(output);
		expect(applyCodexModelGuidance("implement/SKILL.md", "unchanged\n", registry)).toBe(
			"unchanged\n",
		);
	});
});
