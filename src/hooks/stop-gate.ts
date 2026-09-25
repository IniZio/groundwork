import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readSealKey, verifySeal, type SealFields } from "../store/key-store.js";

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

function sigFile(dbPath: string, sessionId: string): string {
  return path.join(path.dirname(dbPath), `stop-gate.${sessionId}.sig`);
}
function readSig(f: string): string | null {
  try { const s = readFileSync(f, "utf8").trim(); return s || null; } catch { return null; }
}
function writeSig(f: string, sig: string): void {
  try { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, sig); } catch { /* fail-open */ }
}
function resetSig(f: string): void { try { unlinkSync(f); } catch { /* ok */ } }

export function parseTs(s: string | null): number {
  if (!s) return NaN;
  const n = s.replace(" ", "T");
  return Date.parse(/[+-]\d\d:\d\d$|Z$/.test(n) ? n : n + "Z");
}

export function getSessionStartTime(inp: Record<string, unknown>): string | null {
  const tp = typeof inp.transcript_path === "string" ? inp.transcript_path : "";
  if (!tp) return null;
  let raw: string;
  try { raw = readFileSync(tp, "utf8"); } catch { return null; }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const ts = obj.timestamp;
      if (typeof ts === "string" && ts) return ts;
    } catch { continue; }
  }
  return null;
}

export interface MotiveStatus {
  motiveId: string;
  incomplete: number;
  incompleteIds: string[];
  approved: boolean;
  holdActive: boolean;
  /** True when the newest GATE_APPROVE event exists but its HMAC seal failed verification. */
  sealRejected: boolean;
  /** SHA recorded in GATE_APPROVE payload, or null if absent/not recorded. */
  approvalBaseCommit: string | null;
  /** created_at of the newest GATE_APPROVE event, or null if no approval. */
  approvalCreatedAt: string | null;
  /** True when a slice was inserted into this motive after the approval event. */
  sliceAddedAfterApproval: boolean;
}

/** Returns the current git HEAD SHA for a given directory, or null if not a git repo or git unavailable. */
export function getCurrentHead(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8", timeout: 3000 });
    if (r.status !== 0) return null;
    return (r.stdout ?? "").trim() || null;
  } catch { return null; }
}

