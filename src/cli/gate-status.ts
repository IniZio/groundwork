import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkStore } from "../store/store.js";
import { ingestInbox } from "../store/scope-inbox.js";
import { linksFor, requirement } from "../store/scope-link.js";
import { readPointer } from "../store/scope-pointer.js";
import { readSealKeyForDb } from "../store/key-store.js";
import { verifyApprovalSeal } from "../store/gate-seal.js";

export type GuardResult =
  | { ok: true; evidence: string[] }
  | { ok: false; message: string; evidence: string[] };

/** Completion guard for `slice complete`: ingest child inbox first, then enforce requirement(). */
export function completionGuard(
  store: WorkStore,
  o: { slice: string; repoDir: string },
): GuardResult {
  ingestInbox(store, o.repoDir);
  const r = requirement(store, o.slice, o.repoDir);
  if (r.satisfied) return { ok: true, evidence: r.evidence };
  let message = r.missing ?? "child scope requirement not met";
  const live = linksFor(store, o.slice).find((l) => !l.unlink);
  if (live?.mode === "direct") {
    message = `direct mode: no host verification recorded after link ${live.link_id}; run gw scope verify`;
  } else if (live && message.startsWith("no child gate verdict")) {
    message = `newest child link ${live.link_id} has no APPROVE`;
  } else if (message.startsWith("newest child verdict is ")) {
    message = message.replace("newest child verdict", "latest child verdict");
  }
  return { ok: false, message, evidence: r.evidence };
}

/** Newest gate verdict with GATE_APPROVE downgraded unless its seal verifies. */
export function sealedGateVerdict(
  store: WorkStore,
  dbPath: string,
): { approved: boolean; verdict: string | null; reason?: string; at?: string } {
  const g = store.getNewestGateVerdict();
  if (!g) return { approved: false, verdict: null };
  const verdict = g.event_type.replace("GATE_", "");
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(g.payload) as Record<string, unknown>; } catch { /* unsealed */ }
  const at = typeof payload.created_at === "string" ? payload.created_at : g.created_at;
  if (g.event_type !== "GATE_APPROVE") return { approved: false, verdict, at };
  const v = verifyApprovalSeal({ motiveId: store.activeMotive, payload }, readSealKeyForDb(dbPath));
  return v.ok ? { approved: true, verdict, at } : { approved: false, verdict, reason: v.reason, at };
}

export interface GateStatus {
  v: 1;
  scope: "child" | "root" | "orphan";
  mode?: string;
  parent?: { motive: string; slice: string; link_id: string; root: string };
  slices: { open: number; complete: number };
  gate: string;
  approved_at?: string;
  seal_reason?: string;
}

function git(cwd: string, arg: string): string | null {
  const r = spawnSync("git", ["rev-parse", arg], { cwd, encoding: "utf8", timeout: 3000 });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

function isMainWorktree(cwd: string): boolean {
  const gd = git(cwd, "--git-dir");
  const cd = git(cwd, "--git-common-dir");
  if (!gd || !cd) return false;
  return path.resolve(cwd, gd) === path.resolve(cwd, cd);
}

export function gateStatus(o: { cwd: string }): GateStatus {
  const ptr = readPointer(o.cwd);
  const out: GateStatus = {
    v: 1,
    scope: ptr ? "child" : isMainWorktree(o.cwd) ? "root" : "orphan",
    slices: { open: 0, complete: 0 },
    gate: "none",
  };
  if (ptr) {
    out.mode = ptr.mode;
    out.parent = { motive: ptr.motive, slice: ptr.slice, link_id: ptr.link_id, root: ptr.root };
  }
  const db = process.env.GROUNDWORK_DB ?? path.join(o.cwd, ".groundwork", "work.db");
  if (!existsSync(db)) return out;
  const store = new WorkStore(db);
  try {
    // Same derivation as main.ts cmdSliceStatus (done = complete|archived) and cmdCompile (newest GATE_* event).
    const slices = store.getAllSlices();
    const done = slices.filter((s) => s.status === "complete" || s.status === "archived").length;
    out.slices = { open: slices.length - done, complete: done };
    const g = sealedGateVerdict(store, db);
    if (g.verdict) {
      out.gate = g.verdict === "APPROVE" && !g.approved ? "pending" : g.verdict;
      if (g.reason) out.seal_reason = g.reason;
      if (g.at) out.approved_at = g.at;
    }
  } finally {
    store.close();
  }
  return out;
}

/** pr-body sections covered by H1/H2 approval; Review focus and Proof are deliberately excluded. */
export const HASHED_PR_BODY_HEADINGS = ["Summary", "Why", "Changes", "Impact"] as const;
