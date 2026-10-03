import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { GateVerdict } from "./store.js";

export const CHILD_LINK = "CHILD_LINK";
export const CHILD_REGISTER = "CHILD_REGISTER";
export const CHILD_GATE = "CHILD_GATE";
export const SCOPE_VERIFY = "SCOPE_VERIFY";
export const SCOPE_UNLINK = "SCOPE_UNLINK";

export const SCOPE_MODES = ["direct", "delegate"] as const;
export type ScopeMode = typeof SCOPE_MODES[number];

export interface ChildLinkPayload {
  link_id: string;
  slice: string;
  mode: ScopeMode;
  root_realpath: string;
  worktree_realpath: string;
}
export interface ChildRegisterPayload { link_id: string; slice: string }
export interface ChildGatePayload {
  link_id: string;
  slice: string;
  verdict: GateVerdict;
  citation: string;
  base_commit: string;
}
export interface ScopeVerifyPayload { slice: string; citation: string }
export interface ScopeUnlinkPayload { link_id: string; slice: string; reason: string }

/** Pointer at <child-tree>/.groundwork/parent. `root` is the parent repo dir (the dir holding .groundwork, i.e. main.ts repoDir()). */
export interface ScopePointer {
  v: 1;
  motive: string;
  slice: string;
  link_id: string;
  mode: ScopeMode;
  root: string;
  worktree?: string;
  created: string;
}

export class ScopePointerVersionError extends Error {
  readonly code = "SCOPE_POINTER_VERSION";
  constructor(readonly version: number) {
    super(`scope pointer field "v": unsupported version ${version} (this gw reads v1)`);
    this.name = "ScopePointerVersionError";
  }
}

function str(o: Record<string, unknown>, k: string): string {
  const x = o[k];
  if (typeof x !== "string") throw new Error(`scope pointer field "${k}" missing or not a string`);
  return x;
}

export function parsePointer(json: string | unknown): ScopePointer {
  const raw = typeof json === "string" ? JSON.parse(json) : json;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("scope pointer is not a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.v !== "number") throw new Error('scope pointer field "v" missing or not a number');
  if (o.v > 1) throw new ScopePointerVersionError(o.v);
  if (o.v !== 1) throw new Error(`scope pointer field "v" invalid: ${o.v}`);
  const mode = str(o, "mode");
  if (!(SCOPE_MODES as readonly string[]).includes(mode)) {
    throw new Error(`scope pointer field "mode" unknown: ${mode}`);
  }
  const p: ScopePointer = {
    v: 1,
    motive: str(o, "motive"),
    slice: str(o, "slice"),
    link_id: str(o, "link_id"),
    mode: mode as ScopeMode,
    root: str(o, "root"),
    created: str(o, "created"),
  };
  if (o.worktree !== undefined) p.worktree = str(o, "worktree");
  return p;
}

/** Null only when the file is absent; any present-but-invalid file throws. */
export function readPointer(treeDir: string): ScopePointer | null {
  const f = path.join(treeDir, ".groundwork", "parent");
  if (!existsSync(f)) return null;
  return parsePointer(readFileSync(f, "utf8"));
}

export function sameRoot(a: string, b: string): boolean {
  return realpathSync(a) === realpathSync(b);
}

export function serializePointer(p: ScopePointer): string {
  return JSON.stringify(p, null, 2) + "\n";
}
