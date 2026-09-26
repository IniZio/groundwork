import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LedgerOpts {
  dir?: string;
  now?: () => number;
}

export interface FixRecord {
  kind: "fix";
  file: string;
  fixedHash: string;
  removed: string[];
  reason: string;
  source: "gate" | "housekeep";
  ts: string;
}

interface DeliveredRecord {
  kind: "delivered";
  file: string;
  fixedHash: string;
  key: string;
  ts: string;
}

type LedgerRecord = FixRecord | DeliveredRecord;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function ledgerPath(opts?: LedgerOpts): string {
  const dir =
    opts?.dir ??
    process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR ??
    path.join(os.tmpdir(), `house-rules-autofix-ledger-${process.getuid?.() ?? "u"}`);
  return path.join(dir, "ledger.jsonl");
}

export function deliveryKey(
  sessionId: string | undefined,
  agentId: string | undefined
): string {
  return `${sessionId || "nosession"}:${agentId || "main"}`;
}

// O_NOFOLLOW is available on Linux and macOS; falls back to 0 on Windows.
const O_NOFOLLOW_FLAG: number = (constants as Record<string, number>).O_NOFOLLOW ?? 0;

// Validate (and if absent, create) the ledger directory.
// Returns false if the dir is unsafe; callers must treat false as a no-op signal.
function ensureDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return false;
  }
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return false;
    if (st.mode & 0o022) return false;
    return true;
  } catch {
    return false;
  }
}

function safeAppend(lp: string, data: string): void {
  if (O_NOFOLLOW_FLAG !== 0) {
    try {
      const flags =
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | O_NOFOLLOW_FLAG;
      const fd = openSync(lp, flags, 0o600);
      try {
        writeSync(fd, data);
      } finally {
        closeSync(fd);
      }
    } catch {
    }
  } else {
    try {
      const st = lstatSync(lp);
      if (st.isSymbolicLink()) return;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
    try {
      const fd = openSync(lp, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o600);
      try {
        writeSync(fd, data);
      } finally {
        closeSync(fd);
      }
    } catch {
    }
  }
}

function readRecords(lp: string): LedgerRecord[] {
  try {
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(lp);
    } catch {
      return [];
    }
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const raw = readFileSync(lp, "utf8");
    const records: LedgerRecord[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (obj && typeof obj.kind === "string") records.push(obj as LedgerRecord);
      } catch {
        // skip malformed
      }
    }
    return records;
  } catch {
    return [];
  }
}

const MAX_LINES = 500;
const KEEP_LINES = 300;
const KEEP_WINDOW_MS = 24 * 60 * 60 * 1000;

function maybeBound(lp: string, _dir: string, now: () => number): void {
  try {
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(lp);
    } catch {
      return;
    }
    if (st.isSymbolicLink() || !st.isFile()) return;

    const raw = readFileSync(lp, "utf8");
    const allLines = raw.split("\n").filter(l => l.trim());
    if (allLines.length <= MAX_LINES) return;

    const cutoff = now() - KEEP_WINDOW_MS;

    interface Parsed { line: string; rec: LedgerRecord | null; ts: number }
    const parsed: Parsed[] = [];
    for (const line of allLines) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.kind === "string") {
          const ts = obj.ts ? new Date(obj.ts).getTime() : 0;
          parsed.push({ line, rec: obj as LedgerRecord, ts });
        }
      } catch {
        // malformed — dropped at trim
      }
    }

    const inWindowFixes = parsed.filter(p => p.rec?.kind === "fix" && p.ts >= cutoff);
    inWindowFixes.sort((a, b) => a.ts - b.ts);
    const keptFixes = inWindowFixes.slice(-KEEP_LINES);
    const keptFixLines = new Set<string>(keptFixes.map(p => p.line));
    const keptFixHashes = new Set<string>(
      keptFixes.map(p => (p.rec as FixRecord).fixedHash)
    );

    const finalLines: string[] = [];
    for (const p of parsed) {
      if (p.rec?.kind === "fix") {
        if (keptFixLines.has(p.line)) finalLines.push(p.line);
      } else if (p.rec?.kind === "delivered") {
        if (keptFixHashes.has((p.rec as DeliveredRecord).fixedHash)) finalLines.push(p.line);
      }
    }

    const tmp = lp + `.tmp-${process.pid}`;
    writeFileSync(tmp, finalLines.join("\n") + (finalLines.length ? "\n" : ""), { mode: 0o600 });
    renameSync(tmp, lp);
  } catch {
    // never throws
  }
}

