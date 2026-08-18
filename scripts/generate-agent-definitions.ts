import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// ─── Types ───────────────────────────────────────────────────────────────────

type Frontmatter = Record<string, unknown>;

interface AgentSource {
	name: string;
	frontmatter: Frontmatter;
	body: string;
}

export interface PlatformModelEntry {
	/** Claude Code model alias or explicit claude-* id (required for every agent). */
	"claude-code"?: string;
	/** Optional Codex routing model for CODEX_MODEL_GUIDANCE_ROLES. */
	codex?: string;
	[key: string]: string | undefined;
}

export interface ModelRegistry {
	agents: Record<string, PlatformModelEntry>;
	/** Per-platform disable lists. Pi has no registry models; do not use disabled.pi. */
	disabled?: Record<string, string[] | undefined>;
	/** Per-platform name aliases. Pi aliases are not supported (no pi registry column). */
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

const PLATFORMS = ["pi", "claude-code"] as const;
type Platform = (typeof PLATFORMS)[number];

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const sourceAgentsDir = join(rootDir, "agents-src");
const registryPath = join(rootDir, "model-registry.json");
const packageJsonPath = join(rootDir, "package.json");
const generatedTsPath = join(rootDir, "src", "lib", "agent-definitions.generated.ts");
const codexSkillsSourceDir = join(rootDir, "skills", "groundwork");
const codexSkillsDir = join(rootDir, "skills");

const shouldCheck = process.argv.includes("--check");
const shouldPrintCodexModelGuidance = process.argv.includes("--print-codex-model-guidance");

// Codex consumes skills rather than agent-definition files. These mappings are
// deterministic model guidance for Codex-capable specialists and must not be
// added to PLATFORMS: doing so would incorrectly emit an agents-codex/ tree.
const CODEX_MODEL_GUIDANCE_ROLES = ["explore", "general-purpose"] as const;
const CODEX_MODEL_GUIDANCE_PATH = join("use-groundwork", "reference", "agent-selection.md");

// Frontmatter fields that belong ONLY to the pi platform — NOT Claude Code.
// The model-neutral source (agents-src/*.md) carries only name, description, and
// disallowedTools (a CC-only enforcement field). These platform-only fields are
// re-injected here so the generated agents-pi/ tree is behaviorally unchanged.
// agents-pi is model-neutral: no `model:` frontmatter (session inherit).
// Agents not listed get DEFAULT_PLATFORM_FRONTMATTER.
// Claude Code output (agents/) is handled by transformForClaudeCode() — no injection.
const RO_TOOLS = "read, bash, grep, find, ls";
const RW_TOOLS = "read, bash, edit, write, grep, find, ls";
const PLATFORM_ONLY_FRONTMATTER: Record<string, Frontmatter> = {
	advisor: { prompt_mode: "replace", tools: RO_TOOLS },
	designer: { prompt_mode: "replace", tools: RW_TOOLS },
	explore: { prompt_mode: "replace", tools: RO_TOOLS },
	"general-purpose": { prompt_mode: "replace", thinking: "low", tools: RW_TOOLS },
	"git-master": { prompt_mode: "replace", tools: RO_TOOLS, permission: { task: { "*": "deny" } } },
	orchestrator: { prompt_mode: "append", thinking: "minimal", mode: "primary", tools: RO_TOOLS },
	planner: { prompt_mode: "replace", tools: RO_TOOLS },
	"junior-orchestrator": {
		prompt_mode: "replace",
		tools: RW_TOOLS,
		permission: {
			task: {
				"*": "deny",
				"general-purpose": "allow",
				explore: "allow",
				advisor: "allow",
				designer: "allow",
				"test-engineer": "allow",
				qa: "allow",
			},
		},
	},
	"test-engineer": { prompt_mode: "replace", tools: RW_TOOLS, permission: { task: { "*": "deny", explore: "allow" } } },
	qa: { prompt_mode: "replace", tools: RW_TOOLS },
	researcher: { prompt_mode: "replace", tools: RO_TOOLS },
};
const DEFAULT_PLATFORM_FRONTMATTER: Frontmatter = { prompt_mode: "replace", tools: RW_TOOLS };

// Preferred frontmatter key order for generated output.
const FRONTMATTER_ORDER = [
	"name",
	"description",
	"model",
	"disallowedTools",
	"skills",
	"memory",
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
// they appear only in the pi branch of the embedded TS (agents-pi is model-neutral).
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
		const cc = registry.agents[name]?.["claude-code"];
		if (typeof cc !== "string" || cc.length === 0) {
			throw new Error(`Registry missing claude-code model for agent "${name}"`);
		}
	}
	for (const name of registryNames) {
		if (!sourceNames.has(name)) {
			throw new Error(`Registry agent "${name}" has no source file in agents-src/`);
		}
	}

