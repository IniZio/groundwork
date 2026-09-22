import { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  description: string;
  up: string;
}

export function runMigrations(db: Database, migrations: Migration[]): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL,
    description TEXT    NOT NULL
  )`);

  const applied = new Set<number>(
    db.query<{ version: number }, []>("SELECT version FROM schema_version").all().map((r) => r.version)
  );

  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  for (const m of ordered) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.up);
      db.run(
        "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        [m.version, new Date().toISOString(), m.description]
      );
    })();
  }
}

export function currentVersion(db: Database): number {
  const exists = db.query<{ n: number }, []>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();
  if (!exists || exists.n === 0) return 0;
  const row = db.query<{ version: number }, []>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_version"
  ).get();
  return row?.version ?? 0;
}
