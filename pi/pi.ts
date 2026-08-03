import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBootstrapForAgent } from "../src/lib/skills.js";
import { registerGroundworkProviders } from "../src/lib/provider-registry.js";
import { createGroundworkRuntime } from "../src/runtime.js";

/** True when running inside a subagent child process (depth > 0). */
function isSubagent(): boolean {
	const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
	return depth > 0;
}

interface LedgerData {
	active?: boolean;
	session_id?: string;
	slices?: Array<{ status?: string }>;
	gate?: { advisor?: string };
}

function isLedgerData(value: unknown): value is LedgerData {
	if (!value || typeof value !== "object") return false;

	if ("active" in value) {
		const active = value.active;
		if (typeof active !== "boolean" && active !== undefined) return false;
	}
	if ("session_id" in value) {
		const session_id = value.session_id;
		if (typeof session_id !== "string" && session_id !== undefined) return false;
	}
	if ("slices" in value) {
		const slices = value.slices;
		if (!Array.isArray(slices)) return false;
	}
	if ("gate" in value) {
		const gate = value.gate;
		if (!gate || typeof gate !== "object") return false;
		if ("advisor" in gate) {
			const advisor = gate.advisor;
			if (typeof advisor !== "string" && advisor !== undefined && advisor !== null) return false;
		}
	}
	return true;
}

/** Read the active run ledger for the given project dir + session id. */
function readActiveLedger(projectDir: string, sessionId: string): LedgerData | null {
	const candidates = [
		sessionId ? join(projectDir, ".groundwork", "runs", `${sessionId}.json`) : null,
		join(projectDir, ".groundwork", "run.json"),
	].filter((p): p is string => p !== null);
	for (const p of candidates) {
		if (!existsSync(p)) continue;
		try {
			const raw = JSON.parse(readFileSync(p, "utf8"));
			if (!isLedgerData(raw)) continue;
			if (raw.active === true) return raw;
		} catch { /* malformed — skip */ }
	}
	return null;
}

/**
 * Export the active session id + project dir to the process environment so that
 * Bash-spawned subprocesses (notably the `hooks/ledger.mjs` CLI) resolve the
 * per-session ledger path (`.groundwork/runs/<session_id>.json`) instead of
 * collapsing every session onto the legacy `.groundwork/run.json`.
 *
 * Mirrors the Claude Code SessionStart hook (session-reminder.mjs, which writes
 * CLAUDE_CODE_SESSION_ID to CLAUDE_ENV_FILE). pi has no session-scoped env file,
 * so we set the global process env — correct for pi's single-session-per-process
 * model.
 */
export function exportSessionEnv(sessionId: string | undefined | null, projectDir: string): void {
	if (sessionId) process.env.CLAUDE_CODE_SESSION_ID = sessionId;
	if (projectDir) process.env.CLAUDE_PROJECT_DIR = projectDir;
}

