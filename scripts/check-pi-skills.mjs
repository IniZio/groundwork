#!/usr/bin/env node
/**
 * check-pi-skills.mjs — drift checker for .pi/skills/ mirror files.
 *
 * Authority relationship:
 *   The `.pi/skills/` tree is consumed by the Pi coding agent and is
 *   hand-maintained (NOT generated). Certain files inside it are exact
 *   mirrors of authority sources in `skills/groundwork/use-groundwork/`.
 *   When the authority is updated, the Pi copies must be synced manually.
 *   This script detects any byte-level drift between a Pi copy and its
 *   declared authority source.
 *
 *   Files NOT in MANIFEST are Pi-specific (e.g. acp, advisor-gate body,
 *   autoresearch) and are intentionally independent — do not add them here
 *   unless they genuinely track an authority source byte-for-byte.
 *
 *   The .codex-overlays/ transform (disable-model-invocation true→false) is
 *   for Codex projection only. Pi files track the non-overlay authority.
 *
 * Usage:
 *   node scripts/check-pi-skills.mjs [--pi-root <dir>] [--authority-root <dir>]
 *
 * Exits 0 if all manifest pairs match, 1 if any differ or are missing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

/**
 * Manifest: each entry maps a Pi copy to its authority source.
 * Paths are relative to the repo root.
 *
 * To add a new synced file: append an entry here, copy the authority
 * content to the Pi path, and run this check to confirm.
 */
const MANIFEST = [
	{
		pi: ".pi/skills/use-groundwork/SKILL.md",
		authority: "skills/groundwork/use-groundwork/SKILL.md",
	},
	{
		pi: ".pi/skills/use-groundwork/bootstrap-orchestrator.md",
		authority: "skills/groundwork/use-groundwork/bootstrap-orchestrator.md",
	},
	{
		pi: ".pi/skills/use-groundwork/bootstrap-general-purpose.md",
		authority:
			"skills/groundwork/use-groundwork/bootstrap-general-purpose.md",
	},
	{
		pi: ".pi/skills/use-groundwork/bootstrap-universal.md",
		authority: "skills/groundwork/use-groundwork/bootstrap-universal.md",
	},
];

// Allow overriding roots for testing (mkdtemp-pinned temp dirs).
const args = process.argv.slice(2);
function flag(name) {
	const i = args.indexOf(name);
	return i !== -1 ? args[i + 1] : null;
}
const piRoot = flag("--pi-root") ?? REPO_ROOT;
const authorityRoot = flag("--authority-root") ?? REPO_ROOT;

let failed = false;

for (const { pi, authority } of MANIFEST) {
	const piPath = resolve(piRoot, pi);
	const authPath = resolve(authorityRoot, authority);

	let piContent, authContent;
	try {
		piContent = readFileSync(piPath, "utf8");
	} catch {
		console.error(`MISSING  ${pi}`);
		failed = true;
		continue;
	}
	try {
		authContent = readFileSync(authPath, "utf8");
	} catch {
		console.error(`MISSING authority  ${authority}`);
		failed = true;
		continue;
	}

	if (piContent !== authContent) {
		console.error(`DRIFT    ${pi}  ←  ${authority}`);
		failed = true;
	} else {
		console.log(`OK       ${pi}`);
	}
}

if (failed) {
	console.error(
		"\nFix: copy authority content into the Pi path(s) shown above.",
	);
	process.exitCode = 1;
}
