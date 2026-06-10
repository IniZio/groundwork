// ─── Claude E2E Test Harness ─────────────────────────────────────────────────
// Runs `claude --print --verbose --output-format stream-json --no-update-check`
// and parses the newline-delimited JSON event stream to assert on skill routing
// and subagent fan-out.
//
// CRITICAL: `claude --print` can sometimes hang after the final assistant turn.
// We detect the result event and force-kill after a short grace period so tests
// do not hang indefinitely.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClaudeEvent {
	type: string;
	[key: string]: unknown;
}

export interface HarnessResult {
	/** All raw events */
	events: ClaudeEvent[];
	/** Concatenated assistant text */
	transcript: string;
	/** Tool calls seen in the event stream */
	toolCalls: Array<{ name: string; args: unknown }>;
	/** Skill names that were loaded via read tool calls to SKILL.md */
	skillsLoaded: string[];
	/** Duration in ms */
	durationMs: number;
	/** Raw stderr */
	stderr: string;
	/** Exit code (null if force-killed) */
	exitCode: number | null;
	/** True if the process was force-killed */
	forceKilled: boolean;
}

export interface ClaudeTestEnv {
	configDir: string;
	cleanup: () => void;
}

export interface SpawnOptions {
	/** Working directory for claude */
	cwd?: string;
	/** Extra env vars */
	env?: Record<string, string>;
	/** Overall timeout in ms (default: 120_000) */
	timeoutMs?: number;
	/** Grace period after result event before force-kill (default: 3_000) */
	exitGraceMs?: number;
}

const SKILLS_DIR =
	"/home/newman/.config/opencode/plugins/groundwork/.claude/worktrees/claude-plugin-support/.pi/skills";

/**
 * Write the groundwork routing bootstrap to the project's CLAUDE.md so Claude
 * loads the correct skill on every test run.
 *
 * Auth lives in ~/.claude and is NOT isolated — isolating CLAUDE_CONFIG_DIR
 * would break authentication. Test isolation comes from the project-level
 * CLAUDE.md bootstrap and temp project directories.
 *
 * @param projectDir  The working directory passed as `cwd` to runClaudePrompt.
 *                    The CLAUDE.md bootstrap is written here so Claude picks
 *                    it up automatically.
 */
export function setupClaudeTestEnv(
	projectDir: string,
	_opts?: { extraSettings?: object },
): ClaudeTestEnv {
	const configDir = ""; // not used — auth lives in ~/.claude

	// Write the routing bootstrap directly to the project's CLAUDE.md.
	const bootstrap = `<!-- GW:START -->
# Groundwork — Orchestrator Mode

You are an AI ORCHESTRATOR. Before doing any implementation, classify the request and load the correct skill file using the Read tool.

## Routing Protocol (MANDATORY — do this FIRST before any other action)

Classify the incoming request:
- **Bug/defect**: keywords like "doesn't work", "broken", "debug", "fix", "not working", "regression", "error", "filters don't work"
- **Feature** (multi-day scope): keywords like "build", "implement", "full authentication", "workflow engine", "system with multiple components"
- **Risky shared change**: mentions "shared", "used across N modules", "common model", "base class", or multiple modules

Then load the skill by reading the exact file path with the Read tool:
- Bug → Read: ${SKILLS_DIR}/diagnose/SKILL.md
- Feature → Read: ${SKILLS_DIR}/interview/SKILL.md
- Risky shared change → Read: ${SKILLS_DIR}/interview/SKILL.md

After reading the skill file, follow its instructions.
<!-- GW:END -->
`;

	writeFileSync(join(projectDir, "CLAUDE.md"), bootstrap, "utf8");

	return {
		configDir,
		cleanup: () => {
			// Project dir is cleaned up by the test; CLAUDE.md goes with it.
		},
	};
}

