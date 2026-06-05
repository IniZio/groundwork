// ─── Package-Local Agent Discovery ─────────────────────────────────────────
// Sets PI_SUBAGENTS_EXTRA_AGENTS_DIR to point at the agents/ directory shipped
// with the groundwork plugin package. No runtime file writing — the agent .md
// files are static, git-tracked, and bundled with the package.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the package-local agents/ directory.
 *
 * In development (tsx), import.meta.url points to the .ts source file under
 * src/lib/, so we navigate up to the package root. In production (compiled),
 * the same relative path works because the dist/ structure mirrors src/.
 */
function resolveAgentsDir(): string {
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);
	// From src/lib/ → package root → agents/
	return join(thisDir, "..", "..", "agents");
}

/**
 * Ensure pi-subagents can discover our agent .md files by setting the
 * PI_SUBAGENTS_EXTRA_AGENTS_DIR environment variable to the package-local
 * agents directory.
 *
 * Called early in the extension setup (before any session starts) so the
 * env var is available when pi-subagents performs agent discovery.
 */
export function ensureAgentsInstalled(_cwd: string): void {
	const agentsDir = resolveAgentsDir();
	process.env.PI_SUBAGENTS_EXTRA_AGENTS_DIR = agentsDir;
}
