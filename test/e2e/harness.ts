// ─── Pi E2E Test Harness ───────────────────────────────────────────────────
// Runs `pi --print --mode json` and parses the JSON event stream to assert on
// skill routing and subagent fan-out.
//
// CRITICAL: `pi --print --mode json` sometimes hangs after emitting `agent_end`.
// We detect `agent_end` and force-kill after a short grace period so tests do
// not hang indefinitely.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface PiEvent {
	type: string;
	role?: string;
	content?: Array<{ type: string; text?: string }>;
	message?: {
		role?: string;
		content?: Array<{
			type: string;
			text?: string;
			thinking?: string;
			toolCall?: {
				id: string;
				name: string;
				arguments: Record<string, unknown>;
			};
		}>;
	};
	tool_call?: Record<string, unknown>;
	call_id?: string;
	subtype?: string;
	part?: {
		tool?: string;
		state?: {
			input?: Record<string, unknown>;
		};
		text?: string;
	};
	[name: string]: unknown;
}

export interface HarnessResult {
	/** All raw events */
	events: PiEvent[];
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
	/** True if the process was force-killed after agent_end */
	forceKilled: boolean;
}

export interface SpawnOptions {
	/** Working directory for pi */
	cwd?: string;
	/** Extra env vars */
	env?: Record<string, string>;
	/** Model to use, e.g. "cursor-agent/gpt-5.4" */
	model?: string;
	/** Overall timeout in ms (default: 60_000) */
	timeoutMs?: number;
	/** Grace period after agent_end before force-kill (default: 3_000) */
	exitGraceMs?: number;
}

function makeSessionDir(): string {
	const dir = join(
		tmpdir(),
		`pi-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export async function runPiPrompt(
	prompt: string,
	opts: SpawnOptions = {},
): Promise<HarnessResult> {
	const sessionDir = makeSessionDir();
	const cwd = opts.cwd ?? process.cwd();
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const exitGraceMs = opts.exitGraceMs ?? 3_000;

	const args = [
		"--print",
		"--mode",
		"json",
		"--session-dir",
		sessionDir,
		"--no-session",
		"--offline",
		prompt,
	];

	if (opts.model) {
		args.push("--model", opts.model);
	}

	return new Promise((resolve, reject) => {
		const proc = spawn("pi", args, {
			cwd,
			env: {
				...process.env,
				...opts.env,
				PI_SUBAGENT_DEPTH: "0",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		const events: PiEvent[] = [];
		const toolCalls: Array<{ name: string; args: unknown }> = [];
		const skillsLoaded: string[] = [];
		const transcriptParts: string[] = [];
		const stderrChunks: Buffer[] = [];
		const startTime = Date.now();

		let agentEndSeen = false;
		let settled = false;
		let forceKilled = false;

		const finish = (exitCode: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(hardTimeoutId);
			clearTimeout(softTimeoutId);
			clearTimeout(graceTimer ?? undefined);
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

		// Soft timeout: if agent_end hasn't arrived by half the timeout, warn
		const softTimeoutId = setTimeout(() => {
			if (!agentEndSeen && !settled) {
				// nudge: nothing visible, just internal
			}
		}, Math.floor(timeoutMs / 2));

		let graceTimer: NodeJS.Timeout | null = null;

		proc.stdout.on("data", (chunk: Buffer) => {
			const lines = chunk.toString("utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const ev = JSON.parse(line) as PiEvent;
					events.push(ev);

					if (ev.type === "agent_end") {
						agentEndSeen = true;
						// Give pi a few seconds to exit gracefully, then force-kill
						graceTimer = setTimeout(() => {
							if (!settled) {
								forceKilled = true;
								proc.kill("SIGKILL");
								finish(null);
							}
						}, exitGraceMs);
					}

					// Extract assistant text from message_end events
					if (
						ev.type === "message_end" &&
						ev.message?.role === "assistant" &&
						ev.message.content
					) {
						for (const part of ev.message.content) {
							if (part.type === "text" && part.text) {
								transcriptParts.push(part.text);
							}
							// Handle nested toolCall (gpt-5.5) and flat toolCall (kimi-for-coding)
							const tcName = part.toolCall?.name ?? (part as any).name;
							const tcArgs = part.toolCall?.arguments ?? (part as any).arguments;
							if (part.type === "toolCall" && tcName) {
								toolCalls.push({
									name: tcName,
									args: tcArgs,
								});
								if (
									tcName === "read" &&
									tcArgs
								) {
									const path = (
										tcArgs as Record<
											string,
											unknown
										>
									).path as string;
									if (
										typeof path === "string" &&
										path.endsWith("/SKILL.md")
									) {
										const skillName =
											path.split("/").slice(-2)[0];
										if (skillName)
											skillsLoaded.push(skillName);
									}
								}
							}
						}
					}

					if (ev.type === "tool_use" && ev.part?.tool) {
						const name = ev.part.tool;
						const args = ev.part.state?.input;
						toolCalls.push({ name, args });
					}

					if (
						ev.type === "message_update" &&
						(ev as any).assistantMessageEvent?.type ===
							"text_delta"
					) {
						const text =
							(ev as any).assistantMessageEvent.delta ?? "";
						if (text) transcriptParts.push(text);
					}
				} catch {
					// ignore non-JSON lines (deprecation warnings, etc.)
				}
			}
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(hardTimeoutId);
			clearTimeout(softTimeoutId);
			if (graceTimer) clearTimeout(graceTimer);
			reject(err);
		});

		proc.on("exit", (code) => {
			if (settled) return;
			finish(code);
		});
	});
}

/** Setup a minimal test project in a unique temp directory */
export function setupTestProject(scenario?: string): string {
	const dir = join(
		tmpdir(),
		`pi-e2e-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(join(dir, "src"), { recursive: true });

	// Base files
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: "test-project", version: "1.0.0" }),
	);
	writeFileSync(
		join(dir, "src", "style.css"),
		".todo-app { backgroud: white; color: black; }\n",
	);

	// Scenario-specific app.js
	let appJs: string;
	switch (scenario) {
		case "standard-bug":
			appJs = `const items = ["apple", "banana", "cherry", "date"];
function filterItems(query) {
	// BUG: always returns all items instead of filtering
	return items;
}
console.log(filterItems("app")); // should return ["apple"] but returns all
`;
			break;
		case "small-change-clear":
			appJs = `function getUserName(user) {
	// BUG: missing null check
	return user.name.toUpperCase();
}
console.log(getUserName({ name: "Alice" }));
`;
			break;
		case "small-change-risky":
			appJs = `// Shared data model used across modules
const UserModel = {
	id: null,
	name: null,
	email: null,
	createdAt: null,
};
function createUser(data) {
	return { ...UserModel, ...data };
}
console.log(createUser({ name: "Alice" }));
`;
			break;
		default:
			appJs = `const todos = [{ id: 1, text: "Learn Pi", completed: false }];
function render() { console.log(todos); }
render();
`;
	}
	writeFileSync(join(dir, "src", "app.js"), appJs);

	writeFileSync(
		join(dir, "index.html"),
		'<!DOCTYPE html><html><head><title>Test</title></head><body><div id="app"></div></body></html>\n',
	);
	return dir;
}

