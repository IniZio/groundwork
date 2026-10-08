import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  intent?: IntentGates;
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
    out.intent = intentGates(o.cwd, store.activeMotive, (t) => store.getLastEvent(t)?.payload ?? null);
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

export type IntentArtifact = "charter" | "spec";
export const APPROVAL_EVENT: Record<IntentArtifact, string> = { charter: "APPROVE_CHARTER", spec: "APPROVE_SPEC" };

const baseOf = (a: IntentArtifact) => (a === "charter" ? "motive" : "spec");

export function artifactFiles(root: string, slug: string, a: IntentArtifact): string[] {
  const b = baseOf(a);
  return [`doc/${slug}/${b}.md`, `.groundwork/work/${slug}/${b}.md`].filter((r) => existsSync(path.join(root, r)));
}

export function artifactHash(root: string, slug: string, a: IntentArtifact): string | null {
  const files = artifactFiles(root, slug, a);
  if (files.length === 0) return null;
  const h = createHash("sha256");
  for (const rel of files) h.update(`${rel}\0${readFileSync(path.join(root, rel), "utf8")}\0`);
  return `sha256:${h.digest("hex")}`;
}

export function intentGatesApply(root: string, slug: string): boolean {
  return existsSync(path.join(root, "doc", slug, "motive.md")) || existsSync(path.join(root, "doc", slug, "spec.md"));
}

export interface ApprovalRecord { hash: string; files: string[]; by: "human" | "auto"; rows?: string[]; created_at: string }

export function approvalPayload(
  root: string,
  slug: string,
  a: IntentArtifact,
  by: "human" | "auto",
  rows?: string[],
): ApprovalRecord {
  const hash = artifactHash(root, slug, a);
  if (hash === null) {
    const b = baseOf(a);
    throw new Error(`no ${a} found for ${slug}: expected doc/${slug}/${b}.md or .groundwork/work/${slug}/${b}.md`);
  }
  const rec: ApprovalRecord = { hash, files: artifactFiles(root, slug, a), by, created_at: new Date().toISOString() };
  if (rows) rec.rows = rows;
  return rec;
}

export type ApprovalState = "approved" | "void" | "missing";
export interface ArtifactGate { artifact: IntentArtifact; state: ApprovalState; hash: string | null; approved?: ApprovalRecord }

export function evaluateArtifact(root: string, slug: string, a: IntentArtifact, latestPayload: string | null): ArtifactGate {
  const hash = artifactHash(root, slug, a);
  let rec: ApprovalRecord | null = null;
  if (latestPayload !== null) {
    try {
      const p = JSON.parse(latestPayload) as ApprovalRecord;
      if (p && typeof p.hash === "string") rec = p;
    } catch { /* unparseable counts as missing */ }
  }
  if (!rec) return { artifact: a, state: "missing", hash };
  return { artifact: a, state: hash !== null && hash === rec.hash ? "approved" : "void", hash, approved: rec };
}

export interface IntentGates { applies: boolean; slug: string; h1: ArtifactGate; h2: ArtifactGate }

export function intentGates(root: string, slug: string, latest: (eventType: string) => string | null): IntentGates {
  return {
    applies: intentGatesApply(root, slug),
    slug,
    h1: evaluateArtifact(root, slug, "charter", latest(APPROVAL_EVENT.charter)),
    h2: evaluateArtifact(root, slug, "spec", latest(APPROVAL_EVENT.spec)),
  };
}

export function refusalMessage(g: IntentGates): string | null {
  if (!g.applies) return null;
  const parts: string[] = [];
  if (g.h1.state !== "approved") {
    parts.push(
      g.h1.state === "missing"
        ? "H1 charter approval missing — a human approves with `$GW approve charter --token T`"
        : "H1 charter approval void (edited after approval) — a human re-approves with `$GW approve charter --token T`",
    );
  }
  if (g.h2.state !== "approved") {
    const fix = "run `$GW approve spec --auto --token T`, or a human approves with `$GW approve spec --token T`";
    parts.push(
      g.h2.state === "missing"
        ? `H2 spec approval missing — ${fix}`
        : `H2 spec approval void (edited after approval) — ${fix}`,
    );
  }
  if (parts.length === 0) return null;
  return `intent gate: implementation dispatch refused — ${parts.join("; ")}`;
}

export interface H2Classification { auto: boolean; rows: string[]; openDecision: string | null }
export const CHANGE_KINDS: readonly string[] = ["bugfix", "refactor", "cli-flag", "config-key", "data-format", "migration", "dependency"];

function readFrontmatter(text: string): { kinds: string[]; repro: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return null;
  const unq = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const lines = m[1].split(/\r?\n/);
  let kinds: string[] = [];
  let repro = "";
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const val = kv[2].trim();
    if (kv[1] === "repro_test") repro = unq(val);
    if (kv[1] !== "change_kinds") continue;
    if (val.startsWith("[")) {
      kinds = val.replace(/^\[|\]\s*$/g, "").split(",").map(unq).filter(Boolean);
    } else if (val === "") {
      for (let j = i + 1; j < lines.length; j++) {
        const li = /^\s*-\s+(.*)$/.exec(lines[j]);
        if (!li) break;
        kinds.push(unq(li[1]));
      }
    } else {
      kinds = [unq(val)];
    }
  }
  return { kinds, repro, body: text.slice(m[0].length) };
}

function tbdAcLine(body: string): string | null {
  let inAc = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^##\s/.test(line)) inAc = /^##\s+Acceptance criteria\b/i.test(line);
    else if (inAc && /^\s*[-*]\s+\[.\]/.test(line) && /\bTBD\b/.test(line)) return line.trim();
  }
  return null;
}

export function classifySpec(agentSpecText: string | null): H2Classification {
  const fm = agentSpecText === null ? null : readFrontmatter(agentSpecText);
  if (!fm || fm.kinds.length === 0) {
    return { auto: false, rows: ["Unclassified"], openDecision: "H2 needs human approval: Unclassified (spec declares no change_kinds)" };
  }
  const rows: string[] = [];
  const human: string[] = [];
  const has = (k: string) => fm.kinds.includes(k);
  const unknown = fm.kinds.filter((k) => !CHANGE_KINDS.includes(k));
  const addHuman = (r: string) => { rows.push(r); human.push(r); };
  if (has("bugfix")) {
    if (fm.repro) rows.push("Bug fix with a failing test that reproduces it");
    else addHuman("Bug fix without a reproducing test");
  }
  if (has("refactor")) rows.push("Refactor, no behaviour or interface change");
  if (has("cli-flag") || has("config-key")) addHuman("New CLI flag or config key");
  if (has("data-format") || has("migration")) addHuman("Change to stored data format or migration");
  const tbd = tbdAcLine(fm.body);
  if (tbd !== null) {
    rows.push("Every AC maps to a slice, one AC still TBD");
    human.push(`Every AC maps to a slice, one AC still TBD: ${tbd}`);
  }
  if (has("dependency")) addHuman("Dependency added");
  if (unknown.length > 0) {
    rows.push("Unclassified");
    human.push(`Unclassified (unknown change_kinds: ${unknown.join(", ")})`);
  }
  const auto = human.length === 0;
  return { auto, rows, openDecision: auto ? null : `H2 needs human approval: ${human.join(", ")}` };
}