	for (const name of CODEX_MODEL_GUIDANCE_ROLES) {
		const model = registry.agents[name]?.codex;
		if (typeof model !== "string" || model.length === 0) {
			throw new Error(`Registry missing codex model for routing role "${name}"`);
		}
	}
}

export function renderCodexModelGuidance(registry: ModelRegistry): string {
	const rows = CODEX_MODEL_GUIDANCE_ROLES.map(
		(name) => `| ${name} | ${registry.agents[name].codex} |`,
	);
	return [
		"<!-- CODEX-MODEL-ROUTING:BEGIN -->",
		"## Codex model routing",
		"",
		"Use these registry-backed assignments when Codex exposes model-selectable delegation.",
		"",
		"| Agent | Model |",
		"| --- | --- |",
		...rows,
		"<!-- CODEX-MODEL-ROUTING:END -->",
		"",
	].join("\n");
}

export function applyCodexModelGuidance(
	relativePath: string,
	content: string,
	registry: ModelRegistry,
): string {
	if (relativePath !== CODEX_MODEL_GUIDANCE_PATH) return content;
	return `${content.trimEnd()}\n\n${renderCodexModelGuidance(registry)}`;
}

// ─── Per-platform transformation (pi / agents-pi — model-neutral) ────────────
// OMP/pi agents never read model-registry for models. Roster is agents-pi via
// PI_SUBAGENTS_EXTRA_AGENTS_DIR; each agent inherits the session model.

function transformForPi(src: AgentSource, version: string): TransformedAgent {
	const fm: Frontmatter = { ...src.frontmatter };

	// `disallowedTools`, `skills`, and `memory` are Claude-Code-only frontmatter fields;
	// pi expresses tool restrictions via `permission` and has no equivalent for
	// skills/memory, so drop all three from its output.
	delete fm.disallowedTools;
	delete fm.skills;
	delete fm.memory;

	// Re-inject pi/opencode-only frontmatter stripped from the model-neutral source.
	const platformOnly = PLATFORM_ONLY_FRONTMATTER[src.name] ?? DEFAULT_PLATFORM_FRONTMATTER;
	for (const [key, value] of Object.entries(platformOnly)) {
		fm[key] = value;
	}

	// Always omit model — session inherit for OMP/pi (no pi registry column).
	delete fm.model;

	fm.managed_by = "groundwork";
	fm.groundwork_version = version;

	// Normalise tool-call casing: Claude Code surfaces use `Task(` but pi/Codex
	// uses lowercase `task(`. Partials are authored with `Task(` (CC-canonical);
	// replace here so pi-generated agents carry the correct lowercase form.
	const body = src.body.replaceAll("Task(", "task(");

	return {
		outputName: `${src.name}.md`,
		definitionName: src.name,
		content: buildFileContent(fm, body),
	};
}

// ─── Claude Code–specific transformation ─────────────────────────────────────

