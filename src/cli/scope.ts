import { existsSync, realpathSync, rmSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { GATE_VERDICTS, WorkStore, type GateVerdict } from "../store/store.js";
import { ensureSealKey, ensureWriteToken } from "../store/key-store.js";
import { createLink, linksFor, type ScopeLink } from "../store/scope-link.js";
import { writeInboxEvent } from "../store/scope-inbox.js";
import {
  CHILD_GATE,
  CHILD_REGISTER,
  SCOPE_MODES,
  SCOPE_UNLINK,
  SCOPE_VERIFY,
  readPointer,
  sameRoot,
  type ChildGatePayload,
  type ChildRegisterPayload,
  type ScopeMode,
  type ScopePointer,
  type ScopeUnlinkPayload,
  type ScopeVerifyPayload,
} from "../store/scope-pointer.js";

/** Child-store meta event recording which parent/link this store belongs to. Owner: NS-01 may relocate. */
export const SCOPE_PARENT = "SCOPE_PARENT";

export type ScopeErrorCode =
  | "BAD_MODE" | "NO_CHILD_DIR" | "SELF_LINK" | "NO_LIVE_LINK" | "REASON_REQUIRED"
  | "BAD_CITATION" | "NOT_DIRECT" | "PARENT_UNREACHABLE" | "BAD_VERDICT" | "BAD_BASE_COMMIT" | "UNCOMMITTED_WORK";

export class ScopeError extends Error {
  constructor(readonly code: ScopeErrorCode, message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

const motiveOf = (store: WorkStore, slice: string): string =>
  store.getSlice(slice)?.motive_id ?? store.activeMotive;

export function scopeLink(
  store: WorkStore,
  o: { childDir: string; slice: string; mode?: string; repoDir: string },
): ScopeLink {
  const mode = o.mode ?? "delegate";
  if (!(SCOPE_MODES as readonly string[]).includes(mode)) {
    throw new ScopeError("BAD_MODE", `mode must be one of ${SCOPE_MODES.join("|")}, got '${mode}'`);
  }
  if (!existsSync(o.childDir) || !statSync(o.childDir).isDirectory()) {
    throw new ScopeError("NO_CHILD_DIR", `child dir does not exist: ${o.childDir}`);
  }
  if (realpathSync(o.childDir) === realpathSync(o.repoDir)) {
    throw new ScopeError("SELF_LINK", "child dir is the parent repo; cannot link a tree to itself");
  }
  return createLink(store, {
    childDir: o.childDir, slice: o.slice, mode: mode as ScopeMode,
    motive: motiveOf(store, o.slice), repoDir: o.repoDir,
  });
}

function liveLink(store: WorkStore, slice: string): ScopeLink {
  const l = linksFor(store, slice).find((x) => !x.unlink);
  if (!l) throw new ScopeError("NO_LIVE_LINK", `no live link for slice '${slice}'`);
  return l;
}

export function scopeUnlink(store: WorkStore, o: { slice: string; reason: string }): ScopeLink {
  if (!o.reason || !o.reason.trim()) throw new ScopeError("REASON_REQUIRED", "unlink requires a non-empty reason");
  const l = liveLink(store, o.slice);
  const p: ScopeUnlinkPayload = { link_id: l.link_id, slice: o.slice, reason: o.reason.trim() };
  store.appendEvent(SCOPE_UNLINK, { ...p }, motiveOf(store, o.slice));
  return linksFor(store, o.slice).find((x) => x.link_id === l.link_id)!;
}

/** Verify only applies to direct links: a delegate link is satisfied by the child's forwarded verdict. */
export function scopeVerify(store: WorkStore, o: { slice: string; citation: string }): { event_id: number } {
  if (!/^\S.*:\d+(-\d+)?$/.test(o.citation ?? "")) {
    throw new ScopeError("BAD_CITATION", `citation must look like path:line, got '${o.citation}'`);
  }
  const l = liveLink(store, o.slice);
  if (l.mode !== "direct") {
    throw new ScopeError("NOT_DIRECT", `slice '${o.slice}' link is ${l.mode}; verify applies to direct links only`);
  }
  const p: ScopeVerifyPayload = { slice: o.slice, citation: o.citation };
  const mid = motiveOf(store, o.slice);
  store.appendEvent(SCOPE_VERIFY, { ...p }, mid);
  const ev = store.getEvents(SCOPE_VERIFY, mid).at(-1)!;
  return { event_id: ev.id };
}

/** Validates the pointer's root and returns the parent's realpath. Throws before any write. */
function reachableParent(p: ScopePointer): string {
  let root: string;
  try { root = realpathSync(p.root); } catch {
    throw new ScopeError("PARENT_UNREACHABLE", `parent root not reachable: ${p.root}`);
  }
  if (!existsSync(path.join(root, ".groundwork", "work.db"))) {
    throw new ScopeError("PARENT_UNREACHABLE", `parent has no work store: ${root}/.groundwork/work.db`);
  }
  return root;
}

export type ChildInitResult =
  | { status: "no-child-store"; pointer: ScopePointer }
  | { status: "linked"; pointer: ScopePointer; dbPath: string }
  | { status: "exists"; pointer: ScopePointer; dbPath: string }
  | { status: "created"; pointer: ScopePointer; dbPath: string };

/** Null = no pointer, caller does a normal init. Any failure throws before the child db exists. */
export function childInit(o: { childDir: string }): ChildInitResult | null {
  const pointer = readPointer(o.childDir);
  if (!pointer) return null;
  if (pointer.mode === "direct") return { status: "no-child-store", pointer };
  const root = reachableParent(pointer);
  if (pointer.worktree !== undefined) {
    try { sameRoot(pointer.worktree, o.childDir); } catch {
      throw new ScopeError("PARENT_UNREACHABLE", `pointer worktree not reachable: ${pointer.worktree}`);
    }
  }
  const db = path.join(o.childDir, ".groundwork", "work.db");
  const reg: ChildRegisterPayload = { link_id: pointer.link_id, slice: pointer.slice };
  if (existsSync(db)) {
    // Store predates the link (or the tree was relinked): adopt it unless this link is already recorded.
    const store = new WorkStore(db);
    try {
      const known = store.getEvents(SCOPE_PARENT, pointer.motive)
        .some((e) => (JSON.parse(e.payload) as { link_id?: string }).link_id === pointer.link_id);
      if (known) return { status: "exists", pointer, dbPath: db };
      writeInboxEvent(root, pointer.link_id, CHILD_REGISTER, { ...reg });
      store.createMotive(pointer.motive);
      store.appendEvent(SCOPE_PARENT, { ...pointer }, pointer.motive);
    } finally { store.close(); }
    return { status: "linked", pointer, dbPath: db };
  }

  // Parent-side write first: if it fails, nothing exists in the child yet.
  writeInboxEvent(root, pointer.link_id, CHILD_REGISTER, { ...reg });

  try {
    mkdirSync(path.dirname(db), { recursive: true });
    const store = new WorkStore(db);
    try {
      store.createMotive(pointer.motive);
      store.appendEvent(SCOPE_PARENT, { ...pointer }, pointer.motive);
    } finally { store.close(); }
    ensureWriteToken(o.childDir);
    ensureSealKey(o.childDir);
  } catch (e) {
    for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
    throw e;
  }
  return { status: "created", pointer, dbPath: db };
}

/** Delegate child only: refuse approve while the tree has non-.groundwork changes, so base_commit covers the work. */
export function assertCommittedForApprove(childDir: string): void {
  const pointer = readPointer(childDir);
  if (!pointer || pointer.mode === "direct") return;
  const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: childDir, encoding: "utf8" });
  if (r.status !== 0) throw new ScopeError("UNCOMMITTED_WORK", `git status failed in ${childDir}: ${(r.stderr ?? "").trim()}`);
  const ents = r.stdout.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < ents.length; i++) {
    const code = ents[i].slice(0, 2);
    paths.push(ents[i].slice(3));
    if (code[0] === "R" || code[0] === "C") i++;
  }
  const dirty = paths.filter((f) => f !== ".groundwork" && !f.startsWith(".groundwork/"));
  if (dirty.length) {
    throw new ScopeError("UNCOMMITTED_WORK", `cannot approve a linked child with uncommitted work — commit first:\n${dirty.join("\n")}`);
  }
}

/** Null = no pointer. Throws on any failure; caller must exit nonzero. */
export function forwardVerdict(o: {
  childDir: string; verdict: string; citation: string; base_commit: string;
}): { file: string; event_id: string } | null {
  const pointer = readPointer(o.childDir);
  if (!pointer) return null;
  if (!(GATE_VERDICTS as readonly string[]).includes(o.verdict)) {
    throw new ScopeError("BAD_VERDICT", `verdict must be one of ${GATE_VERDICTS.join("|")}, got '${o.verdict}'`);
  }
  if (!o.citation?.trim()) throw new ScopeError("BAD_CITATION", "citation required");
  if (!o.base_commit?.trim()) throw new ScopeError("BAD_BASE_COMMIT", "base_commit required");
  const root = reachableParent(pointer);
  const payload: ChildGatePayload = {
    link_id: pointer.link_id, slice: pointer.slice, verdict: o.verdict as GateVerdict,
    citation: o.citation, base_commit: o.base_commit,
  };
  return writeInboxEvent(root, pointer.link_id, CHILD_GATE, { ...payload });
}
