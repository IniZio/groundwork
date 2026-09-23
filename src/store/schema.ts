import type { Migration } from "./migrations.js";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "initial schema: slices, decisions, events, charter",
    up: `
      CREATE TABLE slices (
        id          TEXT PRIMARY KEY,
        wave        INTEGER NOT NULL DEFAULT 0,
        status      TEXT    NOT NULL DEFAULT 'pending',
        acceptance  TEXT,
        blocked_by  TEXT,
        covers_ac   TEXT,
        decisions   TEXT,
        created_at  TEXT    NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE decisions (
        id          TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'proposed',
        kind        TEXT NOT NULL DEFAULT 'DECISION',
        decision    TEXT NOT NULL,
        rationale   TEXT,
        alternatives TEXT,
        supersedes  TEXT,
        resolves    TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type  TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL
      );

      CREATE TABLE charter (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'active',
        objective   TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    description: "D-12 retention triggers: prohibit deletion of completed/archived slices, accepted decisions, and any events",
    up: `
      CREATE TRIGGER prevent_delete_completed_slices
      BEFORE DELETE ON slices
      WHEN OLD.status IN ('complete', 'archived')
      BEGIN
        SELECT RAISE(ABORT, 'D-12: completed/archived slice deletion is prohibited; use archiveSlice()');
      END;

      CREATE TRIGGER prevent_delete_events
      BEFORE DELETE ON events
      BEGIN
        SELECT RAISE(ABORT, 'D-12: events table is append-only; deletion is prohibited');
      END;

      CREATE TRIGGER prevent_delete_accepted_decisions
      BEFORE DELETE ON decisions
      WHEN OLD.status IN ('accepted', 'superseded')
      BEGIN
        SELECT RAISE(ABORT, 'D-12: accepted/superseded decision deletion is prohibited');
      END;
    `,
  },
  {
    version: 3,
    description: "add description column to slices; meta table for CLI token",
    up: `
      ALTER TABLE slices ADD COLUMN description TEXT;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
  {
    version: 4,
    description: "D11: drop dead decisions and charter tables; decisions sourced from DECISION events",
    up: `
      DROP TRIGGER IF EXISTS prevent_delete_accepted_decisions;
      DROP TABLE IF EXISTS decisions;
      DROP TABLE IF EXISTS charter;
    `,
  },
];