// Valid Claude Code model aliases, or an explicit claude-* model ID (e.g. "claude-sonnet-4-6").
// "inherit" is NOT valid for CC subagent definitions.
const CLAUDE_CODE_VALID_MODELS = new Set(["opus", "sonnet", "haiku"]);
const CLAUDE_CODE_EXPLICIT_MODEL_ID = /^claude-[a-z0-9-]+$/;

function isValidClaudeCodeModel(model: string): boolean {
	return CLAUDE_CODE_VALID_MODELS.has(model) || CLAUDE_CODE_EXPLICIT_MODEL_ID.test(model);
}

function transformForClaudeCode(
	src: AgentSource,
	registry: ModelRegistry,
	version: string,
): TransformedAgent {
	const model = registry.agents[src.name]?.["claude-code"];
	if (model === undefined) {
		throw new Error(`Registry missing claude-code model for agent "${src.name}"`);
	}
	if (!isValidClaudeCodeModel(model)) {
		throw new Error(
			`Registry claude-code model for "${src.name}" is "${model}" — must be one of: opus, sonnet, haiku, or an explicit claude-* model ID (never "inherit")`,
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
	if (src.frontmatter.skills !== undefined) {
		fm.skills = src.frontmatter.skills;
	}
	if (src.frontmatter.memory !== undefined) {
		fm.memory = src.frontmatter.memory;
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
			// pi: model-neutral transform (no registry models)
			const t = transformForPi(src, version);
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

// Codex requires each skill to be a direct child of the plugin's `skills/`
// directory. The shared Kimi tree keeps the same skills under
// `skills/groundwork/`, so materialize direct Codex-facing copies from that
// source alongside the canonical nested tree.
/**
 * Resolve a Codex overlay path for a given skill file.
 *
 * Codex skill files are emitted as flattened copies under `skills/`. To keep
 * Claude/Kimi/OpenCode source behavior untouched while producing honest Codex
 * output, a skill may carry a `.codex-overlays/` directory that mirrors its own
 * subtree: any file present there overrides the canonical source for the Codex
 * projection only. Claude/Kimi/OpenCode never read `.codex-overlays/`.
 *
 * `relativePath` is relative to `codexSkillsSourceDir` (e.g.
 * "use-groundwork/SKILL.md"); the first segment is the skill name. Returns an
 * empty string when no skill-dir prefix exists (no overlay possible).
 */
function codexOverlayPath(relativePath: string): string {
	const posix = relativePath.split(sep).join("/");
	const slashIdx = posix.indexOf("/");
	if (slashIdx === -1) return "";
	const skillDir = posix.slice(0, slashIdx);
	const rest = posix.slice(slashIdx + 1);
	return join(codexSkillsSourceDir, skillDir, ".codex-overlays", ...rest.split("/"));
}

function codexSkillFiles(registry: ModelRegistry): Map<string, string> {
	const files = new Map<string, string>();
	function normalizeSkill(source: string, fileName: string): string {
		if (!source.startsWith("---\n")) throw new Error(`${fileName}: skill must start with YAML frontmatter`);
		const end = source.indexOf("\n---", 4);
		if (end === -1) throw new Error(`${fileName}: skill frontmatter is not closed`);
		const rawFrontmatter = source.slice(4, end).replace(
			/^description:\s*(.+)$/m,
			(_match, value: string) => `description: ${JSON.stringify(value)}`,
		);
		const frontmatter = yaml.load(rawFrontmatter);
		if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
			throw new Error(`${fileName}: skill frontmatter must be an object`);
		}
		const normalized = { ...(frontmatter as Frontmatter) };
		if (normalized["disable-model-invocation"] === true) normalized["disable-model-invocation"] = false;
		return `---\n${stringifyFrontmatter(normalized)}\n---${source.slice(end + 4)}`;
	}
	function visit(sourceDir: string, relativeDir: string): void {
		for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
			const sourcePath = join(sourceDir, entry.name);
			const relativePath = join(relativeDir, entry.name);
			if (entry.isDirectory()) {
				// Overlay dir is a Codex-projection source, not a generated skill tree node.
				if (entry.name === ".codex-overlays") continue;
				visit(sourcePath, relativePath);
				continue;
			}
			if (!entry.isFile()) continue;
			// Overlay-first: a `.codex-overlays/` mirror file (if present) overrides the
			// canonical source for the Codex projection only.
			const overlayPath = codexOverlayPath(relativePath);
			const raw = existsSync(overlayPath)
				? readFileSync(overlayPath, "utf8")
				: readFileSync(sourcePath, "utf8");
			const normalized = entry.name === "SKILL.md" ? normalizeSkill(raw, relativePath) : raw;
			files.set(relativePath, applyCodexModelGuidance(relativePath, normalized, registry));
		}
	}
	for (const entry of readdirSync(codexSkillsSourceDir, { withFileTypes: true })) {
		if (entry.isDirectory()) visit(join(codexSkillsSourceDir, entry.name), entry.name);
	}
	return files;
}

function listRelativeFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files: string[] = [];
	function visit(currentDir: string, relativeDir: string): void {
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			const currentPath = join(currentDir, entry.name);
			const relativePath = join(relativeDir, entry.name);
			if (entry.isDirectory()) visit(currentPath, relativePath);
			else if (entry.isFile()) files.push(relativePath);
		}
	}
	visit(dir, "");
	return files;
}

