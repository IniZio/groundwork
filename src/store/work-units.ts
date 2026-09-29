import { Database } from "bun:sqlite";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

const DAY_MS = 86_400_000;

/** Active work-unit slug, or null when unset/"default"/no store. Never creates the DB. */
export function activeSlug(root: string): string | null {
  const p = path.join(root, ".groundwork", "work.db");
  if (!existsSync(p)) return null;
  let db: Database | undefined;
  try {
    db = new Database(p, { readonly: true });
    const row = db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get("active_motive");
    const v = row?.value;
    return v && v !== "default" ? v : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export function listUnits(root: string): string[] {
  const dir = path.join(root, ".groundwork", "work");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function maxMtimeMs(p: string): number {
  const st = lstatSync(p); // lstat: never follow symlinks (loops, symlinked trees)
  let max = st.mtimeMs;
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) max = Math.max(max, maxMtimeMs(path.join(p, name)));
  }
  return max;
}

/** Whole days since the newest mtime anywhere under unitDir. */
export function idleDays(unitDir: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - maxMtimeMs(unitDir)) / DAY_MS));
}