/** Cleanup a test project */
export function cleanupTestProject(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
}

/** Assert helpers */
export function assertSkillUsed(
	result: HarnessResult,
	skillName: string,
): void {
	const found = result.skillsLoaded.some(
		(s) => s.toLowerCase() === skillName.toLowerCase(),
	);
	if (!found) {
		throw new Error(
			`Expected skill "${skillName}" to be loaded. ` +
				`Loaded: [${result.skillsLoaded.join(", ") || "none"}]. ` +
				`Tool calls: [${result.toolCalls.map((tc) => tc.name).join(", ") || "none"}]`,
		);
	}
}

export function assertSkillNotUsed(
	result: HarnessResult,
	skillName: string,
): void {
	const found = result.skillsLoaded.some(
		(s) => s.toLowerCase() === skillName.toLowerCase(),
	);
	if (found) {
		throw new Error(
			`Expected skill "${skillName}" NOT to be loaded, but it was.`,
		);
	}
}

export function assertFanOut(
	result: HarnessResult,
	minParallelTasks: number,
): void {
	const subagentCalls = result.toolCalls.filter(
		(tc) => tc.name === "task" || tc.name === "subagent",
	);
	if (subagentCalls.length < minParallelTasks) {
		throw new Error(
			`Expected at least ${minParallelTasks} parallel subagent tasks, ` +
				`but only found ${subagentCalls.length}. ` +
				`Tool calls: [${result.toolCalls.map((tc) => tc.name).join(", ")}]`,
		);
	}
}

export function assertNoDirectImplementation(result: HarnessResult): void {
	const implCalls = result.toolCalls.filter(
		(tc) => tc.name === "edit" || tc.name === "write",
	);
	if (implCalls.length > 0) {
		throw new Error(
			`Expected orchestrator to delegate, not implement directly. ` +
				`Found ${implCalls.length} direct implementation tool calls.`,
		);
	}
}
