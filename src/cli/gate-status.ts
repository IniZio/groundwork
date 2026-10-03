import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkStore } from "../store/store.js";
import { ingestInbox } from "../store/scope-inbox.js";
import { linksFor, requirement } from "../store/scope-link.js";
import { readPointer } from "../store/scope-pointer.js";

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

export interface GateStatus {
  v: 1;
  scope: "child" | "root" | "orphan";
  mode?: string;
  parent?: { motive: string; slice: string; link_id: string; root: string };
  slices: { open: number; complete: number };
  gate: string;
  approved_at?: string;
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
    const g = store.getNewestGateVerdict();
    if (g) {
      out.gate = g.event_type.replace("GATE_", "");
      let at = g.created_at;
      try {
        const c = (JSON.parse(g.payload) as { created_at?: unknown }).created_at;
        if (typeof c === "string") at = c;
      } catch { /* keep row time */ }
      out.approved_at = at;
    }
  } finally {
    store.close();
  }
  return out;
}