export async function runClaudePrompt(
	prompt: string,
	opts: SpawnOptions & { configDir?: string } = {},
): Promise<HarnessResult> {
	const cwd = opts.cwd ?? process.cwd();
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const exitGraceMs = opts.exitGraceMs ?? 3_000;

	const args = [
		"--print",
		"--verbose",
		"--output-format",
		"stream-json",
		"--permission-mode",
		"acceptEdits",
		prompt,
	];

	return new Promise((resolve, reject) => {
		const proc = spawn("claude", args, {
			cwd,
			env: {
				...process.env,
				...opts.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		const events: ClaudeEvent[] = [];
		const toolCalls: Array<{ name: string; args: unknown }> = [];
		const skillsLoaded: string[] = [];
		const transcriptParts: string[] = [];
		const stderrChunks: Buffer[] = [];
		const startTime = Date.now();

		let resultSeen = false;
		let settled = false;
		let forceKilled = false;
		let graceTimer: NodeJS.Timeout | null = null;

		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(hardTimeoutId);
			if (graceTimer) clearTimeout(graceTimer);
			const durationMs = Date.now() - startTime;
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			resolve({
				events,
				transcript: transcriptParts.join(""),
				toolCalls,
				skillsLoaded,
				durationMs,
				stderr,
				exitCode,
				forceKilled,
			});
		};

		// Hard wall-clock timeout: SIGTERM → SIGKILL
		const hardTimeoutId = setTimeout(() => {
			if (settled) return;
			forceKilled = true;
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!settled) {
					proc.kill("SIGKILL");
					finish(null);
				}
			}, 2_000);
		}, timeoutMs);

		const processEvent = (ev: ClaudeEvent) => {
			events.push(ev);

			// Extract text and tool calls from assistant events.
			// The actual stream-json format wraps content in ev.message.content[].
			if (ev.type === "assistant" && ev.message) {
				const content = (
					ev.message as { content?: Array<Record<string, unknown>> }
				).content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === "text" && block.text) {
							transcriptParts.push(block.text as string);
						}
						if (block.type === "tool_use" && block.name) {
							const tcName = block.name as string;
							const tcArgs =
								(block.input as Record<string, unknown>) ?? {};
							toolCalls.push({ name: tcName, args: tcArgs });

							// Skill detection: Read tool with file_path ending in /SKILL.md
							if (tcName === "Read" || tcName === "read_file") {
								const fp = String(
									tcArgs.file_path ?? tcArgs.path ?? "",
								);
								if (fp.endsWith("/SKILL.md")) {
									const skillName =
										fp.split("/").slice(-2)[0];
									if (skillName)
										skillsLoaded.push(skillName);
								}
							}
						}
					}
				}
			}

			// Top-level result event signals end of run
			if (ev.type === "result") {
				resultSeen = true;
				if (ev.result && typeof ev.result === "string") {
					transcriptParts.push(ev.result as string);
				}
				// Give claude a few seconds to exit gracefully, then force-kill
				if (!graceTimer) {
					graceTimer = setTimeout(() => {
						if (!settled) {
							forceKilled = true;
							proc.kill("SIGKILL");
							finish(null);
						}
					}, exitGraceMs);
				}
			}

			// Some claude versions emit top-level tool_use events outside assistant blocks
			if (ev.type === "tool_use") {
				const tcName = (ev.name as string) ?? "";
				const tcArgs =
					(ev.input as Record<string, unknown>) ?? {};
				if (tcName) {
					toolCalls.push({ name: tcName, args: tcArgs });

					if (tcName === "Read" || tcName === "read_file") {
						const fp = String(
							tcArgs.file_path ?? tcArgs.path ?? "",
						);
						if (fp.endsWith("/SKILL.md")) {
							const skillName = fp.split("/").slice(-2)[0];
							if (skillName) skillsLoaded.push(skillName);
						}
					}
				}
			}
		};

		// Buffer for incomplete lines across stdout chunks.
		// A single JSON event may span multiple data chunks so we must NOT split
		// per-chunk — instead accumulate and split on newlines, keeping the last
		// (potentially incomplete) fragment in the buffer.
		let lineBuffer = "";

		proc.stdout.on("data", (chunk: Buffer) => {
			lineBuffer += chunk.toString("utf8");
			const lines = lineBuffer.split("\n");
			// Last element may be an incomplete line — keep it in the buffer
			lineBuffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const ev = JSON.parse(trimmed) as ClaudeEvent;
					processEvent(ev);
				} catch {
					// ignore non-JSON lines (deprecation warnings, version notices, etc.)
				}
			}
		});

		// Flush any remaining buffered line when stdout closes
		proc.stdout.on("end", () => {
			if (lineBuffer.trim()) {
				try {
					const ev = JSON.parse(
						lineBuffer.trim(),
					) as ClaudeEvent;
					processEvent(ev);
				} catch {
					// ignore
				}
				lineBuffer = "";
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(hardTimeoutId);
			if (graceTimer) clearTimeout(graceTimer);
			reject(err);
		});

		proc.on("exit", (code) => {
			if (settled) return;
			// Flush any remaining buffered line
			if (lineBuffer.trim()) {
				try {
					const ev = JSON.parse(
						lineBuffer.trim(),
					) as ClaudeEvent;
					processEvent(ev);
				} catch {
					// ignore
				}
			}
			finish(code);
		});

		// Suppress unused-variable warning — resultSeen is intentionally retained
		// as a guard but the grace timer handles the actual exit trigger.
		void resultSeen;
	});
}