export function checkStore(dbPath: string, repoPath?: string): {
  sliceCount: number; incomplete: number; incompleteIds: string[]; approved: boolean; holdActive: boolean;
  motiveDetails: MotiveStatus[];
} {
  const resolvedRepo = repoPath ?? path.dirname(path.dirname(dbPath));
  const sealKey = readSealKey(resolvedRepo);
  const db = new Database(dbPath, { readonly: true });
  try {
    const sliceCount = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM slices"
    ).get()?.n ?? 0;

    // Check whether the motives table exists (migration 5+).
    const hasMotives = (db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='motives'"
    ).get()?.n ?? 0) > 0;

    let motiveIds: string[];
    if (hasMotives) {
      const rows = db.query<{ id: string }, []>(
        `SELECT DISTINCT s.motive_id AS id FROM slices s
         JOIN motives m ON m.id = s.motive_id
         WHERE m.status != 'complete'
         ORDER BY s.motive_id`
      ).all();
      motiveIds = rows.map(r => r.id);
    } else {
      motiveIds = ["default"];
    }

    const motiveDetails: MotiveStatus[] = motiveIds.map(motiveId => {
      if (hasMotives) {
        const inc = db.query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM slices WHERE status IN ('pending','in_progress') AND motive_id = ?"
        ).get(motiveId)?.n ?? 0;
        const incIds = db.query<{ id: string }, [string]>(
          "SELECT id FROM slices WHERE status IN ('pending','in_progress') AND motive_id = ? ORDER BY id LIMIT 10"
        ).all(motiveId).map(r => r.id);
        const newestGate = db.query<{ event_type: string; payload: string; created_at: string }, [string]>(
          "SELECT event_type, payload, created_at FROM events WHERE event_type IN ('GATE_APPROVE','GATE_CORRECTION','GATE_STOP','GATE_GAPS','GATE_REPLAN') AND motive_id = ? ORDER BY id DESC LIMIT 1"
        ).get(motiveId);
        let rawApproved = newestGate?.event_type === "GATE_APPROVE";
        let sealValid = false;
        let approvalBaseCommit: string | null = null;
        let approvalCreatedAt: string | null = null;
        let sliceAddedAfterApproval = false;
        if (rawApproved && newestGate) {
          approvalCreatedAt = newestGate.created_at;
          let parsedPayload: Record<string, unknown> = {};
          try { parsedPayload = JSON.parse(newestGate.payload) as Record<string, unknown>; } catch { /* ok */ }
          approvalBaseCommit = typeof parsedPayload.base_commit === "string" ? parsedPayload.base_commit : null;
          const storedSeal = typeof parsedPayload.seal === "string" ? parsedPayload.seal : null;
          const payloadCreatedAt = typeof parsedPayload.created_at === "string" ? parsedPayload.created_at : null;
          if (sealKey) {
            if (storedSeal && payloadCreatedAt) {
              const fields: SealFields = {
                citation: typeof parsedPayload.citation === "string" ? parsedPayload.citation : "",
                created_at: payloadCreatedAt,
                event_type: "GATE_APPROVE",
                motive_id: motiveId,
                base_commit: approvalBaseCommit,
              };
              sealValid = verifySeal(sealKey, fields, storedSeal);
            }
          } else {
            sealValid = true;
          }
          const sliceAfter = db.query<{ n: number }, [string, string]>(
            "SELECT COUNT(*) AS n FROM slices WHERE motive_id = ? AND created_at > ?"
          ).get(motiveId, newestGate.created_at)?.n ?? 0;
          sliceAddedAfterApproval = sliceAfter > 0;
        }
        const approved = rawApproved && sealValid;
        const sealRejected = rawApproved && !sealValid;
        const holdId = db.query<{ max_id: number | null }, [string]>(
          "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD' AND motive_id = ?"
        ).get(motiveId)?.max_id ?? null;
        const clearId = db.query<{ max_id: number | null }, [string]>(
          "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD_CLEAR' AND motive_id = ?"
        ).get(motiveId)?.max_id ?? null;
        const holdActive = holdId !== null && (clearId === null || holdId > clearId);
        return { motiveId, incomplete: inc, incompleteIds: incIds, approved, sealRejected, holdActive, approvalBaseCommit, approvalCreatedAt, sliceAddedAfterApproval };
      } else {
        const inc = db.query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM slices WHERE status IN ('pending','in_progress')"
        ).get()?.n ?? 0;
        const incIds = db.query<{ id: string }, []>(
          "SELECT id FROM slices WHERE status IN ('pending','in_progress') ORDER BY id LIMIT 10"
        ).all().map(r => r.id);
        const newestGateLegacy = db.query<{ event_type: string }, []>(
          "SELECT event_type FROM events WHERE event_type IN ('GATE_APPROVE','GATE_CORRECTION','GATE_STOP','GATE_GAPS','GATE_REPLAN') ORDER BY id DESC LIMIT 1"
        ).get();
        const approvedLegacy = newestGateLegacy?.event_type === "GATE_APPROVE";
        const holdId = db.query<{ max_id: number | null }, []>(
          "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD'"
        ).get()?.max_id ?? null;
        const clearId = db.query<{ max_id: number | null }, []>(
          "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD_CLEAR'"
        ).get()?.max_id ?? null;
        const holdActive = holdId !== null && (clearId === null || holdId > clearId);
        return { motiveId, incomplete: inc, incompleteIds: incIds, approved: approvedLegacy, sealRejected: false, holdActive, approvalBaseCommit: null, approvalCreatedAt: null, sliceAddedAfterApproval: false };
      }
    });

    const incomplete = motiveDetails.reduce((s, m) => s + m.incomplete, 0);
    const incompleteIds = motiveDetails.flatMap(m => m.incompleteIds).slice(0, 10);
    const approved = motiveDetails.length > 0 && motiveDetails.every(m => m.approved);
    const globalHoldId = db.query<{ max_id: number | null }, []>(
      "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD'"
    ).get()?.max_id ?? null;
    const globalClearId = db.query<{ max_id: number | null }, []>(
      "SELECT MAX(id) AS max_id FROM events WHERE event_type='HOLD_CLEAR'"
    ).get()?.max_id ?? null;
    const holdActive = globalHoldId !== null && (globalClearId === null || globalHoldId > globalClearId);

    return { sliceCount, incomplete, incompleteIds, approved, holdActive, motiveDetails };
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

// ---------------------------------------------------------------------------
// Escalation nudge — warn when a groundwork:implementer has run too long
// ---------------------------------------------------------------------------

