/**
 * host-seam-contract.test.ts
 *
 * Mechanical enforcement of the multi-host generation contract documented in
 * doc/host-seam.md. Three invariants:
 *
 * 1. Every platform column key present in model-registry.json is documented in
 *    doc/host-seam.md. Adding a column without updating the doc fails here.
 *
 * 2. Every agent in agents-src/ has a corresponding generated file in agents/
 *    (claude-code tree) and agents-pi/ (pi tree).
 *
 * 3. The PLATFORMS constant extracted from the generator source matches the set
 *    of agent output directories that actually exist on disk.
 *
 * RED→GREEN proof: add a fake column to model-registry.json → invariant 1 fails.
 * Revert → green again.
 */

import { describe, test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson(relPath: string): unknown {
	return JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));
}

function readText(relPath: string): string {
	return readFileSync(join(ROOT, relPath), "utf8");
}

function mdFiles(relDir: string): string[] {
	const dir = join(ROOT, relDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith(".md"))
		.map((e) => e.name);
}

/**
 * Extract the PLATFORMS array literal from generate-agent-definitions.ts.
 * Returns the string values (e.g. ["pi", "claude-code"]).
 */
function extractPlatformsFromGenerator(): string[] {
	const src = readText("scripts/generate-agent-definitions.ts");
	// Matches: const PLATFORMS = ["pi", "claude-code"] as const;
	const match = src.match(/const PLATFORMS\s*=\s*\[([^\]]+)\]/);
	if (!match) throw new Error("Could not locate PLATFORMS constant in generate-agent-definitions.ts");
	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The generator maps platform names to output directories:
 *   claude-code  →  agents/
 *   <anything else>  →  agents-<platform>/
 */
function platformToOutputDir(platform: string): string {
	return platform === "claude-code" ? "agents" : `agents-${platform}`;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

interface ModelRegistry {
	agents: Record<string, Record<string, string>>;
}

const registry = readJson("model-registry.json") as ModelRegistry;

/**
 * All unique platform column keys that appear across any agent entry in
 * model-registry.json (e.g. "claude-code", "codex"). These are the surfaces
 * that doc/host-seam.md must enumerate.
 */
function registryColumnKeys(): Set<string> {
	const keys = new Set<string>();
	for (const entry of Object.values(registry.agents)) {
		for (const key of Object.keys(entry)) {
			keys.add(key);
		}
	}
	return keys;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("host-seam contract", () => {
	test("every registry platform column is documented in doc/host-seam.md", () => {
		const doc = readText("doc/host-seam.md");
		const columns = registryColumnKeys();

		for (const column of columns) {
			expect(
				doc,
				`doc/host-seam.md must document registry column "${column}" — add it to the platform-columns section`,
			).toContain(column);
		}
	});

	test("PLATFORMS in generator matches existing output directories", () => {
		const platforms = extractPlatformsFromGenerator();

		// Every declared platform must have an output directory on disk.
		for (const platform of platforms) {
			const dir = platformToOutputDir(platform);
			expect(
				existsSync(join(ROOT, dir)),
				`Output directory "${dir}" declared for platform "${platform}" does not exist — run pnpm run generate:agents`,
			).toBe(true);
		}

		// Every agents-<x>/ directory must have a corresponding PLATFORMS entry.
		// We look for top-level directories named "agents" or "agents-*", but
		// exclude "agents-src" — that is the model-neutral source tree, not an output.
		const topLevel = readdirSync(ROOT, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.filter((e) => (e.name === "agents" || e.name.startsWith("agents-")) && e.name !== "agents-src")
			.map((e) => e.name);

		const declaredDirs = new Set(platforms.map(platformToOutputDir));
		for (const dir of topLevel) {
			expect(
				declaredDirs,
				`Directory "${dir}" exists but has no corresponding entry in PLATFORMS — add the platform to the generator or remove the directory`,
			).toContain(dir);
		}
	});

	test("every agents-src agent has a generated file in agents/ (claude-code)", () => {
		const srcAgents = mdFiles("agents-src");
		expect(srcAgents.length, "agents-src/ must contain at least one agent file").toBeGreaterThan(0);

		for (const file of srcAgents) {
			expect(
				existsSync(join(ROOT, "agents", file)),
				`agents-src/${file} has no generated counterpart in agents/${file} — run pnpm run generate:agents`,
			).toBe(true);
		}
	});

	test("every agents-src agent has a generated file in agents-pi/ (pi)", () => {
		const srcAgents = mdFiles("agents-src");
		expect(srcAgents.length, "agents-src/ must contain at least one agent file").toBeGreaterThan(0);

		for (const file of srcAgents) {
			expect(
				existsSync(join(ROOT, "agents-pi", file)),
				`agents-src/${file} has no generated counterpart in agents-pi/${file} — run pnpm run generate:agents`,
			).toBe(true);
		}
	});

	test("doc/host-seam.md mentions both generator-declared platforms", () => {
		const platforms = extractPlatformsFromGenerator();
		const doc = readText("doc/host-seam.md");

		for (const platform of platforms) {
			expect(
				doc,
				`doc/host-seam.md must mention platform "${platform}" from the PLATFORMS constant`,
			).toContain(platform);
		}
	});
});
