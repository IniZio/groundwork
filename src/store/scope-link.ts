import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CHILD_GATE,
  CHILD_LINK,
  SCOPE_UNLINK,
  SCOPE_VERIFY,
  readPointer,
  sameRoot,
  serializePointer,
  type ChildGatePayload,
  type ChildLinkPayload,
  type ScopeMode,
  type ScopeUnlinkPayload,
  type ScopeVerifyPayload,
} from "./scope-pointer.js";
import type { WorkStore } from "./store.js";

export interface LinkGate { event_id: number; verdict: string; citation: string; base_commit: string }
export interface LinkUnlink { event_id: number; reason: string }
export interface ScopeLink {
  event_id: number;
  link_id: string;
  slice: string;
  mode: ScopeMode;
  root_realpath: string;
  worktree_realpath: string;
  /** Newest first. */
  gates: LinkGate[];
  unlink: LinkUnlink | null;
}

export interface Requirement {
  satisfied: boolean;
  missing?: string;
  evidence: string[];
}

function parse<T>(payload: string): T | null {
  try { return JSON.parse(payload) as T; } catch { return null; }
}

function motiveOf(store: WorkStore, slice: string): string {
  return store.getSlice(slice)?.motive_id ?? store.activeMotive;
}

export function createLink(
  store: WorkStore,
  o: { childDir: string; slice: string; mode: ScopeMode; motive: string; repoDir: string },
): ScopeLink {
  const s = store.getSlice(o.slice);
  if (!s) throw new Error(`Slice '${o.slice}' not found`);
  if (s.status === "complete") throw new Error(`Slice '${o.slice}' is already complete`);
  const root = realpathSync(o.repoDir);
  const existing = readPointer(o.childDir);
  if (existing) {
    let same = false;
    try { same = sameRoot(existing.root, root); } catch { /* unresolvable root is foreign */ }
    if (!same) throw new Error(`${o.childDir} already linked to a different root (${existing.root})`);
  }
  const worktree = realpathSync(o.childDir);
  const link_id = randomUUID();
  mkdirSync(path.join(o.childDir, ".groundwork"), { recursive: true });
  writeFileSync(
    path.join(o.childDir, ".groundwork", "parent"),
    serializePointer({
      v: 1, motive: o.motive, slice: o.slice, link_id, mode: o.mode,
      root, worktree, created: new Date().toISOString(),
    }),
  );
  const payload: ChildLinkPayload = {
    link_id, slice: o.slice, mode: o.mode, root_realpath: root, worktree_realpath: worktree,
  };
  store.appendEvent(CHILD_LINK, { ...payload }, o.motive);
  const link = linksFor(store, o.slice).find((l) => l.link_id === link_id);
  if (!link) throw new Error("link event not found after append");
  return link;
}

export function linksFor(store: WorkStore, slice: string): ScopeLink[] {
  const mid = motiveOf(store, slice);
  const links: ScopeLink[] = [];
  for (const e of store.getEvents(CHILD_LINK, mid)) {
    const p = parse<ChildLinkPayload>(e.payload);
    if (!p || p.slice !== slice) continue;
    links.push({
      event_id: e.id, link_id: p.link_id, slice, mode: p.mode,
      root_realpath: p.root_realpath, worktree_realpath: p.worktree_realpath,
      gates: [], unlink: null,
    });
  }
  const byId = new Map(links.map((l) => [l.link_id, l]));
  for (const e of store.getEvents(CHILD_GATE, mid)) {
    const p = parse<ChildGatePayload>(e.payload);
    const l = p && byId.get(p.link_id);
    if (p && l) l.gates.unshift({ event_id: e.id, verdict: p.verdict, citation: p.citation, base_commit: p.base_commit });
  }
  for (const e of store.getEvents(SCOPE_UNLINK, mid)) {
    const p = parse<ScopeUnlinkPayload>(e.payload);
    const l = p && byId.get(p.link_id);
    if (p && l) l.unlink = { event_id: e.id, reason: p.reason };
  }
  return links.sort((a, b) => b.event_id - a.event_id);
}

function commitExists(repoDir: string, commit: string): boolean {
  if (!commit) return false;
  const r = spawnSync("git", ["-C", repoDir, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
  return r.status === 0;
}

export function requirement(store: WorkStore, slice: string, repoDir: string): Requirement {
  const links = linksFor(store, slice);
  const evidence = links.map((l) =>
    `link ${l.link_id} mode=${l.mode} gates=[${l.gates.map((g) => g.verdict).join(",")}]` +
    (l.unlink ? ` unlinked: ${l.unlink.reason}` : ""),
  );
  const live = links.find((l) => !l.unlink);
  if (!live) return { satisfied: true, evidence };

  if (live.mode === "delegate") {
    const g = live.gates[0];
    if (!g) return { satisfied: false, missing: `no child gate verdict for link ${live.link_id}`, evidence };
    if (g.verdict !== "APPROVE") {
      return { satisfied: false, missing: `newest child verdict is ${g.verdict}, not APPROVE`, evidence };
    }
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(g.base_commit ?? "")) {
      return { satisfied: false, missing: `base_commit ${g.base_commit} is not a full commit id`, evidence };
    }
    if (!commitExists(repoDir, g.base_commit)) {
      return { satisfied: false, missing: `base_commit ${g.base_commit} not found in ${repoDir}`, evidence };
    }
    evidence.push(`child APPROVE at ${g.base_commit}: ${g.citation}`);
    return { satisfied: true, evidence };
  }

  const v = store.getEvents(SCOPE_VERIFY, motiveOf(store, slice)).find((e) => {
    const p = parse<ScopeVerifyPayload>(e.payload);
    return p?.slice === slice && e.id > live.event_id;
  });
  if (!v) return { satisfied: false, missing: `no SCOPE_VERIFY for ${slice} after link ${live.link_id}`, evidence };
  evidence.push(`SCOPE_VERIFY event ${v.id}`);
  return { satisfied: true, evidence };
}