interface EscalateState {
  firstSeen: Record<string, string>; // taskId → ISO timestamp
  nudged: string[];                  // taskIds already nudged
}

export function escalateStateFile(
  inp: Record<string, unknown>,
  env: Record<string, string | undefined>,
  dbPath: string | null,
): string {
  const rawId = typeof inp.session_id === "string" ? inp.session_id : "default";
  const safeId = rawId.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 64);
  if (dbPath !== null) {
    return path.join(path.dirname(dbPath), `stop-gate.${safeId}.escalate.json`);
  }
  const base = (typeof inp.cwd === "string" ? inp.cwd : undefined) ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  return path.join(base, ".groundwork", `stop-gate.${safeId}.escalate.json`);
}

export function escalationNudge(
  inp: Record<string, unknown>,
  env: Record<string, string | undefined>,
  dbPath: string | null,
): string | null {
  try {
    const tasks = inp.background_tasks;
    if (!Array.isArray(tasks)) return null;
    const matching = (tasks as Record<string, unknown>[]).filter(
      t => t.status === "running" && t.agent_type === "groundwork:implementer" && typeof t.id === "string" && (t.id as string).length > 0
    );
    if (matching.length === 0) return null;

    const stateFile = escalateStateFile(inp, env, dbPath);
    let state: EscalateState = { firstSeen: {}, nudged: [] };
    try {
      const raw = readFileSync(stateFile, "utf8");
      const parsed = JSON.parse(raw) as EscalateState;
      if (parsed && typeof parsed === "object") state = parsed;
    } catch { /* absent or corrupt — use default */ }

    const now = Date.now();
    const threshold = 15 * 60 * 1000;
    const nudgeLines: string[] = [];
    let stateChanged = false;

    for (const task of matching) {
      const id = task.id as string;
      if (state.nudged.includes(id)) continue;
      if (!(id in state.firstSeen)) {
        state.firstSeen[id] = new Date().toISOString();
        stateChanged = true;
      }
      const elapsedMs = now - Date.parse(state.firstSeen[id]);
      if (elapsedMs >= threshold) {
        const elapsedMin = Math.floor(elapsedMs / 60000);
        const desc = typeof task.description === "string" ? task.description : id;
        nudgeLines.push(`implementer-escalation: task "${desc}" has run for ${elapsedMin} min — split further or re-route to groundwork:junior-orchestrator`);
        state.nudged.push(id);
        stateChanged = true;
      }
    }

    if (stateChanged) {
      try {
        mkdirSync(path.dirname(stateFile), { recursive: true });
        writeFileSync(stateFile, JSON.stringify(state));
      } catch { }
    }

    if (nudgeLines.length === 0) return null;
    return nudgeLines.join("\n");
  } catch { return null; }
}

function appendNudge(result: HookResult, nudge: string): HookResult {
  try {
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    parsed.hookSpecificOutput = { hookEventName: "Stop", additionalContext: nudge };
    return { ...result, stdout: JSON.stringify(parsed) + "\n" };
  } catch {
    return result;
  }
}

