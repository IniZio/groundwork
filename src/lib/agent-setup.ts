// ─── Package-Local Agent Discovery ─────────────────────────────────────────
// Claude Code reads agents/*.md directly (model: field = Claude model ID).
// pi-subagents gets preprocessed copies where pi-model: overrides model:,
// so each runtime uses the right model identifiers without duplication.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function resolveAgentsDir(): string {
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);
	// From src/lib/ → package root → agents/
	return join(thisDir, "..", "..", "agents");
}

/**
 * Given agent frontmatter content, replace `model:` with the `pi-model:` value
 * and strip the `pi-model:` line. Returns content unchanged if no pi-model field.
 */
function applyPiModel(content: string): string {
	const piModelMatch = content.match(/^pi-model:\s+(.+)$/m);
	if (!piModelMatch) return content;

	const piModel = piModelMatch[1].trim();
	return content
		.replace(/^model:\s+.+$/m, `model: ${piModel}`)
		.replace(/^pi-model:\s+.+\n?/m, "");
}

/**
 * Generate pi-specific agent files in a stable temp directory, substituting
 * model: with pi-model: values. Returns the output directory path.
 */
function buildPiAgentsDir(agentsDir: string): string {
	const piDir = join(tmpdir(), "groundwork-pi-agents");
	mkdirSync(piDir, { recursive: true });

	for (const file of readdirSync(agentsDir)) {
		if (!file.endsWith(".md")) continue;
		const raw = readFileSync(join(agentsDir, file), "utf-8");
		writeFileSync(join(piDir, file), applyPiModel(raw));
	}

	return piDir;
}

/**
 * Ensure pi-subagents discovers pi-specific agent files by setting
 * PI_SUBAGENTS_EXTRA_AGENTS_DIR to a preprocessed copy of agents/ where
 * every pi-model: field has replaced its model: counterpart.
 *
 * Called early in the extension setup (before any session starts).
 */
export function ensureAgentsInstalled(_cwd: string): void {
	const agentsDir = resolveAgentsDir();
	const piDir = buildPiAgentsDir(agentsDir);
	process.env.PI_SUBAGENTS_EXTRA_AGENTS_DIR = piDir;
}