export function appendFix(
  rec: { file: string; fixedContent: string; removed: string[]; reason: string; source: "gate" | "housekeep" },
  opts?: LedgerOpts
): void {
  try {
    const lp = ledgerPath(opts);
    const dir = path.dirname(lp);
    if (!ensureDir(dir)) return;
    const ts = new Date((opts?.now ?? Date.now)()).toISOString();
    const entry: FixRecord = {
      kind: "fix",
      file: path.resolve(rec.file),
      fixedHash: sha256(rec.fixedContent),
      removed: rec.removed,
      reason: rec.reason,
      source: rec.source,
      ts,
    };
    safeAppend(lp, JSON.stringify(entry) + "\n");
    maybeBound(lp, dir, opts?.now ?? Date.now);
  } catch {
    // never throws
  }
}

export function pendingNotices(
  file: string,
  deliveryKey: string,
  opts?: LedgerOpts
): FixRecord[] {
  try {
    const lp = ledgerPath(opts);
    const records = readRecords(lp);
    const resolvedFile = path.resolve(file);

    const deliveredHashes = new Set<string>();
    for (const r of records) {
      if (
        r.kind === "delivered" &&
        r.file === resolvedFile &&
        r.key === deliveryKey
      ) {
        deliveredHashes.add((r as DeliveredRecord).fixedHash);
      }
    }

    const pending: FixRecord[] = [];
    for (const r of records) {
      if (
        r.kind === "fix" &&
        r.file === resolvedFile &&
        !deliveredHashes.has(r.fixedHash)
      ) {
        pending.push(r as FixRecord);
      }
    }
    return pending;
  } catch {
    return [];
  }
}

export function markDelivered(
  file: string,
  deliveryKey: string,
  fixedHashes: string[],
  opts?: LedgerOpts
): void {
  try {
    const lp = ledgerPath(opts);
    const dir = path.dirname(lp);
    if (!ensureDir(dir)) return;
    const resolvedFile = path.resolve(file);
    const ts = new Date((opts?.now ?? Date.now)()).toISOString();
    for (const fixedHash of fixedHashes) {
      const entry: DeliveredRecord = {
        kind: "delivered",
        file: resolvedFile,
        fixedHash,
        key: deliveryKey,
        ts,
      };
      safeAppend(lp, JSON.stringify(entry) + "\n");
    }
    maybeBound(lp, dir, opts?.now ?? Date.now);
  } catch {
    // never throws
  }
}

export function removedTextsFor(
  file: string,
  opts?: LedgerOpts
): { text: string; reason: string; ts: string }[] {
  try {
    const lp = ledgerPath(opts);
    const records = readRecords(lp);
    const resolvedFile = path.resolve(file);
    const results: { text: string; reason: string; ts: string }[] = [];
    for (const r of records) {
      if (r.kind === "fix" && r.file === resolvedFile) {
        for (const text of (r as FixRecord).removed) {
          results.push({ text, reason: r.reason, ts: r.ts });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function normalizeCommentText(s: string): string {
  let t = s.trim();
  if (t.startsWith("/*") && t.endsWith("*/")) {
    t = t.slice(2, -2).trim();
  }
  if (t.startsWith("///")) t = t.slice(3);
  else if (t.startsWith("//")) t = t.slice(2);
  else if (t.startsWith("#")) t = t.slice(1);
  else if (t.startsWith("--")) t = t.slice(2);
  else if (/^\*/.test(t.trimStart())) t = t.trimStart().slice(1);
  return t.trim().replace(/\s+/g, " ");
}

export function formatNotice(file: string, recs: FixRecord[]): string {
  const n = recs.reduce((acc, r) => acc + r.removed.length, 0);
  const latestTs = recs.reduce((max, r) => (r.ts > max ? r.ts : max), "");
  return (
    `house-rules autofix removed ${n} over-budget comment(s) from ${file} at ${latestTs}` +
    ` — automatic, not another agent or a merge. Re-read before editing; don't re-add them.` +
    ` If a comment is truly needed it should explain a non-obvious why.`
  );
}
