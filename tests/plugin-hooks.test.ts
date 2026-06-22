/**
 * Unit tests for plugin bundle hooks (completion gate enforcement).
 *
 * Covers three hook behaviors in .opencode/plugins/groundwork.js:
 * 1. tool.execute.before — advisor background exemption vs non-advisor forcing
 * 2. tool.execute.after — APPROVE writes gate file, GAPS/CORRECTION/STOP removes it
 * 3. tool.execute.before on question — warning injection when gate file missing
 *
 * NOTE: The hooks use process.cwd() for the gate file path (not the `directory`
 * factory param), so tests chdir into a temp directory to isolate the gate file.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GroundworkPlugin } from "../src/index.js";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("plugin hooks: completion gate enforcement", () => {
	let tmpDir: string;
	let originalCwd: string;
	let plugin: Awaited<ReturnType<typeof GroundworkPlugin>>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "groundwork-hooks-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		plugin = await GroundworkPlugin({ client: {} as any, directory: tmpDir });
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	const gateFile = () => join(tmpDir, ".groundwork", "gate-approved");

	// ─── tool.execute.before: task background forcing ─────────────────────────

	describe("tool.execute.before — task background forcing", () => {
		test("advisor subagent_type is NOT forced to background (runs synchronously)", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.background).not.toBe(true);
		});

		test("non-advisor subagent_type (general-purpose) is forced to background=true", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "general-purpose" } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.background).toBe(true);
		});

		test("non-advisor subagent_type (explore) is forced to background=true", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "explore" } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.background).toBe(true);
		});

		test("task with no subagent_type does not crash and sets nothing", async () => {
			const input = { tool: "task" };
			const output = { args: {} };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.background).toBeUndefined();
		});

		test("non-task tool is ignored", async () => {
			const input = { tool: "read" };
			const output = { args: { subagent_type: "general-purpose" } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.background).toBeUndefined();
		});
	});

	// ─── tool.execute.after: gate file write/remove ───────────────────────────

	describe("tool.execute.after — gate file management", () => {
		test("APPROVE result writes gate-approved file with timestamp", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "APPROVE — all checks passed" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(true);
			const content = readFileSync(gateFile(), "utf8");
			expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
		});

		test("lowercase 'approve' also writes gate file", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "I approve this work" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(true);
		});

		test("GAPS result removes existing gate file", async () => {
			// Create gate file first
			const { mkdirSync, writeFileSync } = await import("node:fs");
			mkdirSync(join(tmpDir, ".groundwork"), { recursive: true });
			writeFileSync(gateFile(), "2025-01-01T00:00:00.000Z");
			expect(existsSync(gateFile())).toBe(true);

			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "GAPS found in implementation" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});

		test("CORRECTION result removes existing gate file", async () => {
			const { mkdirSync, writeFileSync } = await import("node:fs");
			mkdirSync(join(tmpDir, ".groundwork"), { recursive: true });
			writeFileSync(gateFile(), "2025-01-01T00:00:00.000Z");

			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "CORRECTION needed" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});

		test("STOP result removes existing gate file", async () => {
			const { mkdirSync, writeFileSync } = await import("node:fs");
			mkdirSync(join(tmpDir, ".groundwork"), { recursive: true });
			writeFileSync(gateFile(), "2025-01-01T00:00:00.000Z");

			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "STOP immediately" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});

		test("non-advisor task result does not write gate file", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "general-purpose" }, result: "APPROVE" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});

		test("non-task tool does not write gate file", async () => {
			const input = { tool: "read" };
			const output = { args: { subagent_type: "advisor" }, result: "APPROVE" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});

		test("neutral advisor result neither writes nor removes gate file", async () => {
			const input = { tool: "task" };
			const output = { args: { subagent_type: "advisor" }, result: "Looking good so far" };
			await plugin["tool.execute.after"](input as any, output as any);
			expect(existsSync(gateFile())).toBe(false);
		});
	});

	// ─── tool.execute.before: question gate warning ──────────────────────────

	describe("tool.execute.before — question gate warning", () => {
		test("warns when gate file does NOT exist", async () => {
			expect(existsSync(gateFile())).toBe(false);
			const input = { tool: "question" };
			const output = {
				args: {
					questions: [
						{
							question: "Next step?",
							header: "Choice",
							options: [{ value: "a", label: "Option A" }],
						},
					],
				},
			};
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions[0].question).toContain(
				"ADVISOR GATE NOT PASSED",
			);
			expect(output.args.questions[0].question).toContain("Next step?");
		});

		test("does NOT warn when gate file exists", async () => {
			const { mkdirSync, writeFileSync } = await import("node:fs");
			mkdirSync(join(tmpDir, ".groundwork"), { recursive: true });
			writeFileSync(gateFile(), "2025-01-01T00:00:00.000Z");

			const input = { tool: "question" };
			const output = {
				args: {
					questions: [
						{
							question: "Next step?",
							header: "Choice",
							options: [{ value: "a", label: "Option A" }],
						},
					],
				},
			};
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions[0].question).not.toContain(
				"ADVISOR GATE NOT PASSED",
			);
			expect(output.args.questions[0].question).toBe("Next step?");
		});

		test("warns on all questions in the array", async () => {
			const input = { tool: "question" };
			const output = {
				args: {
					questions: [
						{ question: "First?", header: "H1", options: [] },
						{ question: "Second?", header: "H2", options: [] },
					],
				},
			};
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions[0].question).toContain(
				"ADVISOR GATE NOT PASSED",
			);
			expect(output.args.questions[1].question).toContain(
				"ADVISOR GATE NOT PASSED",
			);
		});

		test("does not crash when questions array is empty", async () => {
			const input = { tool: "question" };
			const output = { args: { questions: [] } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions).toEqual([]);
		});

		test("does not crash when questions is undefined", async () => {
			const input = { tool: "question" };
			const output = { args: {} };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions).toBeUndefined();
		});

		test("non-question tool is ignored", async () => {
			const input = { tool: "read" };
			const output = { args: { questions: [{ question: "Hi?" }] } };
			await plugin["tool.execute.before"](input as any, output as any);
			expect(output.args.questions[0].question).toBe("Hi?");
		});
	});
});
