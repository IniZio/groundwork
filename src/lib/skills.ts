import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pi loads skills from .pi/skills/<name>/SKILL.md
const groundworkSkillsDir = path.resolve(__dirname, "../../.pi/skills");

const PTY_SECTION_REGEX =
	/<!-- PTY-SECTION-START -->[\s\S]*?<!-- PTY-SECTION-END -->/;
const PTY_ONLY_REGEX =
	/<!-- PTY-ONLY-START -->\n?[\s\S]*?\n?<!-- PTY-ONLY-END -->/;

const BASH_ONLY_RULES = `5. **Use \`bash\` for shell commands.** Run builds, tests, and one-shot tooling via bash with appropriate timeouts. Long-running processes (dev servers, \`docker compose up\`, watch modes) block the shell until they exit or time out. For interactive flows (\`git rebase -i\`, \`git add -p\`, editors), prefer non-interactive alternatives when possible.
6. **Avoid poll-repeat loops.** Do not call the same status command repeatedly in a tight loop. Use \`--watch\`/\`--follow\`/\`-f\` on a single bash invocation when the CLI supports it; otherwise run once and report status.`;

/** Set in config() before bootstrap is generated; drives PTY vs bash-only rules. */
export let ptyPluginAvailable = false;

export function setPtyPluginAvailable(value: boolean): void {
	if (ptyPluginAvailable !== value) {
		ptyPluginAvailable = value;
		bootstrapContentCache.clear();
	}
}

export function getPtyPluginAvailable(): boolean {
	return ptyPluginAvailable;
}

export function detectPtyPlugin(plugins: unknown): boolean {
	if (!Array.isArray(plugins)) return false;
	for (const entry of plugins) {
		if (typeof entry === "string") {
			if (isOpencodePtyPluginName(entry)) return true;
		} else if (
			Array.isArray(entry) &&
			entry.length > 0 &&
			typeof entry[0] === "string"
		) {
			if (isOpencodePtyPluginName(entry[0])) return true;
		}
	}
	return false;
}

function isOpencodePtyPluginName(name: string): boolean {
	if (name === "opencode-pty") return true;
	const base = name.split("/").pop() ?? name;
	return base === "opencode-pty" || base.endsWith("opencode-pty");
}

export function extractAndStripFrontmatter(content: string): {
	frontmatter: Record<string, any>;
	content: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, content };
	const frontmatterStr = match[1];
	const body = match[2];
	let frontmatter: Record<string, any> = {};
	try {
		frontmatter = (yaml.load(frontmatterStr) as Record<string, any>) || {};
	} catch {
		// Malformed frontmatter: return empty frontmatter but preserve content
	}
	return { frontmatter, content: body };
}

function unwrapPtyMarkers(
	block: string,
	startMarker: string,
	endMarker: string,
): string {
	return block
		.replace(new RegExp(`${startMarker}\\n?`), "")
		.replace(new RegExp(`\\n?${endMarker}`), "")
		.trim();
}

function applyPtySection(content: string): string {
	let result = content;

	if (ptyPluginAvailable) {
		result = result.replace(PTY_SECTION_REGEX, (block) =>
			unwrapPtyMarkers(
				block,
				"<!-- PTY-SECTION-START -->",
				"<!-- PTY-SECTION-END -->",
			),
		);
		result = result.replace(PTY_ONLY_REGEX, (block) =>
			unwrapPtyMarkers(
				block,
				"<!-- PTY-ONLY-START -->",
				"<!-- PTY-ONLY-END -->",
			),
		);
	} else {
		result = result.replace(PTY_SECTION_REGEX, BASH_ONLY_RULES);
		result = result.replace(PTY_ONLY_REGEX, "");
	}

	return result;
}

const bootstrapContentCache = new Map<string, string | null>();

function bootstrapCacheKey(agent: string): string {
	return `${agent}:${ptyPluginAvailable ? "pty" : "bash"}`;
}

export function getBootstrapForAgent(agent: string): string | null {
	const cacheKey = bootstrapCacheKey(agent);
	const cached = bootstrapContentCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const universalPath = path.join(
		groundworkSkillsDir,
		"use-groundwork",
		"bootstrap-universal.md",
	);
	let universalContent = "";
	let fallbackContent = "";
	let usingFallback = false;

	if (existsSync(universalPath)) {
		const fullContent = readFileSync(universalPath, "utf8");
		const { content } = extractAndStripFrontmatter(fullContent);
		universalContent = applyPtySection(content);
	} else {
		// Fallback: load the full SKILL.md
		const skillPath = path.join(
			groundworkSkillsDir,
			"use-groundwork",
			"SKILL.md",
		);
		if (!existsSync(skillPath)) {
			bootstrapContentCache.set(cacheKey, null);
			return null;
		}
		const fullContent = readFileSync(skillPath, "utf8");
		const { content } = extractAndStripFrontmatter(fullContent);
		fallbackContent = applyPtySection(content);
		usingFallback = true;
	}

	let agentContent = "";
	if (agent === "orchestrator") {
		const agentPath = path.join(
			groundworkSkillsDir,
			"use-groundwork",
			"bootstrap-orchestrator.md",
		);
		if (existsSync(agentPath)) {
			const fullContent = readFileSync(agentPath, "utf8");
			const { content } = extractAndStripFrontmatter(fullContent);
			agentContent = applyPtySection(content);
		}
	} else if (agent === "coder") {
		const agentPath = path.join(
			groundworkSkillsDir,
			"use-groundwork",
			"bootstrap-coder.md",
		);
		if (existsSync(agentPath)) {
			const fullContent = readFileSync(agentPath, "utf8");
			const { content } = extractAndStripFrontmatter(fullContent);
			agentContent = applyPtySection(content);
		}
	}

	const bodyContent = usingFallback
		? fallbackContent
		: [universalContent, agentContent].filter(Boolean).join("\n\n");

	// Stripped-down bootstrap for main session — models with short attention spans
	// need the rules up-front and repeated.
	const hardRules = `=== ORCHESTRATOR HARD RULES (EXTREME FAN-OUT / ULTRAWORK MODE) ===
1. You are the ORCHESTRATOR. You NEVER write/edit code or explore files yourself.
2. ALWAYS delegate implementation to subagent agent="coder".
3. ALWAYS delegate exploration to subagent agent="explore".
4. ALL bugs → read diagnose SKILL.md → delegate to parallel coder subagents. NO EXCEPTIONS.
5. ALL features → read interview SKILL.md (synthesizes a concise plan) → read vertical-slice SKILL.md (writes the .groundwork/run.json ledger) → fan out parallel coder subagents.
6. Trivial one-line fixes ONLY (typos, missing null checks, obvious config changes) → fix directly, then read advisor-gate SKILL.md.
7. NEVER use edit, write, or bash for exploration/debugging. ONLY subagent and read.
8. SEMANTIC SLICING: each task must have ONE clear objective. If a task feels complex or touches many files, split it into smaller independent tasks.
9. Send ALL parallel subagent calls in ONE message. Sequential = wrong.
=== END HARD RULES ===`;

	const bootstrap = `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The use-groundwork skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "use-groundwork" again.**

${hardRules}

${bodyContent}
</EXTREMELY_IMPORTANT>`;

	bootstrapContentCache.set(cacheKey, bootstrap);
	return bootstrap;
}

// Backward-compatible alias for legacy callers
export function getBootstrapContent(): string | null {
	return getBootstrapForAgent("orchestrator");
}
