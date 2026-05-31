// ─── Runtime Agent Installation ────────────────────────────────────────────
// Writes embedded agent definitions to .pi/agents/*.md on session start.
// Version tracking ensures plugin updates propagate without overwriting
// user customizations.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMBEDDED_AGENTS, GROUNDWORK_VERSION } from "./agent-definitions.js";
import { extractAndStripFrontmatter } from "./skills.js";

interface Manifest {
	version: string;
	agents: Record<string, string>;
}

const MANIFEST_FILE = ".groundwork-manifest.json";

function readManifest(agentsDir: string): Manifest {
	const path = join(agentsDir, MANIFEST_FILE);
	if (!existsSync(path)) return { version: "0.0.0", agents: {} };
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as Manifest;
	} catch {
		return { version: "0.0.0", agents: {} };
	}
}

function writeManifest(agentsDir: string, manifest: Manifest): void {
	const path = join(agentsDir, MANIFEST_FILE);
	writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function shouldWrite(path: string, pluginVersion: string): boolean {
	if (!existsSync(path)) return true;

	try {
		const content = readFileSync(path, "utf8");
		const { frontmatter } = extractAndStripFrontmatter(content);

		// Only update files that are managed by us
		if (frontmatter.managed_by !== "groundwork") return false;

		// Compare version
		const fileVersion = String(frontmatter.groundwork_version ?? "0.0.0");
		const [fMajor, fMinor, fPatch] = fileVersion.split(".").map(Number);
		const [pMajor, pMinor, pPatch] = pluginVersion.split(".").map(Number);

		if (pMajor > fMajor) return true;
		if (pMajor === fMajor && pMinor > fMinor) return true;
		if (pMajor === fMajor && pMinor === fMinor && pPatch > fPatch) return true;
		return false;
	} catch {
		return false;
	}
}

/**
 * Ensure all embedded agent definitions are installed in .pi/agents/.
 * Called from the session_start event handler.
 *
 * Only writes files that:
 * - Don't exist yet, OR
 * - Have managed_by: groundwork and an older version
 *
 * User customizations are preserved if they remove the managed_by marker.
 */
export function ensureAgentsInstalled(cwd: string): void {
	const agentsDir = join(cwd, ".pi", "agents");
	mkdirSync(agentsDir, { recursive: true });

	const manifest = readManifest(agentsDir);
	let dirty = false;

	for (const agent of EMBEDDED_AGENTS) {
		const filePath = join(agentsDir, `${agent.name}.md`);
		if (shouldWrite(filePath, agent.version)) {
			writeFileSync(filePath, agent.content, "utf8");
			manifest.agents[agent.name] = agent.version;
			dirty = true;
		}
	}

	if (dirty || manifest.version !== GROUNDWORK_VERSION) {
		manifest.version = GROUNDWORK_VERSION;
		writeManifest(agentsDir, manifest);
	}
}
