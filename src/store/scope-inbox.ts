import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkStore } from "./store.js";
import { CHILD_GATE, CHILD_LINK, CHILD_REGISTER } from "./scope-pointer.js";

/** ND-6: the only event types a child may deliver through the inbox. */
export const INBOX_ACCEPTED_TYPES: readonly string[] = [CHILD_REGISTER, CHILD_GATE];

export interface InboxEnvelope {
  event_id: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface IngestReport {
  ingested: number;
  rejected: { file: string; reason: string }[];
}

export function inboxDir(parentRepoDir: string, linkId: string): string {
  return path.join(parentRepoDir, ".groundwork", "inbox", linkId);
}

function safeSegment(s: string): boolean {
  return s.length > 0 && s !== "." && s !== ".." && !/[\\/\0]/.test(s);
}

/**
 * Child-side write. Never touches parent SQLite. Writes a dot-prefixed temp file in the
 * same dir, then publishes it with linkSync + unlinkSync: link(2) fails with EEXIST rather
 * than replacing an existing target (renameSync would silently overwrite), and the final
 * name appears atomically with complete content. Final name is unique per event
 * (<iso-ts>-<uuid>.json) so concurrent writers never collide.
 */
export function writeInboxEvent(
  parentRepoDir: string,
  linkId: string,
  type: string,
  payload: Record<string, unknown>,
): { file: string; event_id: string } {
  if (!safeSegment(linkId)) throw new Error(`invalid link_id for inbox path: ${linkId}`);
  const dir = inboxDir(parentRepoDir, linkId);
  mkdirSync(dir, { recursive: true });
  const event_id = randomUUID();
  const name = `${new Date().toISOString().replace(/:/g, "-")}-${event_id}.json`;
  const tmp = path.join(dir, `.tmp-${randomUUID()}`);
  const final = path.join(dir, name);
  const env: InboxEnvelope = { event_id, type, payload };
  writeFileSync(tmp, JSON.stringify(env), { flag: "wx" });
  try {
    linkSync(tmp, final);
  } finally {
    unlinkSync(tmp);
  }
  return { file: final, event_id };
}

/**
 * Host-side ingest. Idempotent: events are keyed on envelope event_id stored in the row's
 * payload. Rejected files are LEFT IN PLACE (not moved): ingest stays read-only on the
 * inbox, a row that raced ahead of its CHILD_LINK can be accepted on a later pass, and
 * the report re-surfaces the bad file until a human removes it. Accepted rows are inserted
 * under the motive_id of the slice their CHILD_LINK belongs to, not the active motive.
 */
export function ingestInbox(store: WorkStore, parentRepoDir: string): IngestReport {
  const report: IngestReport = { ingested: 0, rejected: [] };
  const root = path.join(parentRepoDir, ".groundwork", "inbox");
  let linkDirs: string[];
  try { linkDirs = readdirSync(root).sort(); } catch { return report; }
  const db = store.database;
  // Same rule as scope-link.ts motiveOf: the slice's own motive, else the active one.
  const motiveOf = (slice: string): string => store.getSlice(slice)?.motive_id ?? store.activeMotive;

  const linkSlices = (linkId: string, mid: string): Set<string> => {
    const out = new Set<string>();
    const rows = db.query<{ payload: string }, [string, string]>(
      "SELECT payload FROM events WHERE event_type = ? AND motive_id = ?",
    ).all(CHILD_LINK, mid);
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload) as Record<string, unknown>;
        if (p.link_id === linkId && typeof p.slice === "string") out.add(p.slice);
      } catch { /* skip corrupt link row */ }
    }
    return out;
  };
  const seen = (eventId: string, mid: string): boolean =>
    db.query<{ n: number }, [string, string]>(
      "SELECT 1 AS n FROM events WHERE motive_id = ? AND json_extract(payload, '$.event_id') = ? LIMIT 1",
    ).get(mid, eventId) !== null;

  for (const linkId of linkDirs) {
    const dir = path.join(root, linkId);
    let isDir = false;
    try { isDir = statSync(dir).isDirectory(); } catch { /* vanished */ }
    if (!isDir) continue;
    let files: string[];
    try { files = readdirSync(dir).sort(); } catch { continue; }
    for (const f of files) {
      if (f.startsWith(".") || !f.endsWith(".json")) continue;
      const rel = path.join(linkId, f);
      const reject = (reason: string) => report.rejected.push({ file: rel, reason });
      let env: Record<string, unknown>;
      try {
        const raw: unknown = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { reject("not a JSON object"); continue; }
        env = raw as Record<string, unknown>;
      } catch { reject("unparseable JSON"); continue; }
      const { event_id, type, payload } = env;
      if (typeof event_id !== "string" || event_id === "") { reject("missing event_id"); continue; }
      if (typeof type !== "string" || !INBOX_ACCEPTED_TYPES.includes(type)) {
        reject(`event type not allowed from inbox: ${String(type)}`); continue;
      }
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { reject("payload not an object"); continue; }
      const p = payload as Record<string, unknown>;
      if (p.link_id !== linkId) { reject("link_id does not match inbox directory"); continue; }
      if (typeof p.slice !== "string") { reject("missing slice"); continue; }
      const mid = motiveOf(p.slice);
      const slices = linkSlices(linkId, mid);
      if (slices.size === 0) { reject("unknown link_id (no CHILD_LINK recorded)"); continue; }
      if (!slices.has(p.slice)) { reject("slice does not match recorded CHILD_LINK"); continue; }
      if (seen(event_id, mid)) continue;
      store.appendEvent(type, { ...p, event_id }, mid);
      report.ingested++;
    }
  }
  return report;
}
