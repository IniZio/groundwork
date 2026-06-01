// ─── Pi E2E Test Harness ───────────────────────────────────────────────────
// Spawns `pi --mode rpc` and drives it via JSON-RPC over stdin/stdout.
// Collects the full transcript for assertion on skill routing and fan-out.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface PiRpcEvent {
	type: string;
	role?: string;
	content?: Array<{ type: string; text?: string }>;
	message?: {
		role?: string;
		content?: Array<{ type: string; text?: string; thinking?: string }>;
	};
	tool_call?: Record<string, unknown>;
	call_id?: string;
	subtype?: string;
	[ key: string ]: unknown;
}

export interface PiRpcResponse {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface HarnessResult {
	/** All raw events emitted by pi */
	events: PiRpcEvent[];
	/** All assistant text concatenated */
	transcript: string;
	/** All tool_calls seen in assistant messages */
	toolCalls: Array<{ name: string; args: unknown }>;
	/** Session messages at end */
	messages: unknown[];
	/** Session stats */
	stats: {
		toolCount: number;
		turnCount: number;
		messageCount: number;
	};
}

export interface SpawnOptions {
	/** Working directory for pi */
	cwd?: string;
	/** Extra env vars */
	env?: Record<string, string>;
	/** Model to use, e.g. "openai/gpt-5.4" */
	model?: string;
	/** Max turns before abort */
	maxTurns?: number;
	/** Timeout in ms */
	timeoutMs?: number;
}

function makeSessionDir(): string {
	const dir = join(tmpdir(), `pi-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function send(proc: ChildProcessWithoutNullStreams, cmd: Record<string, unknown>): void {
	proc.stdin.write(JSON.stringify(cmd) + "\n");
}

async function waitForIdle(
	proc: ChildProcessWithoutNullStreams,
	events: PiRpcEvent[],
	timeoutMs: number,
): Promise<void> {
	const start = Date.now();
	const checkInterval = 500;

	return new Promise((resolve, reject) => {
		const timer = setInterval(() => {
			if (Date.now() - start > timeoutMs) {
				clearInterval(timer);
				reject(new Error(`Timeout waiting for idle after ${timeoutMs}ms`));
				return;
			}

			// Poll via get_state
			send(proc, { type: "get_state", id: `poll-${Date.now()}` });
		}, checkInterval);

		// Hook into events to detect idle
		const onData = (chunk: Buffer) => {
			const lines = chunk.toString("utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const ev = JSON.parse(line) as PiRpcEvent | PiRpcResponse;
					if ("command" in ev && ev.command === "get_state" && ev.success) {
						const state = (ev as PiRpcResponse).data as Record<string, unknown> | undefined;
						if (state && !state.isStreaming && !state.isCompacting && (state.pendingMessageCount as number) === 0) {
							// Give it a grace period to settle
							setTimeout(() => {
								clearInterval(timer);
								proc.stdout.off("data", onData);
								resolve();
							}, 1000);
						}
					}
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
				} catch (_e) {
					// ignore malformed lines
				}
			}
		};
		proc.stdout.on("data", onData);
	});
}

export async function runPiPrompt(prompt: string, opts: SpawnOptions = {}): Promise<HarnessResult> {
	const sessionDir = makeSessionDir();
	const cwd = opts.cwd ?? process.cwd();
	const timeoutMs = opts.timeoutMs ?? 120_000;
	const maxTurns = opts.maxTurns ?? 20;

	const args = [
		"--mode", "rpc",
		"--session-dir", sessionDir,
		"--no-session",
		"--steering-mode", "one-at-a-time",
	];

	if (opts.model) {
		const [provider, modelId] = opts.model.split("/");
		args.push("--provider", provider, "--model", modelId);
	}

	const proc = spawn("pi", args, {
		cwd,
		env: {
			...process.env,
			...opts.env,
			PI_SUBAGENT_DEPTH: "0", // ensure main session
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	const events: PiRpcEvent[] = [];
	const toolCalls: Array<{ name: string; args: unknown }> = [];
	let turnCount = 0;

	// Collect all stdout events
	proc.stdout.on("data", (chunk: Buffer) => {
		const lines = chunk.toString("utf8").split("\n").filter(Boolean);
		for (const line of lines) {
			try {
				const ev = JSON.parse(line) as PiRpcEvent | PiRpcResponse;
				if ("type" in ev && ev.type !== "response") {
					events.push(ev as PiRpcEvent);
					if (ev.type === "assistant") {
						turnCount++;
						const tc = (ev as PiRpcEvent).tool_call;
						if (tc) {
							for (const [name, payload] of Object.entries(tc)) {
								toolCalls.push({ name, args: (payload as Record<string, unknown>)?.args });
							}
						}
					}
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (_e) {
				// ignore non-JSON or malformed lines
			}
		}
	});

	// Capture stderr for debugging
	const stderrLines: string[] = [];
	proc.stderr.on("data", (chunk: Buffer) => {
		stderrLines.push(chunk.toString("utf8"));
	});

	// Wait for process to be ready (small delay)
	await new Promise((r) => setTimeout(r, 500));

	// Send the prompt
	send(proc, { type: "prompt", message: prompt, id: "prompt-1" });

	// Wait for idle or timeout
	try {
		await waitForIdle(proc, events, timeoutMs);
	} catch (err) {
		// If timeout, abort and collect what we have
		send(proc, { type: "abort", id: "abort-1" });
		await new Promise((r) => setTimeout(r, 1000));
	}

	// Fetch final messages
	send(proc, { type: "get_messages", id: "msgs-1" });
	await new Promise((r) => setTimeout(r, 500));

	send(proc, { type: "get_session_stats", id: "stats-1" });
	await new Promise((r) => setTimeout(r, 500));

	// Close stdin to let pi exit cleanly
	proc.stdin.end();

	// Wait for process exit
	await new Promise<void>((resolve) => {
		proc.on("exit", () => resolve());
		setTimeout(() => {
			proc.kill("SIGTERM");
			resolve();
		}, 3000);
	});

	// Build transcript from assistant messages
	const transcriptParts: string[] = [];
	for (const ev of events) {
		if (ev.type === "assistant" && ev.message?.content) {
			for (const part of ev.message.content) {
				if (part.type === "text" && part.text) {
					transcriptParts.push(part.text);
				}
			}
		}
	}

	return {
		events,
		transcript: transcriptParts.join("\n"),
		toolCalls,
		messages: [], // populated below if we parsed get_messages response
		stats: {
			toolCount: toolCalls.length,
			turnCount,
			messageCount: events.filter((e) => e.type === "assistant" || e.type === "user").length,
		},
	};
}

/** Assert helpers */
export function assertSkillUsed(result: HarnessResult, skillName: string): void {
	const lower = result.transcript.toLowerCase();
	const found = lower.includes(`skill: ${skillName.toLowerCase()}`) ||
		lower.includes(`invoke skill "${skillName.toLowerCase()}"`) ||
		lower.includes(`load "${skillName.toLowerCase()}"`);
	if (!found) {
		throw new Error(
			`Expected skill "${skillName}" to be invoked. ` +
			`Transcript excerpt:\n${result.transcript.slice(0, 2000)}`,
		);
	}
}

export function assertSkillNotUsed(result: HarnessResult, skillName: string): void {
	const lower = result.transcript.toLowerCase();
	const found = lower.includes(`skill: ${skillName.toLowerCase()}`) ||
		lower.includes(`invoke skill "${skillName.toLowerCase()}"`);
	if (found) {
		throw new Error(
			`Expected skill "${skillName}" NOT to be invoked, but it was.`,
		);
	}
}

export function assertFanOut(result: HarnessResult, minParallelTasks: number): void {
	// Look for multiple subagent task tool calls in rapid succession
	const subagentCalls = result.toolCalls.filter((tc) =>
		tc.name === "task" || tc.name === "subagent",
	);
	if (subagentCalls.length < minParallelTasks) {
		throw new Error(
			`Expected at least ${minParallelTasks} parallel subagent tasks, ` +
			`but only found ${subagentCalls.length}. ` +
			`Tool calls: ${result.toolCalls.map((tc) => tc.name).join(", ")}`,
		);
	}
}
