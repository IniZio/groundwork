import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "..");
const overlayDir = resolve(
	root,
	"skills/groundwork/use-groundwork/.codex-overlays",
);
const generatedDir = resolve(root, "skills/use-groundwork");

function readGuidance(baseDir: string, rel: string): string {
	return readFileSync(resolve(baseDir, rel), "utf8")
		.toLowerCase()
		.replace(/\s+/g, " ");
}

// Substrings that MUST appear in every guidance document (case-insensitively).
const REQUIRED_PHRASES = [
	"completion events may be surfaced to the conversation",
	"completion notification when available",
	"workflow correctness must not depend on automatic reinvocation",
	"wait/result",
	"background",
	"immediate dependency",
	"never poll, spin",
] as const;

// Substrings that MUST NOT appear in Codex-only guidance.
const FORBIDDEN_PHRASES = [
	"opencode",
	"continue automatically",
	"automatically resume",
	"automatically resumes",
	"continue when its completion notification arrives",
	"notification is the signal to resume",
	"resume after a turn",
	"resuming on the completion notification",
	"wake the main agent",
	"wakes the main agent",
	"reliable native signal",
	"adapt to sequential",
	"planned local execution",
	"single-agent mode",
	"single primary session",
	"execute the slices locally",
] as const;

describe("Codex completion-notification guidance", () => {
	const documents: Array<[string, string]> = [
		["canonical overlay", "bootstrap-orchestrator.md"],
		["canonical overlay", "reference/fan-out-patterns.md"],
		["canonical overlay", "reference/task-scoping.md"],
		["generated skill", "bootstrap-orchestrator.md"],
		["generated skill", "reference/fan-out-patterns.md"],
		["generated skill", "reference/task-scoping.md"],
	];

	for (const [kind, rel] of documents) {
		const label = `${kind} ${rel}`;
		const baseDir = kind === "canonical overlay" ? overlayDir : generatedDir;

		test(`${label} states the safe two-path contract`, () => {
			const text = readGuidance(baseDir, rel);
			for (const phrase of REQUIRED_PHRASES) {
				expect(
					text,
					`${label} missing required phrase "${phrase}"`,
				).toContain(phrase);
			}
		});

		test(`${label} rejects automatic-resumption and cross-host claims`, () => {
			const text = readGuidance(baseDir, rel);
			for (const phrase of FORBIDDEN_PHRASES) {
				expect(
					text,
					`${label} must not contain forbidden wording "${phrase}"`,
				).not.toContain(phrase);
			}
		});
	}

	test("bootstrap overlay names the completion-notification contract", () => {
		const text = readFileSync(
			resolve(overlayDir, "bootstrap-orchestrator.md"),
			"utf8",
		);
		expect(text).toContain("Completion Notifications");
	});
});