function diffCodexSkills(expected: Map<string, string>): string[] {
	const problems: string[] = [];
	const existing = new Set(listRelativeFiles(codexSkillsDir).filter((path) => !path.startsWith("groundwork/")));
	for (const [relativePath, content] of expected) {
		const filePath = join(codexSkillsDir, relativePath);
		if (!existsSync(filePath)) problems.push(`${relativePath} (missing)`);
		else if (readFileSync(filePath, "utf8") !== content) problems.push(`${relativePath} (stale)`);
	}
	for (const relativePath of existing) {
		if (!expected.has(relativePath)) problems.push(`${relativePath} (extraneous)`);
	}
	return problems;
}

function writeCodexSkills(expected: Map<string, string>): void {
	const existing = listRelativeFiles(codexSkillsDir).filter((path) => !path.startsWith("groundwork/"));
	for (const [relativePath, content] of expected) {
		const filePath = join(codexSkillsDir, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content);
	}
	for (const relativePath of existing) {
		if (!expected.has(relativePath)) rmSync(join(codexSkillsDir, relativePath));
	}
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
	_registry: ModelRegistry,
	_platform: "pi",
	version: string,
): AgentDefinition[] {
	const defs: AgentDefinition[] = [];
	for (const src of sources.values()) {
		const t = transformForPi(src, version);
		defs.push({ name: t.definitionName, version, content: t.content });
	}
	return defs;
}

function renderModule(version: string, piDefs: AgentDefinition[]): string {
	const piItems = [...piBuiltinOverrides(version), ...piDefs].map(renderDefinition).join("\n\n");

	return `// AUTO-GENERATED. Do not edit. Run: pnpm run generate:agents
// Source: agents-src/*.md (model-neutral) + model-registry.json (claude-code/codex only)
// → agents/ (claude-code), agents-pi/ (model-neutral, session inherit), and this file.

import type { AgentDefinition } from "./agent-definitions.js";

export const GROUNDWORK_VERSION = ${JSON.stringify(version)};

export const EMBEDDED_AGENTS_PI: AgentDefinition[] = [
${piItems}
];

// Backward-compat alias (pi is the primary platform).
export const EMBEDDED_AGENTS: AgentDefinition[] = EMBEDDED_AGENTS_PI;
`;
}

// ─── CLAUDE.md model-table injection ─────────────────────────────────────────

const CLAUDE_MD_PATH = join(rootDir, "CLAUDE.md");
const AGENT_MODELS_BEGIN = "<!-- AGENT-MODELS:BEGIN";
const AGENT_MODELS_END = "<!-- AGENT-MODELS:END -->";

