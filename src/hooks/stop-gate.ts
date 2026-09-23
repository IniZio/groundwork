import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";

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

export function run(input: unknown, env: Record<string, string | undefined>): HookResult {
  try {
    if (isEmbedded(env)) return allow();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : undefined;
    const sessionId = typeof inp.session_id === "string" ? inp.session_id : "default";
    const dbPath = resolveDb(env, cwd);
    if (!dbPath) return allow("stop-gate: no active work store — session may end");
    const { sliceCount, incomplete, incompleteIds, approved, holdActive } = checkStore(dbPath);
    const cf = countFile(dbPath, sessionId);
    if (holdActive) {
      resetCount(cf);
      return allow("stop-gate: HOLD active — human hold in effect, session may end");
    }
    if (sliceCount === 0) {
      resetCount(cf);
      return allow("stop-gate: no slices in store — nothing to gate");
    }
    if (incomplete === 0 && approved) {
      resetCount(cf);
      return allow("stop-gate: all slices complete, gate approved");
    }
    const count = readCount(cf) + 1;
    writeCount(cf, count);
    if (count >= 4) {
      resetCount(cf);
      process.stderr.write("stop-gate: 4th consecutive block — allowing; resolve store state manually\n");
      return allow("stop-gate: override — consecutive block limit reached");
    }
    if (count >= 3) {
      return block("stop-gate: condition appears externally unresolvable — stop trying; resolve store state manually before continuing.");
    }
    if (incomplete > 0) {
      const ids = incompleteIds.join(", ");
      return block(`stop-gate: ${incomplete} slice(s) incomplete [${ids}]. Run \`$GW slice complete <id>\` when done, or \`$GW hold set --reason "<why>"\` to stop for a human.`);
    }
    return block("stop-gate: no GATE_APPROVE event recorded. Record an advisor approval before ending.");
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
