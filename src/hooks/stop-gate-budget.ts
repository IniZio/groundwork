import { Database } from "bun:sqlite";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";

export const DEFAULT_BUDGET_MIN = 15;

const BUDGET_RE = /^\s*budget:\s*(\d+)\s*m\b/i;
const PROMPT_READ_CAP = 256 * 1024;

/** Reads N from a `budget: <N>m` first line; later lines are ignored so quoted text cannot set a budget. */
export function parseBudget(prompt: string | null | undefined): number | null {
  if (typeof prompt !== "string") return null;
  const m = BUDGET_RE.exec(prompt.split("\n", 1)[0] ?? "");
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface BudgetDecision {
  task: string; action: "stop" | "extend"; minutes: number;
  /** When the decision was recorded; null when unknown (such a decision is ignored). */
  atMs: number | null;
  /** Transcript decisions come from this session and may name the task by description; db rows persist across sessions and match by id only. */
  sameSession: boolean;
}

function parseMs(v: unknown): number | null {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function toDecision(raw: unknown, atMs: number | null, sameSession: boolean): BudgetDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.task !== "string" || o.task.trim() === "") return null;
  if (o.action !== "stop" && o.action !== "extend") return null;
  let minutes = o.minutes;
  if (minutes === undefined && o.action === "stop") minutes = 0;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return null;
  return { task: o.task, action: o.action, minutes, atMs, sameSession };
}

export function readBudgetDecisionsFromDb(dbPath: string): BudgetDecision[] {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.query<{ payload: string; created_at: string }, []>(
        "SELECT payload, created_at FROM events WHERE event_type = 'BUDGET' ORDER BY id ASC",
      ).all();
      const out: BudgetDecision[] = [];
      for (const r of rows) {
        try {
          const d = toDecision(JSON.parse(r.payload), parseMs(r.created_at), false);
          if (d) out.push(d);
        } catch { /* skip malformed row */ }
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

const TYPE_RE = /--type(?:=|\s+)["']?BUDGET["']?(?![\w-])/;
const DATA_RE = /--data(?:=|\s+)(?:'([^']*)'|"((?:\\.|[^"\\])*)")/;

export function readBudgetDecisionsFromTranscript(transcriptPath: string): BudgetDecision[] {
  try {
    const out: BudgetDecision[] = [];
    for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
      if (!line.includes("event append")) continue;
      try {
        const e = JSON.parse(line) as { type?: unknown; timestamp?: unknown; message?: { content?: unknown } };
        if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
        for (const b of e.message.content as Record<string, unknown>[]) {
          if (!b || b.type !== "tool_use" || b.name !== "Bash") continue;
          const cmd = (b.input as Record<string, unknown> | undefined)?.command;
          if (typeof cmd !== "string" || !cmd.includes("event append") || !TYPE_RE.test(cmd)) continue;
          const m = DATA_RE.exec(cmd);
          if (!m) continue;
          // Inside double quotes the shell turns \" and \\ into the bare character.
          const json = m[1] ?? (m[2] ?? "").replace(/\\(["\\$`])/g, "$1");
          try {
            const d = toDecision(JSON.parse(json), parseMs(e.timestamp), true);
            if (d) out.push(d);
          } catch { /* skip unparseable --data */ }
        }
      } catch { /* skip bad line */ }
    }
    return out;
  } catch {
    return [];
  }
}

export function readDispatchPrompt(transcriptPath: string, sessionId: string, taskId: string): string | null {
  try {
    const file = path.join(path.dirname(transcriptPath), sessionId, "subagents", `agent-${taskId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
    const fd = openSync(file, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(PROMPT_READ_CAP);
      text = buf.toString("utf8", 0, readSync(fd, buf, 0, PROMPT_READ_CAP, 0));
    } finally {
      closeSync(fd);
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e: { type?: unknown; message?: { content?: unknown } };
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== "user") continue;
      const c = e.message?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        const t = (c as Record<string, unknown>[]).find(b => b && b.type === "text");
        return typeof t?.text === "string" ? t.text : null;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export interface BudgetTask { id: string; description: string; prompt: string | null; startMs: number }
export interface BudgetBreach { id: string; description: string; elapsedSec: number; budgetMin: number; extended: boolean }

export function evaluateBudgets(tasks: BudgetTask[], decisions: BudgetDecision[], nowMs: number): BudgetBreach[] {
  const breaches: BudgetBreach[] = [];
  for (const t of tasks) {
    const baseMin = parseBudget(t.prompt) ?? DEFAULT_BUDGET_MIN;
    let budgetMin = baseMin;
    let extended = false;
    let stopped = false;
    for (const d of decisions) {
      if (d.atMs === null || d.atMs < t.startMs) continue;
      const key = d.task.trim();
      if (key !== t.id && !(d.sameSession && key === t.description.trim())) continue;
      if (d.action === "stop") { stopped = true; break; }
      if (!extended) { budgetMin += Math.min(d.minutes, baseMin); extended = true; }
    }
    if (stopped) continue;
    const elapsedMs = nowMs - t.startMs;
    if (elapsedMs > budgetMin * 60000) {
      breaches.push({ id: t.id, description: t.description, elapsedSec: Math.floor(elapsedMs / 1000), budgetMin, extended });
    }
  }
  return breaches;
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m === 0 ? `${s}s` : s === 0 ? `${m}m` : `${m}m${s}s`;
}

export function budgetBlockReason(breaches: BudgetBreach[]): string {
  const lines = breaches.map(b =>
    `budget: task ${b.id} ("${b.description}") has run ${fmtElapsed(b.elapsedSec)}, over its ${b.budgetMin}m budget.` +
    (b.extended
      ? " It was already extended once; only a \"stop\" decision clears this block."
      : ` To extend: extend adds up to ${b.budgetMin} minutes once.`));
  const first = breaches[0]?.id ?? "<id>";
  return [
    "stop-gate: " + lines[0],
    ...lines.slice(1),
    "Record a decision for each task with:",
    `$GW event append --type BUDGET --data '{"task":"${first}","action":"stop"|"extend","minutes":N,"reason":"<measured reason>"}'`,
    "(substitute the real task id for each breached task.)",
    "\"stop\" = you stopped the child (TaskStop) or accept its result.",
    "\"extend\" adds N minutes once and needs a measured reason (e.g. progress seen in its output).",
  ].join("\n");
}
