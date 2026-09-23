import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { WorkStore } from "../../src/store/store.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

let store: WorkStore;

beforeEach(() => { store = new WorkStore(":memory:"); });
afterEach(() => { store.close(); });

function seedCompleted(id: string): void {
  store.insertSlice({ id, wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
  store.completeSlice(id);
}

describe("D-12 retention guarantee — structural (trigger-layer)", () => {
  it("raw DELETE on a completed slice throws at the SQLite trigger layer, not the JS check", () => {
    seedCompleted("S-raw");
    const db = store.database;

    expect(() => db.run("DELETE FROM slices WHERE id = ?", ["S-raw"])).toThrow(
      "D-12: completed/archived slice deletion is prohibited"
    );
    expect(store.getSlice("S-raw")).not.toBeNull();
  });

  it("raw DELETE on an archived slice also throws — archive is not a deletion loophole", () => {
    seedCompleted("S-arch");
    store.archiveSlice("S-arch", "test");
    const db = store.database;

    expect(() => db.run("DELETE FROM slices WHERE id = ?", ["S-arch"])).toThrow(
      "D-12: completed/archived slice deletion is prohibited"
    );
    expect(store.getSlice("S-arch")).not.toBeNull();
  });

  it("raw DELETE on events throws — audit log is append-only at the trigger layer", () => {
    store.appendEvent("TEST_EVENT", { x: 1 });
    const id = store.getEvents()[0].id;
    const db = store.database;

    expect(() => db.run("DELETE FROM events WHERE id = ?", [id])).toThrow(
      "D-12: events table is append-only"
    );
    expect(store.getEvents()).toHaveLength(1);
  });

  it("BITE PROOF: drop trigger → raw DELETE succeeds (row disappears) — trigger is the guard", () => {
    const db2 = new Database(":memory:");
    runMigrations(db2, MIGRATIONS);
    db2.exec("DROP TRIGGER IF EXISTS prevent_delete_completed_slices");

    db2.run("INSERT INTO slices (id, wave, status, created_at) VALUES ('S-bite', 1, 'complete', ?)", [new Date().toISOString()]);
    expect(() => db2.run("DELETE FROM slices WHERE id = ?", ["S-bite"])).not.toThrow();

    const gone = db2.query<{ id: string }, [string]>("SELECT id FROM slices WHERE id = ?").get("S-bite");
    expect(gone).toBeNull();

    db2.close();
  });

  it("BITE PROOF: with trigger in place → raw DELETE throws and row survives", () => {
    const db3 = new Database(":memory:");
    runMigrations(db3, MIGRATIONS);

    db3.run("INSERT INTO slices (id, wave, status, created_at) VALUES ('S-guard', 1, 'complete', ?)", [new Date().toISOString()]);
    expect(() => db3.run("DELETE FROM slices WHERE id = ?", ["S-guard"])).toThrow(
      "D-12: completed/archived slice deletion is prohibited"
    );

    const still = db3.query<{ id: string }, [string]>("SELECT id FROM slices WHERE id = ?").get("S-guard");
    expect(still).not.toBeNull();

    db3.close();
  });
});

describe("D-12 retention guarantee — API layer", () => {
  it("deleteSlice throws on a completed slice at the JS layer too (better error message)", () => {
    seedCompleted("S-api");
    expect(() => store.deleteSlice("S-api")).toThrow(
      "Cannot delete completed slice 'S-api' without a logged retention action"
    );
    expect(store.getSlice("S-api")).not.toBeNull();
  });

  it("archiveSlice logs a RETENTION_ACTION event and transitions status to archived", () => {
    seedCompleted("S-retire");
    store.archiveSlice("S-retire", "superseded by S-999");

    const events = store.getEvents("RETENTION_ACTION");
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload) as Record<string, unknown>;
    expect(payload.slice_id).toBe("S-retire");
    expect(payload.reason).toBe("superseded by S-999");

    expect(store.getSlice("S-retire")?.status).toBe("archived");
  });

  it("archiveSlice path is unaffected by the delete trigger (uses UPDATE not DELETE)", () => {
    seedCompleted("S-upd");
    expect(() => store.archiveSlice("S-upd", "promotion")).not.toThrow();
    expect(store.getSlice("S-upd")?.status).toBe("archived");
  });

  it("deleteSlice succeeds on pending/in_progress slices — trigger allows it", () => {
    store.insertSlice({ id: "S-pend", wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
    expect(() => store.deleteSlice("S-pend")).not.toThrow();
    expect(store.getSlice("S-pend")).toBeNull();
  });

  it("SLICE_COMPLETE event is recorded when a slice is completed", () => {
    seedCompleted("S-ev");
    const events = store.getEvents("SLICE_COMPLETE");
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload).slice_id).toBe("S-ev");
  });
});
