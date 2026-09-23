import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Yield detection — allow stop when background Agents are still in-flight
// ---------------------------------------------------------------------------

/**
 * Extract ids of background agent launches from a JSONL transcript.
 *
 * Two launch kinds are detected:
 *
 * 1. Agent tool_use — confirmed when its tool_result text contains
 *    "Async agent launched successfully". `run_in_background: true` in the
 *    input is accepted as an extra hint but is NOT required.
 *
 * 2. SendMessage resume — a SendMessage tool_use whose tool_result text is
 *    JSON containing `"resumedAgentId"`. A plain SendMessage (no resumedAgentId)
 *    is not a launch.
 *
 * COMPLETION signal (checked in detectYield): `<tool-use-id>ID</tool-use-id>`
 * appearing inside a task-notification. That XML tag does not appear in either
 * launch tool_result line, so it cannot false-match the launch itself.
 */
export function extractBackgroundAgentIds(raw: string): string[] {
  // Pass 1: collect all Agent and SendMessage tool_use ids.
  // 'Agent' ids also record whether run_in_background hint is set.
  const toolUseIds = new Map<string, { kind: "Agent" | "SendMessage"; hint: boolean }>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(trimmed) as Record<string, unknown>; } catch { continue; }
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const blk of content as Record<string, unknown>[]) {
      if (blk.type !== "tool_use" || typeof blk.id !== "string") continue;
      if (blk.name === "Agent") {
        const hint = (blk.input as Record<string, unknown>)?.run_in_background === true;
        toolUseIds.set(blk.id as string, { kind: "Agent", hint });
      } else if (blk.name === "SendMessage") {
        toolUseIds.set(blk.id as string, { kind: "SendMessage", hint: false });
      }
    }
  }
  if (toolUseIds.size === 0) return [];

  // Pass 2: confirm each id as a background launch via its tool_result text.
  const confirmedIds = new Set<string>();

  // Agent: run_in_background hint requires no tool_result confirmation.
  for (const [id, { kind, hint }] of toolUseIds) {
    if (kind === "Agent" && hint) confirmedIds.add(id);
  }

  // Scan tool_result lines for the two confirmation phrases.
  for (const line of raw.split("\n")) {
    const hasAsync = line.includes("Async agent launched successfully");
    const hasResumed = line.includes("resumedAgentId");
    if (!hasAsync && !hasResumed) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line.trim()) as Record<string, unknown>; } catch { continue; }
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const blk of content as Record<string, unknown>[]) {
      if (blk.type !== "tool_result") continue;
      const tid = typeof blk.tool_use_id === "string" ? blk.tool_use_id as string : "";
      if (!tid || !toolUseIds.has(tid)) continue;
      const { kind } = toolUseIds.get(tid)!;
      const blockContent = blk.content;
      let text = "";
      if (typeof blockContent === "string") {
        text = blockContent;
      } else if (Array.isArray(blockContent)) {
        for (const c of blockContent as Record<string, unknown>[]) {
          if (c.type === "text" && typeof c.text === "string") text += c.text as string;
        }
      }
      if (kind === "Agent" && text.includes("Async agent launched successfully")) {
        confirmedIds.add(tid);
      } else if (kind === "SendMessage" && text.includes("resumedAgentId")) {
        confirmedIds.add(tid);
      }
    }
  }
  return Array.from(confirmedIds);
}

/**
 * Return a reason string if the session is waiting on in-flight background
 * Agent tasks, or null if no background agents are in-flight.
 *
 * Primary signal: `background_tasks` from the harness input (CC ≥ recent).
 * Each entry with `status === "running"` is an in-flight agent/task.
 * An empty array means nothing is running — do NOT fall back to transcript.
 *
 * Fallback: transcript JSONL parsing (older CC without `background_tasks`).
 * Used only when the field is entirely absent from the input.
 */
