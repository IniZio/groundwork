import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations, currentVersion } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import type { Migration } from "../../src/store/migrations.js";

describe("migration runner", () => {
  it("starts at version 0 on a fresh database", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL)");
    expect(currentVersion(db)).toBe(0);
    db.close();
  });

  it("applies all migrations in order from version 0 to head", () => {
    const db = new Database(":memory:");
    expect(currentVersion(db)).toBe(0);

    runMigrations(db, MIGRATIONS);

    const head = Math.max(...MIGRATIONS.map((m) => m.version));
    expect(currentVersion(db)).toBe(head);
    db.close();
  });

  it("records each applied migration in schema_version", () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS);

    const rows = db.query<{ version: number; description: string }, []>(
      "SELECT version, description FROM schema_version ORDER BY version"
    ).all();

    expect(rows).toHaveLength(MIGRATIONS.length);
    for (const m of MIGRATIONS) {
      expect(rows.some((r) => r.version === m.version)).toBe(true);
    }
    db.close();
  });

  it("is idempotent — re-running migrations does not duplicate rows or error", () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS);
    const versionAfterFirst = currentVersion(db);

    runMigrations(db, MIGRATIONS);
    expect(currentVersion(db)).toBe(versionAfterFirst);

    const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM schema_version").get()!;
    expect(count.n).toBe(MIGRATIONS.length);
    db.close();
  });

  it("creates the required tables after all migrations", () => {
    const db = new Database(":memory:");
    runMigrations(db, MIGRATIONS);

    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r) => r.name);

    expect(tables).toContain("slices");
    expect(tables).toContain("events");
    expect(tables).toContain("meta");
    expect(tables).toContain("schema_version");
    expect(tables).toContain("motives");
    // decisions and charter dropped in migration v4
    expect(tables).not.toContain("decisions");
    expect(tables).not.toContain("charter");
    db.close();
  });

  it("applies only new migrations when database is already at an intermediate version", () => {
    const db = new Database(":memory:");

    const head = Math.max(...MIGRATIONS.map((m) => m.version));
    runMigrations(db, MIGRATIONS);
    expect(currentVersion(db)).toBe(head);

    const vNext: Migration = {
      version: head + 1,
      description: "add test_table",
      up: "CREATE TABLE test_table (x INTEGER PRIMARY KEY)",
    };
    runMigrations(db, [...MIGRATIONS, vNext]);
    expect(currentVersion(db)).toBe(head + 1);

    const tables = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
    ).all();
    expect(tables).toHaveLength(1);
    db.close();
  });
});