export default function (pi: ExtensionAPI) {
	// Register custom model providers so pi-subagents can resolve our model strings
	// (e.g. "kimi-for-coding", "opencode-go/deepseek-v4-flash", etc.)
	registerGroundworkProviders(pi);

	const runtime = createGroundworkRuntime();
	const directory = process.cwd();

	// Point pi-subagents at the Pi-specific agents directory (separate from OpenCode agents).
	const piAgentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "agents-pi");
	const existingDirs = process.env.PI_SUBAGENTS_EXTRA_AGENTS_DIR || "";
	const piDirs = existingDirs ? existingDirs.split(":") : [];
	if (!piDirs.includes(piAgentsDir)) {
		piDirs.push(piAgentsDir);
		process.env.PI_SUBAGENTS_EXTRA_AGENTS_DIR = piDirs.join(":");
	}

	// ---- Events ----
	pi.on("session_start", (_event, ctx) => {
		interface SessionStartCtx {
			cwd?: string;
			sessionManager?: { getSessionId?: () => string };
		}
		const ctxObj = ctx as unknown as SessionStartCtx;
		const cwd = ctxObj?.cwd ?? process.cwd();
		runtime.cwd = cwd;
		const sid = ctxObj?.sessionManager?.getSessionId?.() ?? "";
		exportSessionEnv(sid || undefined, cwd);
	});

	pi.on("session_shutdown", (_event, _ctx) => {
		// Best-effort: warn if the session is ending with an active, ungated ledger.
		try {
			interface SessionShutdownCtx {
				sessionManager?: { getSessionId?: () => string };
			}
			// Library boundary: pi typings don't expose sessionManager.
			const ctxObj = _ctx as unknown as SessionShutdownCtx;
			const sid = ctxObj?.sessionManager?.getSessionId?.() ?? "";
			const ledger = readActiveLedger(directory, sid);
			if (ledger && ledger.gate?.advisor !== "APPROVE") {
				console.warn(
					"[groundwork] Session shutting down with active ledger — advisor gate not APPROVED.",
				);
			}
		} catch { /* best-effort */ }
	});

	// Inject orchestrator identity into the SYSTEM PROMPT for the main session.
	// Subagents get their prompts from their agent .md files; skip them here.
	pi.on("before_agent_start", (event) => {
		if (isSubagent()) return;

		const bootstrap = getBootstrapForAgent("orchestrator");
		if (!bootstrap) return;

		// omp (oh-my-pi fork) carries a `systemPrompt` on this event as a string[],
		// while upstream pi-coding-agent types it as a string and omits the field
		// from its ExtensionAPI declaration. Cast to the precise union we handle.
		const evt = event as unknown as { systemPrompt?: unknown };
		const raw = evt.systemPrompt;
		const originalText = Array.isArray(raw)
			? raw.filter((p): p is string => typeof p === "string").join("\n\n")
			: typeof raw === "string"
				? raw
				: "";
		if (originalText.includes("EXTREMELY_IMPORTANT")) return; // already injected

		// Ultra-hard rule block injected FIRST so the model cannot miss it.
		const hardRules = `=== HARD RULES (VIOLATE = WRONG) — EXTREME FAN-OUT / ULTRAWORK MODE ===
1. For trivial one-line fixes (typos, missing null checks, obvious config changes) AND clear low-risk small changes (add validation rule, extract helper, add null check): fix DIRECTLY with edit/write tools.
2. For ALL bugs, features, ambiguous changes, or anything touching shared code / multiple modules: delegate ALL work to subagent agents. NO EXCEPTIONS.
3. NEVER explore files with bash/grep yourself. ALWAYS delegate exploration to subagent agent="explorer".
4. You ONLY classify, delegate, review. ALL implementation work goes to subagents.
5. SEMANTIC SLICING: each task must have ONE clear objective. If a task touches many files or feels complex, split it into smaller independent tasks.
6. Fan out aggressively: launch ALL independent subagent calls in ONE message. Sequential execution is only for dependencies.
7. Use the cheapest capable model for each slice. advisor = zai/glm-5.2 for hard decisions only.
=== END HARD RULES ===`;

		const newPrompt = `${hardRules}\n\n${bootstrap}\n\n${originalText}`;

		// pi-coding-agent applies the mutated event field; the omp fork instead reads
		// the handler's RETURN value ({ systemPrompt }). Do both so the orchestrator
		// identity injects on either runtime.
		evt.systemPrompt = newPrompt;
		return { systemPrompt: newPrompt };
	});

	// Subagent bootstrap injection via user-message parts.
	// For subagents this supplements their agent .md system prompt.
	pi.on("context", (event, ctx) => {
		const messages = (event as any).messages;
		if (!Array.isArray(messages)) return;

		const ctxObj = ctx as unknown as { sessionManager?: { getSessionId?: () => string }; agent?: string };
		const sessionID = ctxObj?.sessionManager?.getSessionId?.() ?? "";
		exportSessionEnv(sessionID || undefined, directory);
		const agent = ctxObj?.agent ?? "orchestrator";

		// For subagents: inject full bootstrap into user messages.
		// For main session: inject an explicit delegation command into the LAST
		// user message so models that ignore system prompts still see it.
		if (isSubagent()) {
			const bootstrap = getBootstrapForAgent(agent);
			if (bootstrap) {
				type ChatPart = { type?: string; text?: string; synthetic?: boolean };
				type ChatMsg = { role?: string; content?: ChatPart[]; info?: { role?: string }; parts?: ChatPart[] };
				const getRole = (m: ChatMsg) => m.role ?? m.info?.role;
				const getContent = (m: ChatMsg | undefined) => m?.content ?? m?.parts;
				const firstUser = (messages as ChatMsg[]).find((m) => getRole(m) === "user");
				const firstContent = getContent(firstUser);
				if (Array.isArray(firstContent) && firstContent.length > 0) {
					if (!firstContent.some((p) => p.type === "text" && (p.text ?? "").includes("EXTREMELY_IMPORTANT"))) {
						firstContent.unshift({ type: "text", text: bootstrap, synthetic: true });
					}
				}
			}
		}

		// Extra nudge for main session: append explicit delegation instruction
		// to the last user message. Some fast models (e.g. neuralwatt/Qwen/Qwen3.5-397B-A17B-FP8)
		// ignore system prompts but obey direct commands in the user message.
		if (!isSubagent()) {
			const getRole = (m: any) => m.role ?? m.info?.role;
			const getContent = (m: any) => m.content ?? m.parts;
			const lastUser = messages.filter((m: any) => getRole(m) === "user").pop();
			const content = lastUser ? getContent(lastUser) : undefined;
			if (Array.isArray(content) && content.length > 0) {
				const nudge =
					"\n\nDELEGATION RULE: Trivial one-line fixes (typos, missing null checks, obvious config changes) AND clear low-risk small changes (add validation rule, extract helper, add null check) may be fixed directly with edit/write. ALL bugs, features, ambiguous changes, or anything touching shared code / multiple modules MUST delegate to subagent agents. Do NOT use bash, codebase_map, or exploration tools yourself. EXTREME FAN-OUT: decompose into semantic slices (one clear objective per task), then launch ALL independent subagent calls in ONE message.";
				const lastTextPart = content
					.filter((p: any) => p.type === "text")
					.pop();
				if (lastTextPart && !lastTextPart.text.includes(nudge.trim())) {
					lastTextPart.text += nudge;
				}

				// Stop-gate enforcement: warn if an active ledger is not yet approved.
				const ledger = readActiveLedger(directory, sessionID);
				if (ledger && ledger.gate?.advisor !== "APPROVE") {
					const terminalStatuses: Record<string, true> = {
						complete: true,
						skipped: true,
						abandoned: true,
					};
					const incompleteCount =
						ledger.slices?.filter((s) => !terminalStatuses[s.status ?? ""]).length ?? 0;
					const verdict = ledger.gate?.advisor;
					const warning =
						`\n\n⚠️ STOP-GATE ACTIVE — ${incompleteCount} slice(s) incomplete, advisor gate: ${verdict ?? "PENDING"}. Do NOT end the session. Complete all slices, then invoke advisor for APPROVE before yielding.`;
					if (lastTextPart && !lastTextPart.text.includes("STOP-GATE ACTIVE")) {
						lastTextPart.text += warning;
					}
				}
			}
		}
	});
}
