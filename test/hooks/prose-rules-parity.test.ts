/**
 * Parity test — output-prose ruleset present in every generated agent definition.
 *
 * TOKEN-ECONOMY-R-001 (Verification): "enforced by parity test asserting guard-rail
 * text is present in every regenerated agent definition; a mirror tree cannot drift
 * silently."
 *
 * The generated mirror trees (agents/, agents-pi/) are produced by `pnpm run
 * generate:agents` from the authoritative sources in agents-src/. This test
 * asserts that the output-prose ruleset section — added to every agents-src/*.md
 * file — is faithfully reproduced in every generated file, so a drift between
 * the authority tree and the mirror tree is caught at CI rather than silently
 * carried into deployed agent definitions.
 *
 * Checked phrase: "Negation and scope words are inviolable" — a distinctive
 * sentence from the ## Output prose rules section that appears in no other
 * section of any agent definition.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AGENTS_DIR = path.join(ROOT, "agents");
const AGENTS_PI_DIR = path.join(ROOT, "agents-pi");

/** Distinctive phrase from the ## Output prose rules section. */
const GUARD_PHRASE = "Negation and scope words are inviolable";

function agentFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.map((f) => path.join(dir, f));
}

describe("prose-rules-parity — output-prose ruleset present in every generated agent definition", () => {
	const mainFiles = agentFiles(AGENTS_DIR);
	const piFiles = agentFiles(AGENTS_PI_DIR);

	it("agents/ directory is non-empty", () => {
		expect(mainFiles.length).toBeGreaterThan(0);
	});

	it("agents-pi/ directory is non-empty", () => {
		expect(piFiles.length).toBeGreaterThan(0);
	});

	for (const filePath of mainFiles) {
		const name = path.basename(filePath);
		it(`agents/${name} contains the guard-rail phrase`, () => {
			const content = fs.readFileSync(filePath, "utf8");
			expect(content).toContain(GUARD_PHRASE);
		});
	}

	for (const filePath of piFiles) {
		const name = path.basename(filePath);
		it(`agents-pi/${name} contains the guard-rail phrase`, () => {
			const content = fs.readFileSync(filePath, "utf8");
			expect(content).toContain(GUARD_PHRASE);
		});
	}
});