export function run(input: unknown, env: Record<string, string | undefined>): HookResult {
  try {
    if (isEmbedded(env)) return allow();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : undefined;
    const sessionId = typeof inp.session_id === "string" ? inp.session_id : "default";
    const dbPath = resolveDb(env, cwd);
    if (!dbPath) {
      const base = allow("stop-gate: no active work store — session may end");
      const nudge = escalationNudge(inp, env, null);
      return nudge ? appendNudge(base, nudge) : base;
    }

    const compute = (): { result: HookResult; yieldResult: string | null } => {
      const { sliceCount, incomplete, incompleteIds, approved, holdActive, motiveDetails } = checkStore(dbPath);
      const cf = countFile(dbPath, sessionId);
      if (holdActive) {
        resetCount(cf);
        return { result: allow("stop-gate: HOLD active — human hold in effect, session may end"), yieldResult: null };
      }
      if (sliceCount === 0) {
        resetCount(cf);
        return { result: allow("stop-gate: no slices in store — nothing to gate"), yieldResult: null };
      }
      if (motiveDetails.length === 0) {
        resetCount(cf);
        return { result: allow("stop-gate: no active motives in scope — session may end"), yieldResult: null };
      }
      if (incomplete === 0 && approved) {
        const currentHead = getCurrentHead(cwd ?? process.cwd());
        const sessionStartTs = parseTs(getSessionStartTime(inp));
        const retiredMotives: string[] = [];
        let voidReason: string | null = null;
        for (const m of motiveDetails) {
          if (!m.approved) continue;
          if (m.sliceAddedAfterApproval) {
            voidReason = `stop-gate: APPROVE for motive '${m.motiveId}' is void — a slice was added after the approval. Re-run \`$GW gate approve\`.`;
            break;
          }
          if (m.approvalBaseCommit && currentHead && m.approvalBaseCommit !== currentHead) {
            const approvalTs = parseTs(m.approvalCreatedAt);
            if (!isNaN(sessionStartTs) && !isNaN(approvalTs) && approvalTs < sessionStartTs) {
              retiredMotives.push(m.motiveId);
            } else {
              voidReason = `stop-gate: APPROVE for motive '${m.motiveId}' is void — HEAD moved (approved at ${m.approvalBaseCommit.slice(0, 7)}, now ${currentHead.slice(0, 7)}). Re-run \`$GW gate approve\`.`;
              break;
            }
          }
        }
        if (!voidReason && retiredMotives.length > 0) {
          resetCount(cf);
          resetSig(sigFile(dbPath, sessionId));
          return { result: allow(`stop-gate: approval for motive(s) [${retiredMotives.join(", ")}] predates HEAD; run finished — not gating`), yieldResult: null };
        }
        if (!voidReason) {
          resetCount(cf);
          resetSig(sigFile(dbPath, sessionId));
          return { result: allow("stop-gate: all slices complete, gate approved"), yieldResult: null };
        }
        const yieldReason = detectYield(inp);
        if (yieldReason) {
          return { result: allow(`stop-gate: ${yieldReason}`), yieldResult: yieldReason };
        }
        const sf = sigFile(dbPath, sessionId);
        const voidSig = `${motiveDetails.filter(m => m.approvalBaseCommit).map(m => m.approvalBaseCommit).join(",")}:${currentHead ?? ""}`;
        const storedSig = readSig(sf);
        if (storedSig !== null) {
          if (storedSig === voidSig) {
            return { result: allow("stop-gate: override — consecutive block limit reached"), yieldResult: null };
          }
          resetSig(sf);
          resetCount(cf);
        }
        const voidCount = readCount(cf) + 1;
        writeCount(cf, voidCount);
        if (voidCount >= 4) {
          writeSig(sf, voidSig);
          resetCount(cf);
          process.stderr.write("stop-gate: 4th consecutive block — allowing; resolve store state manually\n");
          return { result: allow("stop-gate: override — consecutive block limit reached"), yieldResult: null };
        }
        if (voidCount >= 3) {
          return { result: block("stop-gate: condition appears externally unresolvable — stop trying; resolve store state manually before continuing."), yieldResult: null };
        }
        return { result: block(voidReason), yieldResult: null };
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
        const multiMotive = motiveDetails.length > 1;
        let ids: string;
        if (multiMotive) {
          // Name each motive that has incomplete slices.
          const parts = motiveDetails
            .filter(m => m.incomplete > 0)
            .map(m => `${m.motiveId}: [${m.incompleteIds.join(", ")}]`);
          ids = parts.join("; ");
        } else {
          ids = incompleteIds.join(", ");
        }
        return { result: block(`stop-gate: ${incomplete} slice(s) incomplete [${ids}]. Run \`$GW slice complete <id>\` when done, or \`$GW hold set --reason "<why>"\` to stop for a human.`), yieldResult: null };
      }
      // All slices complete but newest verdict is not APPROVE (or no verdict recorded).
      const sealRejectedMotive = motiveDetails.find(m => m.sealRejected);
      if (sealRejectedMotive) {
        return { result: block(`stop-gate: GATE_APPROVE for motive '${sealRejectedMotive.motiveId}' has invalid or missing HMAC seal — verdict rejected as forged. Re-run \`$GW gate approve\`.`), yieldResult: null };
      }
      const unapprovedMotive = motiveDetails.find(m => !m.approved);
      const verdictHint = unapprovedMotive ? ` (motive: ${unapprovedMotive.motiveId})` : "";
      return { result: block(`stop-gate: no GATE_APPROVE recorded as the newest verdict.${verdictHint} Record an advisor approval before ending.`), yieldResult: null };
    };

    const { result, yieldResult } = compute();
    writeDiag(dbPath, inp, yieldResult, result);
    const nudge = escalationNudge(inp, env, dbPath);
    return nudge ? appendNudge(result, nudge) : result;
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