// ─── Rule-partial injection ───────────────────────────────────────────────────

const PARTIAL_DIR = join(rootDir, "partials");

/** A single canonical partial → target-file injection entry. */
export interface PartialEntry {
	/** Filename stem under partials/ (no .md extension). */
	partial: string;
	/** HTML comment begin marker, e.g. "<!-- FANOUT-TARGETS:BEGIN -->". */
	beginMarker: string;
	/** HTML comment end marker, e.g. "<!-- FANOUT-TARGETS:END -->". */
	endMarker: string;
	/** Absolute path of the target file to inject into. */
	targetPath: string;
}

/**
 * Registry of all rule-partial → target-file injections.
 * Adding a new partial is a data change here — no new bespoke code required.
 */
export const RULE_PARTIAL_REGISTRY: readonly PartialEntry[] = [
	{
		partial: "fan-out-targets",
		beginMarker: "<!-- FANOUT-TARGETS:BEGIN -->",
		endMarker: "<!-- FANOUT-TARGETS:END -->",
		targetPath: join(sourceAgentsDir, "junior-orchestrator.md"),
	},
	{
		partial: "one-message-parallel",
		beginMarker: "<!-- ONE-MESSAGE-PARALLEL:BEGIN -->",
		endMarker: "<!-- ONE-MESSAGE-PARALLEL:END -->",
		targetPath: join(sourceAgentsDir, "junior-orchestrator.md"),
	},
	{
		partial: "vertical-slice-gate",
		beginMarker: "<!-- VERTICAL-SLICE-GATE:BEGIN -->",
		endMarker: "<!-- VERTICAL-SLICE-GATE:END -->",
		targetPath: join(sourceAgentsDir, "junior-orchestrator.md"),
	},
	{
		partial: "context-isolation-template",
		beginMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->",
		endMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->",
		targetPath: join(sourceAgentsDir, "junior-orchestrator.md"),
	},
	{
		partial: "fan-out-targets",
		beginMarker: "<!-- FANOUT-TARGETS:BEGIN -->",
		endMarker: "<!-- FANOUT-TARGETS:END -->",
		targetPath: join(sourceAgentsDir, "orchestrator.md"),
	},
	{
		partial: "one-message-parallel",
		beginMarker: "<!-- ONE-MESSAGE-PARALLEL:BEGIN -->",
		endMarker: "<!-- ONE-MESSAGE-PARALLEL:END -->",
		targetPath: join(sourceAgentsDir, "orchestrator.md"),
	},
	{
		partial: "context-isolation-template",
		beginMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->",
		endMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->",
		targetPath: CLAUDE_MD_PATH,
	},
	{
		partial: "context-isolation-template",
		beginMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->",
		endMarker: "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->",
		targetPath: join(codexSkillsSourceDir, "use-groundwork", "reference", "task-scoping.md"),
	},
	{
		partial: "vertical-slice-gate",
		beginMarker: "<!-- VERTICAL-SLICE-GATE:BEGIN -->",
		endMarker: "<!-- VERTICAL-SLICE-GATE:END -->",
		targetPath: join(codexSkillsSourceDir, "vertical-slice", "SKILL.md"),
	},
];

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

/** Read a named rule partial from the canonical partials directory. */
export function buildRulePartial(name: string): string {
	return readFileSync(join(PARTIAL_DIR, `${name}.md`), "utf8");
}

/**
 * Inject `content` strictly between `beginMarker` … `endMarker` in `filePath`.
 * Preserves marker lines and ALL content outside the markers byte-for-byte.
 * Throws a loud error if either marker is missing or misordered.
 * Idempotent: a second call with the same content produces no change.
 */
