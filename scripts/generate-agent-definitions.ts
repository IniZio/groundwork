import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// ─── Types ───────────────────────────────────────────────────────────────────

type Frontmatter = Record<string, unknown>;

interface AgentSource {
	name: string;
	frontmatter: Frontmatter;
	body: string;
}

interface PlatformModelEntry {
	pi?: string;
	opencode?: string;
	[key: string]: string | undefined;
}

interface ModelRegistry {
	agents: Record<string, PlatformModelEntry>;
	disabled?: Record<string, string[] | undefined>;
	aliases?: Record<string, Record<string, string> | undefined>;
}

interface AgentDefinition {
	name: string;
	version: string;
	content: string;
}

interface TransformedAgent {
	outputName: string;
	definitionName: string;
	content: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORMS = ["pi", "opencode", "claude-code"] as const;
type Platform = (typeof PLATFORMS)[number];

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const sourceAgentsDir = join(rootDir, "agents-src");
const registryPath = join(rootDir, "model-registry.json");
const packageJsonPath = join(rootDir, "package.json");
const generatedTsPath = join(rootDir, "src", "lib", "agent-definitions.generated.ts");

const shouldCheck = process.argv.includes("--check");

// Frontmatter fields that belong ONLY to the pi/opencode platforms — NOT Claude Code.
// The model-neutral source (agents-src/*.md) carries only name, description, and
// disallowedTools (a CC-only enforcement field). These platform-only fields are
// re-injected here so the generated pi/opencode trees are behaviorally unchanged.
// Agents not listed get DEFAULT_PLATFORM_FRONTMATTER.
// Claude Code output (agents/) is handled by transformForClaudeCode() — no injection.
const RO_TOOLS = "read, bash, grep, find, ls";
const RW_TOOLS = "read, bash, edit, write, grep, find, ls";
const PLATFORM_ONLY_FRONTMATTER: Record<string, Frontmatter> = {
	advisor: { prompt_mode: "replace", tools: RO_TOOLS },
	critic: { prompt_mode: "replace", tools: RO_TOOLS },
	designer: { prompt_mode: "replace", tools: RW_TOOLS },
	explore: { prompt_mode: "replace", tools: RO_TOOLS },
	"general-purpose": { prompt_mode: "replace", thinking: "low", tools: RW_TOOLS },
	"git-master": { prompt_mode: "replace", tools: RO_TOOLS, permission: { task: { "*": "deny" } } },
	orchestrator: { prompt_mode: "append", thinking: "minimal", mode: "primary", tools: RW_TOOLS },
	planner: { prompt_mode: "replace", tools: RO_TOOLS },
	"test-engineer": { prompt_mode: "replace", tools: RW_TOOLS, permission: { task: { "*": "deny", explore: "allow" } } },
	qa: { prompt_mode: "replace", tools: RW_TOOLS },
};
const DEFAULT_PLATFORM_FRONTMATTER: Frontmatter = { prompt_mode: "replace", tools: RW_TOOLS };

// Preferred frontmatter key order for generated output.
const FRONTMATTER_ORDER = [
	"name",
	"description",
	"model",
	"thinking",
	"mode",
	"enabled",
	"prompt_mode",
	"tools",
	"permission",
	"managed_by",
	"groundwork_version",
];

// ─── pi built-in overrides ───────────────────────────────────────────────────
// Suppress pi's built-in `Explore` and `Plan` agents. These are NOT part of the
// model-neutral source set (agents-src/*.md) and are never written to the filesystem;
// they appear only in the pi branch of the embedded TS. opencode has no such
// built-ins to suppress (it uses the explore→explorer file alias instead).
// Kept per advisor-gate decision to preserve runtime behavior.
function piBuiltinOverrides(version: string): AgentDefinition[] {
	return [
		{
			name: "Explore",
			version,
			content: `---\nenabled: false\nmanaged_by: groundwork\ngroundwork_version: "${version}"\n---\n\nDisabled by groundwork — use \`explore\` instead.\n`,
		},
		{
			name: "Plan",
			version,
			content: `---\nenabled: false\nmanaged_by: groundwork\ngroundwork_version: "${version}"\n---\n\nDisabled by groundwork.\n`,
		},
	];
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

function readPackageVersion(): string {
	const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
	if (!pkg.version) throw new Error(`Missing version in ${packageJsonPath}`);
	return pkg.version;
}

function loadRegistry(): ModelRegistry {
	const raw = JSON.parse(readFileSync(registryPath, "utf8")) as ModelRegistry;
	if (!raw.agents || typeof raw.agents !== "object") {
		throw new Error(`Registry missing "agents" object: ${registryPath}`);
	}
	return raw;
}

function splitFrontmatter(source: string, fileName: string): { frontmatter: Frontmatter; body: string } {
	if (!source.startsWith("---\n")) {
		throw new Error(`${fileName}: markdown must start with YAML frontmatter`);
	}
	const end = source.indexOf("\n---\n", 4);
	if (end === -1) {
		throw new Error(`${fileName}: could not find closing YAML frontmatter delimiter`);
	}
	const raw = source.slice(4, end);
	const body = source.slice(end + 5);
	const parsed = yaml.load(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${fileName}: frontmatter must parse to an object`);
	}
	return { frontmatter: parsed as Frontmatter, body };
}

function loadAgentSources(): Map<string, AgentSource> {
	const entries = readdirSync(sourceAgentsDir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name)
		.sort();

	const map = new Map<string, AgentSource>();
	for (const fileName of entries) {
		const source = readFileSync(join(sourceAgentsDir, fileName), "utf8");
		const { frontmatter, body } = splitFrontmatter(source, fileName);
		const name = typeof frontmatter.name === "string" ? frontmatter.name : basename(fileName, ".md");
		map.set(basename(fileName, ".md"), { name, frontmatter, body });
	}
	return map;
}

function validateRegistry(sources: Map<string, AgentSource>, registry: ModelRegistry): void {
	const registryNames = new Set(Object.keys(registry.agents));
	const sourceNames = new Set(sources.keys());

	for (const name of sourceNames) {
		if (!registryNames.has(name)) {
			throw new Error(`Source agent "${name}" has no entry in model-registry.json`);
		}
	}
	for (const name of registryNames) {
		if (!sourceNames.has(name)) {
			throw new Error(`Registry agent "${name}" has no source file in agents-src/`);
		}
	}
}

// ─── Per-platform transformation ─────────────────────────────────────────────

function platformModel(registry: ModelRegistry, name: string, platform: Platform): string {
	const entry = registry.agents[name];
	const model = entry?.[platform];
	if (model === undefined) {
		throw new Error(`Registry missing ${platform} model for agent "${name}"`);
	}
	return model;
}

function isDisabled(registry: ModelRegistry, name: string, platform: Platform, model: string): boolean {
	const disabledList = registry.disabled?.[platform] ?? [];
	return disabledList.includes(name) || model === "DISABLED";
}

function platformAlias(registry: ModelRegistry, name: string, platform: Platform): string | undefined {
	return registry.aliases?.[platform]?.[name];
}

function transformForPlatform(
	src: AgentSource,
	registry: ModelRegistry,
	platform: Platform,
	version: string,
): TransformedAgent {
	const model = platformModel(registry, src.name, platform);
	const disabled = isDisabled(registry, src.name, platform, model);
	const alias = platformAlias(registry, src.name, platform);

	const fm: Frontmatter = { ...src.frontmatter };

	// `disallowedTools` is a Claude-Code-only frontmatter field (read-only enforcement);
	// pi/opencode express tool restrictions via `permission`, so drop it from their output.
	delete fm.disallowedTools;

	// Re-inject pi/opencode-only frontmatter stripped from the model-neutral source.
	const platformOnly = PLATFORM_ONLY_FRONTMATTER[src.name] ?? DEFAULT_PLATFORM_FRONTMATTER;
	for (const [key, value] of Object.entries(platformOnly)) {
		fm[key] = value;
	}

	if (disabled) {
		fm.enabled = false;
	}
	// DISABLED models omit the model field; otherwise inject the registry model.
	if (model !== "DISABLED") {
		fm.model = model;
	} else {
		delete fm.model;
	}

	// Apply alias so output filename stem == frontmatter `name` == platform identity.
	const definitionName = alias ?? src.name;
	if (alias) {
		fm.name = alias;
	}

	fm.managed_by = "groundwork";
	fm.groundwork_version = version;

	return {
		outputName: `${definitionName}.md`,
		definitionName,
		content: buildFileContent(fm, src.body),
	};
}

// ─── Claude Code–specific transformation ─────────────────────────────────────

// Valid Claude Code model aliases. "inherit" is NOT valid for CC subagent definitions.
const CLAUDE_CODE_VALID_MODELS = new Set(["opus", "sonnet", "haiku"]);

function transformForClaudeCode(
	src: AgentSource,
	registry: ModelRegistry,
	version: string,
): TransformedAgent {
	const model = registry.agents[src.name]?.["claude-code"];
	if (model === undefined) {
		throw new Error(`Registry missing claude-code model for agent "${src.name}"`);
	}
	if (!CLAUDE_CODE_VALID_MODELS.has(model)) {
		throw new Error(
			`Registry claude-code model for "${src.name}" is "${model}" — must be one of: opus, sonnet, haiku (never "inherit" or platform-specific strings)`,
		);
	}

	// Claude Code only honors: name, description, model, disallowedTools.
	// We must NOT inject prompt_mode, tools, managed_by, thinking, mode, groundwork_version.
	const fm: Frontmatter = {};
	if (typeof src.frontmatter.name === "string") fm.name = src.frontmatter.name;
	if (typeof src.frontmatter.description === "string") fm.description = src.frontmatter.description;
	fm.model = model;
	if (src.frontmatter.disallowedTools !== undefined) {
		fm.disallowedTools = src.frontmatter.disallowedTools;
	}

	return {
		outputName: `${src.name}.md`,
		definitionName: src.name,
		content: buildFileContent(fm, src.body),
	};
}

function generatePlatformFiles(
	sources: Map<string, AgentSource>,
	registry: ModelRegistry,
	platform: Platform,
	version: string,
): Map<string, string> {
	const files = new Map<string, string>();
	for (const src of sources.values()) {
		if (platform === "claude-code") {
			const t = transformForClaudeCode(src, registry, version);
			files.set(t.outputName, t.content);
		} else {
			const t = transformForPlatform(src, registry, platform, version);
			files.set(t.outputName, t.content);
		}
	}
	return files;
}

// ─── Frontmatter rendering ───────────────────────────────────────────────────

function orderedFrontmatter(fm: Frontmatter): Frontmatter {
	const ordered: Frontmatter = {};
	for (const key of FRONTMATTER_ORDER) {
		if (key in fm) ordered[key] = fm[key];
	}
	for (const [key, value] of Object.entries(fm)) {
		if (!(key in ordered)) ordered[key] = value;
	}
	return ordered;
}

function stringifyFrontmatter(fm: Frontmatter): string {
	return yaml
		.dump(fm, {
			lineWidth: -1,
			noRefs: true,
			quotingType: '"',
			forceQuotes: false,
		})
		.trimEnd();
}

function buildFileContent(frontmatter: Frontmatter, body: string): string {
	const normalizedBody = body.replace(/^\n+/, "");
	return `---\n${stringifyFrontmatter(orderedFrontmatter(frontmatter))}\n---\n\n${normalizedBody}`;
}

// ─── Filesystem sync ─────────────────────────────────────────────────────────

function listGeneratedMdFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name);
}

interface SyncReport {
	missing: string[];
	stale: string[];
	extraneous: string[];
}

function diffDir(dir: string, expected: Map<string, string>): SyncReport {
	const report: SyncReport = { missing: [], stale: [], extraneous: [] };
	const existing = new Set(listGeneratedMdFiles(dir));
	for (const [fileName, content] of expected) {
		const filePath = join(dir, fileName);
		if (!existsSync(filePath)) {
			report.missing.push(fileName);
		} else if (readFileSync(filePath, "utf8") !== content) {
			report.stale.push(fileName);
		}
	}
	for (const fileName of existing) {
		if (!expected.has(fileName)) {
			report.extraneous.push(fileName);
		}
	}
	return report;
}

function writeDir(dir: string, expected: Map<string, string>): { written: number; removed: string[] } {
	const existing = new Set(listGeneratedMdFiles(dir));
	mkdirSync(dir, { recursive: true });
	for (const [fileName, content] of expected) {
		writeFileSync(join(dir, fileName), content);
	}
	const removed: string[] = [];
	for (const fileName of existing) {
		if (!expected.has(fileName)) {
			rmSync(join(dir, fileName));
			removed.push(fileName);
		}
	}
	return { written: expected.size, removed };
}

// ─── Embedded TS rendering ───────────────────────────────────────────────────

function escapeTemplateLiteral(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function renderDefinition(def: AgentDefinition): string {
	return `\t{\n\t\tname: ${JSON.stringify(def.name)},\n\t\tversion: ${JSON.stringify(def.version)},\n\t\tcontent: \`${escapeTemplateLiteral(def.content)}\`,\n\t},`;
}

function toDefinitions(
	sources: Map<string, AgentSource>,
	registry: ModelRegistry,
	platform: "pi" | "opencode",
	version: string,
): AgentDefinition[] {
	const defs: AgentDefinition[] = [];
	for (const src of sources.values()) {
		const t = transformForPlatform(src, registry, platform, version);
		defs.push({ name: t.definitionName, version, content: t.content });
	}
	return defs;
}

function renderModule(version: string, piDefs: AgentDefinition[], opencodeDefs: AgentDefinition[]): string {
	const piItems = [...piBuiltinOverrides(version), ...piDefs].map(renderDefinition).join("\n\n");
	const opencodeItems = opencodeDefs.map(renderDefinition).join("\n\n");

	return `// AUTO-GENERATED. Do not edit. Run: pnpm run generate:agents
// Source: agents-src/*.md (model-neutral) + model-registry.json → agents/ (claude-code), agents-pi/, agents-opencode/, and this file.

import type { AgentDefinition } from "./agent-definitions.js";

export const GROUNDWORK_VERSION = ${JSON.stringify(version)};

export const EMBEDDED_AGENTS_PI: AgentDefinition[] = [
${piItems}
];

export const EMBEDDED_AGENTS_OPENCODE: AgentDefinition[] = [
${opencodeItems}
];

// Backward-compat alias (pi is the primary platform).
export const EMBEDDED_AGENTS: AgentDefinition[] = EMBEDDED_AGENTS_PI;
`;
}

// ─── CLAUDE.md model-table injection ─────────────────────────────────────────

const CLAUDE_MD_PATH = join(rootDir, "CLAUDE.md");
const AGENT_MODELS_BEGIN = "<!-- AGENT-MODELS:BEGIN";
const AGENT_MODELS_END = "<!-- AGENT-MODELS:END -->";

/** Build the markdown table fragment from registry claude-code models. */
function buildModelTable(registry: ModelRegistry): string {
	const rows = Object.entries(registry.agents)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, entry]) => {
			const model = entry["claude-code"] ?? "—";
			return `| ${name} | ${model} |`;
		});
	return ["| Agent | Model |", "| --- | --- |", ...rows].join("\n") + "\n";
}

/**
 * Inject `table` strictly between the AGENT-MODELS:BEGIN … END markers in `filePath`.
 * Preserves marker lines and ALL content outside the markers byte-for-byte.
 * Throws a loud error if either marker is missing.
 * Idempotent: a second call with the same table produces no change.
 */
function injectModelTable(filePath: string, table: string): void {
	const original = readFileSync(filePath, "utf8");

	const beginIdx = original.indexOf(AGENT_MODELS_BEGIN);
	if (beginIdx === -1) {
		throw new Error(
			`AGENT-MODELS:BEGIN marker not found in ${filePath}. ` +
				"Run S6 first or manually insert the marker pair.",
		);
	}
	const endIdx = original.indexOf(AGENT_MODELS_END);
	if (endIdx === -1) {
		throw new Error(
			`AGENT-MODELS:END marker not found in ${filePath}. ` +
				"The marker file may be corrupt — restore it from git.",
		);
	}
	if (endIdx <= beginIdx) {
		throw new Error(`AGENT-MODELS:END appears before AGENT-MODELS:BEGIN in ${filePath}.`);
	}

	// Advance past the BEGIN line (include its newline).
	const beginLineEnd = original.indexOf("\n", beginIdx);
	if (beginLineEnd === -1) {
		throw new Error(`AGENT-MODELS:BEGIN line has no trailing newline in ${filePath}.`);
	}

	const before = original.slice(0, beginLineEnd + 1); // up to and including \n after BEGIN line
	const after = original.slice(endIdx); // from END marker to EOF

	const injected = before + table + after;

	if (injected !== original) {
		writeFileSync(filePath, injected);
	}
	// If identical, no write → true idempotency (mtime unchanged).
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
	const version = readPackageVersion();
	const registry = loadRegistry();
	const sources = loadAgentSources();
	validateRegistry(sources, registry);

	const drift: string[] = [];

	for (const platform of PLATFORMS) {
		// claude-code output goes to agents/ (what Claude Code reads directly).
		// pi/opencode outputs go to agents-<platform>/.
		const dir = platform === "claude-code" ? join(rootDir, "agents") : join(rootDir, `agents-${platform}`);
		const dirLabel = platform === "claude-code" ? "agents" : `agents-${platform}`;
		const expected = generatePlatformFiles(sources, registry, platform, version);

		if (shouldCheck) {
			const report = diffDir(dir, expected);
			const problems = [
				...report.missing.map((f) => `${f} (missing)`),
				...report.stale.map((f) => `${f} (stale)`),
				...report.extraneous.map((f) => `${f} (extraneous)`),
			];
			if (problems.length > 0) {
				drift.push(`${dirLabel}/: ${problems.join(", ")}`);
			}
		} else {
			const result = writeDir(dir, expected);
			console.log(`${dirLabel}/: wrote ${result.written} files`);
			if (result.removed.length > 0) {
				console.log(`  removed stale: ${result.removed.join(", ")}`);
			}
		}
	}

	const piDefs = toDefinitions(sources, registry, "pi", version);
	const opencodeDefs = toDefinitions(sources, registry, "opencode", version);
	const rendered = renderModule(version, piDefs, opencodeDefs);

	// ── CLAUDE.md model-table check / inject ──────────────────────────────────
	const table = buildModelTable(registry);
	if (shouldCheck) {
		// Verify the table region in CLAUDE.md matches what the registry would generate.
		const claudeMd = readFileSync(CLAUDE_MD_PATH, "utf8");
		const beginIdx = claudeMd.indexOf(AGENT_MODELS_BEGIN);
		const endIdx = claudeMd.indexOf(AGENT_MODELS_END);
		if (beginIdx === -1 || endIdx === -1) {
			drift.push(`CLAUDE.md: AGENT-MODELS markers missing`);
		} else {
			const beginLineEnd = claudeMd.indexOf("\n", beginIdx);
			const currentContent = claudeMd.slice(beginLineEnd + 1, endIdx);
			if (currentContent !== table) {
				drift.push(`CLAUDE.md: model table (stale)`);
			}
		}
	}

	if (shouldCheck) {
		if (!existsSync(generatedTsPath)) {
			drift.push(`${generatedTsPath} (missing)`);
		} else if (readFileSync(generatedTsPath, "utf8") !== rendered) {
			drift.push(`${generatedTsPath} (stale)`);
		}
		if (drift.length > 0) {
			console.error("Agent definition drift detected:\n  - " + drift.join("\n  - "));
			console.error("\nRun `pnpm run generate:agents` to regenerate.");
			process.exitCode = 1;
		} else {
			console.log("All agent definitions in sync.");
		}
		return;
	}

	injectModelTable(CLAUDE_MD_PATH, table);
	console.log(`CLAUDE.md: model table injected`);

	mkdirSync(dirname(generatedTsPath), { recursive: true });
	writeFileSync(generatedTsPath, rendered);
	console.log(
		`${generatedTsPath}: regenerated (pi=${piDefs.length + 2} incl. built-in overrides, opencode=${opencodeDefs.length})`,
	);
}

main();