export function detectYield(input: unknown): string | null {
  const inp = (input ?? {}) as Record<string, unknown>;

  // Primary signal: present when harness provides it (including empty array).
  if (Object.prototype.hasOwnProperty.call(inp, "background_tasks")) {
    const tasks = inp.background_tasks;
    if (Array.isArray(tasks)) {
      const inFlight = (tasks as Record<string, unknown>[]).filter(
        t => t.status === "running"
      );
      if (inFlight.length > 0) {
        return `background Agent(s) still in-flight (${inFlight.length} running) — orchestrator awaiting completion`;
      }
    }
    // Field present (even if empty/non-array) → harness says nothing running.
    return null;
  }

  // Fallback: transcript parsing for older Claude Code without background_tasks.
  const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : "";
  if (!transcriptPath) return null;

  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return null; }

  const backgroundIds = extractBackgroundAgentIds(raw);
  if (backgroundIds.length === 0) return null;

  // An agent is complete when its tool-use id appears inside a task-notification.
  // The `<tool-use-id>` XML tag does not appear in the launch tool_result, so this
  // test cannot false-match the launch line itself.
  const inFlight = backgroundIds.filter(id => !raw.includes(`<tool-use-id>${id}</tool-use-id>`));
  if (inFlight.length === 0) return null;
  return `background Agent(s) still in-flight (${inFlight.length} without task-notification) — orchestrator awaiting completion`;
}

export interface HookResult { stdout: string; stderr: string; exit: number }

function block(reason: string): HookResult {
  return { stdout: JSON.stringify({ decision: "block", reason }) + "\n", stderr: "", exit: 0 };
}
function allow(note?: string): HookResult {
  const p = note ? { continue: true, reason: note } : { continue: true };
  return { stdout: JSON.stringify(p) + "\n", stderr: "", exit: 0 };
}

function isEmbedded(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js";
}

function resolveDb(env: Record<string, string | undefined>, cwd?: string): string | null {
  if (env.GROUNDWORK_DB) return env.GROUNDWORK_DB;
  const base = cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const p = path.join(base, ".groundwork", "work.db");
  return existsSync(p) ? p : null;
}

function countFile(dbPath: string, sessionId: string): string {
  return path.join(path.dirname(dbPath), `stop-gate.${sessionId}.count`);
}

function readCount(f: string): number {
  try { const n = parseInt(readFileSync(f, "utf8").trim(), 10); return isNaN(n) ? 0 : n; } catch { return 0; }
}
function writeCount(f: string, n: number): void {
  try { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, String(n)); } catch { /* fail-open */ }
}
function resetCount(f: string): void { try { unlinkSync(f); } catch { /* ok */ } }

export function checkStore(dbPath: string): {
  sliceCount: number; incomplete: number; incompleteIds: string[]; approved: boolean; holdActive: boolean;
} {
  const db = new Database(dbPath, { readonly: true });
  try {
    const sliceCount = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM slices"
    ).get()?.n ?? 0;
    const incomplete = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM slices WHERE status IN ('pending','in_progress')"
    ).get()?.n ?? 0;
    const incompleteIds = db.query<{ id: string }, []>(
      "SELECT id FROM slices WHERE status IN ('pending','in_progress') ORDER BY id LIMIT 10"
    ).all().map(r => r.id);
    const approveCount = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM events WHERE event_type='GATE_APPROVE'"
    ).get()?.n ?? 0;
    const holdId = db.query<{ max_id: number | null }, []>(
      "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD'"
    ).get()?.max_id ?? null;
    const clearId = db.query<{ max_id: number | null }, []>(
      "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD_CLEAR'"
    ).get()?.max_id ?? null;
    const holdActive = holdId !== null && (clearId === null || holdId > clearId);
    return { sliceCount, incomplete, incompleteIds, approved: approveCount > 0, holdActive };
  } finally {
    db.close();
  }
}