export function injectRulePartial(
	filePath: string,
	beginMarker: string,
	endMarker: string,
	content: string,
): void {
	const original = readFileSync(filePath, "utf8");

	const beginIdx = original.indexOf(beginMarker);
	if (beginIdx === -1) {
		throw new Error(
			`${beginMarker} not found in ${filePath}. Add the marker pair before running.`,
		);
	}
	const endIdx = original.indexOf(endMarker);
	if (endIdx === -1) {
		throw new Error(
			`${endMarker} not found in ${filePath}. The marker file may be corrupt — restore it from git.`,
		);
	}
	if (endIdx <= beginIdx) {
		throw new Error(`${endMarker} appears before ${beginMarker} in ${filePath}.`);
	}

	const beginLineEnd = original.indexOf("\n", beginIdx);
	if (beginLineEnd === -1) {
		throw new Error(`${beginMarker} line has no trailing newline in ${filePath}.`);
	}

	const before = original.slice(0, beginLineEnd + 1); // up to and including \n after BEGIN line
	const after = original.slice(endIdx); // from END marker to EOF

	const injected = before + content + after;

	if (injected !== original) {
		writeFileSync(filePath, injected);
	}
	// If identical, no write → true idempotency (mtime unchanged).
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
	const version = readPackageVersion();
	const registry = loadRegistry();

	// ── Rule-partial injections: all run BEFORE loadAgentSources() ───────────────
	// Must precede loadAgentSources() so the platform generation loop picks up
	// the canonical content from each partial.
	if (!shouldCheck) {
		for (const entry of RULE_PARTIAL_REGISTRY) {
			injectRulePartial(
				entry.targetPath,
				entry.beginMarker,
				entry.endMarker,
				buildRulePartial(entry.partial),
			);
		}
	}

	const sources = loadAgentSources();
	validateRegistry(sources, registry);

	if (shouldPrintCodexModelGuidance) {
		process.stdout.write(renderCodexModelGuidance(registry));
		return;
	}

	const drift: string[] = [];
	const expectedCodexSkills = codexSkillFiles(registry);
	if (shouldCheck) {
		const problems = diffCodexSkills(expectedCodexSkills);
		if (problems.length > 0) drift.push(`codex/skills/: ${problems.join(", ")}`);
	} else {
		writeCodexSkills(expectedCodexSkills);
		console.log(`skills/: synchronized ${expectedCodexSkills.size} Codex skill files`);
	}

	for (const platform of PLATFORMS) {
		// claude-code output goes to agents/ (what Claude Code reads directly).
		// pi output goes to agents-pi/.
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
	const rendered = renderModule(version, piDefs);

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

	// ── Rule-partial drift checks ─────────────────────────────────────────────
	// (injections ran early, before loadAgentSources; these checks are --check-only)
	if (shouldCheck) {
		for (const entry of RULE_PARTIAL_REGISTRY) {
			const content = buildRulePartial(entry.partial);
			const src = readFileSync(entry.targetPath, "utf8");
			const relPath = relative(rootDir, entry.targetPath);
			const beginIdx = src.indexOf(entry.beginMarker);
			const endIdx = src.indexOf(entry.endMarker);
			if (beginIdx === -1 || endIdx === -1) {
				drift.push(`${relPath}: ${entry.partial} markers missing`);
			} else {
				const beginLineEnd = src.indexOf("\n", beginIdx);
				const currentContent = src.slice(beginLineEnd + 1, endIdx);
				if (currentContent !== content) {
					drift.push(`${relPath}: ${entry.partial} partial (stale)`);
				}
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

	for (const entry of RULE_PARTIAL_REGISTRY) {
		const relPath = relative(rootDir, entry.targetPath);
		console.log(`${relPath}: ${entry.partial} partial injected`);
	}

	injectModelTable(CLAUDE_MD_PATH, table);
	console.log(`CLAUDE.md: model table injected`);

	mkdirSync(dirname(generatedTsPath), { recursive: true });
	writeFileSync(generatedTsPath, rendered);
	console.log(
		`${generatedTsPath}: regenerated (pi=${piDefs.length + 2} incl. built-in overrides)`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main();
}
