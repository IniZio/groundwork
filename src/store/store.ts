import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations.js";
import { MIGRATIONS } from "./schema.js";

export type SliceStatus = "pending" | "in_progress" | "complete" | "archived";
export type DecisionStatus = "proposed" | "accepted" | "superseded";

export const EVENT_TYPES = [
  "GATE_APPROVE",
  "HOLD",
  "HOLD_CLEAR",
  "DECISION",
  "PAUSE",
  "VERIFICATION",
  "FAILURE",
  "MILESTONE",
  "HANDOFF",
  "SESSION_START",
  "CHECKPOINT",
  "SLICE_COMPLETE",
  "RETENTION_ACTION",
] as const;
export type EventType = typeof EVENT_TYPES[number];

export interface Slice {
  id: string;
  wave: number;
  status: SliceStatus;
  description: string | null;
  acceptance: string | null;
  blocked_by: string | null;
  covers_ac: string | null;
  decisions: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Charter {
  id: string;
  title: string;
  status: string;
  objective: string | null;
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string;
  status: DecisionStatus;
  kind: string;
  decision: string;
  rationale: string | null;
  alternatives: string | null;
  supersedes: string | null;
  resolves: string | null;
  created_at: string;
}

export interface Event {
  id: number;
  event_type: string;
  payload: string;
  created_at: string;
}

export class WorkStore {
  private db: Database;

  get database(): Database { return this.db; }

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    runMigrations(this.db, MIGRATIONS);
  }

  close(): void {
    this.db.close();
  }

  insertSlice(slice: Omit<Slice, "created_at" | "completed_at" | "description"> & { description?: string | null }): void {
    this.db.run(
      `INSERT INTO slices (id, wave, status, description, acceptance, blocked_by, covers_ac, decisions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [slice.id, slice.wave, slice.status, slice.description ?? null,
       slice.acceptance ?? null, slice.blocked_by ?? null,
       slice.covers_ac ?? null, slice.decisions ?? null, new Date().toISOString()]
    );
  }

  getSlice(id: string): Slice | null {
    return this.db.query<Slice, [string]>("SELECT * FROM slices WHERE id = ?").get(id);
  }

  completeSlice(id: string): void {
    const now = new Date().toISOString();
    this.db.run(
      "UPDATE slices SET status = 'complete', completed_at = ? WHERE id = ?",
      [now, id]
    );
    this.appendEvent("SLICE_COMPLETE", { slice_id: id, completed_at: now });
  }

  deleteSlice(id: string): void {
    const row = this.getSlice(id);
    if (!row) return;
    if (row.status === "complete") {
      throw new Error(
        `Cannot delete completed slice '${id}' without a logged retention action. Call archiveSlice() instead.`
      );
    }
    this.db.run("DELETE FROM slices WHERE id = ?", [id]);
  }

  archiveSlice(id: string, reason: string): void {
    const row = this.getSlice(id);
    if (!row) throw new Error(`Slice '${id}' not found`);
    this.appendEvent("RETENTION_ACTION", { slice_id: id, reason, prior_status: row.status });
    this.db.run("UPDATE slices SET status = 'archived' WHERE id = ?", [id]);
  }

  appendEvent(event_type: string, payload: Record<string, unknown>): void {
    this.db.run(
      "INSERT INTO events (event_type, payload, created_at) VALUES (?, ?, ?)",
      [event_type, JSON.stringify(payload), new Date().toISOString()]
    );
  }

  getEvents(event_type?: string): Event[] {
    if (event_type) {
      return this.db.query<Event, [string]>("SELECT * FROM events WHERE event_type = ? ORDER BY id").all(event_type);
    }
    return this.db.query<Event, []>("SELECT * FROM events ORDER BY id").all();
  }

  insertDecision(d: Omit<Decision, "created_at">): void {
    this.db.run(
      `INSERT INTO decisions (id, status, kind, decision, rationale, alternatives, supersedes, resolves, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.id, d.status, d.kind, d.decision, d.rationale ?? null,
       d.alternatives ?? null, d.supersedes ?? null, d.resolves ?? null,
       new Date().toISOString()]
    );
  }

  upsertCharter(id: string, title: string, objective: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO charter (id, title, status, objective, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, objective = excluded.objective, updated_at = excluded.updated_at`,
      [id, title, objective, now, now]
    );
  }

  getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
  }

  getAllSlices(): Slice[] {
    return this.db.query<Slice, []>("SELECT * FROM slices ORDER BY wave, id").all();
  }

  getAllDecisions(): Decision[] {
    return this.db.query<Decision, []>("SELECT * FROM decisions ORDER BY created_at").all();
  }

  getHoldState(): string | null {
    const row = this.db.query<{ event_type: string; payload: string }, []>(
      "SELECT event_type, payload FROM events WHERE event_type IN ('HOLD','HOLD_CLEAR') ORDER BY id DESC LIMIT 1"
    ).get();
    if (!row || row.event_type === "HOLD_CLEAR") return null;
    try { return (JSON.parse(row.payload) as { reason?: string }).reason ?? "on hold"; }
    catch { return "on hold"; }
  }

  getLastEvent(event_type: string): Event | null {
    return this.db.query<Event, [string]>(
      "SELECT * FROM events WHERE event_type = ? ORDER BY id DESC LIMIT 1"
    ).get(event_type);
  }

  getCharter(): Charter | null {
    return this.db.query<Charter, []>("SELECT * FROM charter LIMIT 1").get();
  }
}