function writeDiag(
  dbPath: string,
  inp: Record<string, unknown>,
  yieldResult: string | null,
  result: HookResult,
): void {
  try {
    const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : "";
    let transcriptExists = false;
    let transcriptBytes = 0;
    let transcriptLastLineType: string | null = null;
    if (transcriptPath) {
      try {
        const st = statSync(transcriptPath);
        transcriptExists = true;
        transcriptBytes = st.size;
      } catch { /* file absent */ }
      if (transcriptExists) {
        try {
          const raw = readFileSync(transcriptPath, "utf8");
          const lines = raw.split("\n").filter(l => l.trim());
          if (lines.length > 0) {
            try {
              const obj = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
              const msg = (obj.message ?? obj) as Record<string, unknown>;
              transcriptLastLineType = typeof msg.type === "string" ? msg.type
                : typeof obj.type === "string" ? obj.type : null;
            } catch { /* ok */ }
          }
        } catch { /* ok */ }
      }
    }
    let decision: "allow" | "block" = "allow";
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      decision = parsed.decision === "block" ? "block" : "allow";
      reason = typeof parsed.reason === "string" ? parsed.reason : null;
    } catch { /* ok */ }
    const truncate = (v: unknown): unknown => {
      if (v === null || v === undefined) return v;
      if (typeof v === "string") return v.length > 200 ? v.slice(0, 200) + "…" : v;
      if (Array.isArray(v)) return v.map(truncate);
      return v;
    };
    const rawBackgroundTasks = inp.background_tasks;
    const rawSessionCrons = inp.session_crons;
    const diag = {
      ts: new Date().toISOString(),
      session_id: typeof inp.session_id === "string" ? inp.session_id : "default",
      input_keys: Object.keys(inp),
      transcript_path: transcriptPath || null,
      transcript_exists: transcriptExists,
      transcript_bytes: transcriptBytes,
      transcript_last_line_type: transcriptLastLineType,
      background_tasks: truncate(rawBackgroundTasks),
      session_crons: truncate(rawSessionCrons),
      yield_result: yieldResult,
      decision,
      reason,
    };
    writeFileSync(path.join(path.dirname(dbPath), "stop-gate.last.json"), JSON.stringify(diag, null, 2));
  } catch { /* never throw */ }
}

export function run(input: unknown, env: Record<string, string | undefined>): HookResult {
  try {
    if (isEmbedded(env)) return allow();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : undefined;
    const sessionId = typeof inp.session_id === "string" ? inp.session_id : "default";
    const dbPath = resolveDb(env, cwd);
    if (!dbPath) return allow("stop-gate: no active work store — session may end");

    const compute = (): { result: HookResult; yieldResult: string | null } => {
      const { sliceCount, incomplete, incompleteIds, approved, holdActive } = checkStore(dbPath);
      const cf = countFile(dbPath, sessionId);
      if (holdActive) {
        resetCount(cf);
        return { result: allow("stop-gate: HOLD active — human hold in effect, session may end"), yieldResult: null };
      }
      if (sliceCount === 0) {
        resetCount(cf);
        return { result: allow("stop-gate: no slices in store — nothing to gate"), yieldResult: null };
      }
      if (incomplete === 0 && approved) {
        resetCount(cf);
        return { result: allow("stop-gate: all slices complete, gate approved"), yieldResult: null };
      }
      const yieldReason = detectYield(inp);
      if (yieldReason) {
        return { result: allow(`stop-gate: ${yieldReason}`), yieldResult: yieldReason };
      }
      const count = readCount(cf) + 1;
      writeCount(cf, count);
      if (count >= 4) {
        resetCount(cf);
        process.stderr.write("stop-gate: 4th consecutive block — allowing; resolve store state manually\n");
        return { result: allow("stop-gate: override — consecutive block limit reached"), yieldResult: null };
      }
      if (count >= 3) {
        return { result: block("stop-gate: condition appears externally unresolvable — stop trying; resolve store state manually before continuing."), yieldResult: null };
      }
      if (incomplete > 0) {
        const ids = incompleteIds.join(", ");
        return { result: block(`stop-gate: ${incomplete} slice(s) incomplete [${ids}]. Run \`$GW slice complete <id>\` when done, or \`$GW hold set --reason "<why>"\` to stop for a human.`), yieldResult: null };
      }
      return { result: block("stop-gate: no GATE_APPROVE event recorded. Record an advisor approval before ending."), yieldResult: null };
    };

    const { result, yieldResult } = compute();
    writeDiag(dbPath, inp, yieldResult, result);
    return result;
  } catch { return allow("stop-gate: error reading store — fail-open"); }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = run(input, process.env as Record<string, string | undefined>);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
