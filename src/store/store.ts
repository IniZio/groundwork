import { Database } from "bun:sqlite";
import { runMigrations } from "./migrations.js";
import { MIGRATIONS } from "./schema.js";

export type SliceStatus = "pending" | "in_progress" | "complete" | "archived";

export const EVENT_TYPES = [
  "GATE_APPROVE",
  "HOLD",
  "HOLD_CLEAR",
  "DECISION",
  "OBJECTIVE",
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
  motive_id: string;
}

export interface Motive {
  id: string;
  status: string;
  created_at: string;
}

export interface DecisionEvent {
  id: number;
  msg: string;
  created_at: string;
}

export interface Event {
  id: number;
  event_type: string;
  payload: string;
  created_at: string;
  motive_id: string;
}

export class WorkStore {
  private db: Database;
  private _motiveContext: string | null = null;

  get database(): Database { return this.db; }

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    runMigrations(this.db, MIGRATIONS);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Active motive context
  // ---------------------------------------------------------------------------

  /** Effective motive for all scoped queries. CLI sets this from --motive flag. */
  get activeMotive(): string {
    if (this._motiveContext) return this._motiveContext;
    return this.getMeta("active_motive") ?? "default";
  }

  /** Override the active motive for this store instance (in-memory, not persisted). */
  setMotiveContext(slug: string): void {
    this._motiveContext = slug;
  }

  // ---------------------------------------------------------------------------
  // Motive management
  // ---------------------------------------------------------------------------

  createMotive(slug: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO motives (id, status, created_at) VALUES (?, 'active', ?)",
      [slug, new Date().toISOString()]
    );
  }

  listMotives(): Motive[] {
    return this.db.query<Motive, []>("SELECT * FROM motives ORDER BY created_at").all();
  }

  getActiveMotive(): string {
    return this.activeMotive;
  }

  /** Persistently set the active motive (written to meta table). */
  setActiveMotive(slug: string): void {
    this.setMeta("active_motive", slug);
    this._motiveContext = slug;
  }

  completeMotive(slug: string): void {
    this.db.run("UPDATE motives SET status = 'complete' WHERE id = ?", [slug]);
  }

  // ---------------------------------------------------------------------------
  // Slices
  // ---------------------------------------------------------------------------

  insertSlice(slice: Omit<Slice, "created_at" | "completed_at" | "description" | "motive_id"> & { description?: string | null; motiveId?: string }): void {
    const motiveId = slice.motiveId ?? this.activeMotive;
    this.db.run(
      `INSERT INTO slices (id, wave, status, description, acceptance, blocked_by, covers_ac, decisions, created_at, motive_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [slice.id, slice.wave, slice.status, slice.description ?? null,
       slice.acceptance ?? null, slice.blocked_by ?? null,
       slice.covers_ac ?? null, slice.decisions ?? null, new Date().toISOString(), motiveId]
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

  getAllSlices(motiveId?: string): Slice[] {
    const mid = motiveId ?? this.activeMotive;
    return this.db.query<Slice, [string]>(
      "SELECT * FROM slices WHERE motive_id = ? ORDER BY wave, id"
    ).all(mid);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  appendEvent(event_type: string, payload: Record<string, unknown>, motiveId?: string): void {
    const mid = motiveId ?? this.activeMotive;
    this.db.run(
      "INSERT INTO events (event_type, payload, created_at, motive_id) VALUES (?, ?, ?, ?)",
      [event_type, JSON.stringify(payload), new Date().toISOString(), mid]
    );
  }

  getEvents(event_type?: string, motiveId?: string): Event[] {
    const mid = motiveId ?? this.activeMotive;
    if (event_type) {
      return this.db.query<Event, [string, string]>(
        "SELECT * FROM events WHERE event_type = ? AND motive_id = ? ORDER BY id"
      ).all(event_type, mid);
    }
    return this.db.query<Event, [string]>(
      "SELECT * FROM events WHERE motive_id = ? ORDER BY id"
    ).all(mid);
  }

  getDecisionEvents(motiveId?: string): DecisionEvent[] {
    const mid = motiveId ?? this.activeMotive;
    return this.db.query<Event, [string]>(
      "SELECT * FROM events WHERE event_type = 'DECISION' AND motive_id = ? ORDER BY id"
    ).all(mid).map(e => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(e.payload) as Record<string, unknown>; } catch { /* ignore */ }
      return { id: e.id, msg: String(payload.msg ?? ""), created_at: e.created_at };
    });
  }

  getObjective(motiveId?: string): string | null {
    const mid = motiveId ?? this.activeMotive;
    const ev = this.db.query<Event, [string]>(
      "SELECT * FROM events WHERE event_type = 'OBJECTIVE' AND motive_id = ? ORDER BY id DESC LIMIT 1"
    ).get(mid);
    if (!ev) return null;
    try {
      const p = JSON.parse(ev.payload) as Record<string, unknown>;
      return String(p.msg ?? "");
    } catch { return null; }
  }

  getHoldState(motiveId?: string): string | null {
    const mid = motiveId ?? this.activeMotive;
    const row = this.db.query<{ event_type: string; payload: string }, [string]>(
      "SELECT event_type, payload FROM events WHERE event_type IN ('HOLD','HOLD_CLEAR') AND motive_id = ? ORDER BY id DESC LIMIT 1"
    ).get(mid);
    if (!row || row.event_type === "HOLD_CLEAR") return null;
    try { return (JSON.parse(row.payload) as { reason?: string }).reason ?? "on hold"; }
    catch { return "on hold"; }
  }

  getLastEvent(event_type: string, motiveId?: string): Event | null {
    const mid = motiveId ?? this.activeMotive;
    return this.db.query<Event, [string, string]>(
      "SELECT * FROM events WHERE event_type = ? AND motive_id = ? ORDER BY id DESC LIMIT 1"
    ).get(event_type, mid);
  }

  // ---------------------------------------------------------------------------
  // Meta (store-wide, not motive-scoped)
  // ---------------------------------------------------------------------------

  getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [key, value]);
  }
}
