#!/usr/bin/env bun
import { WorkStore, EVENT_TYPES, GATE_VERDICTS } from "../store/store.js";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveRepoBase } from "../hooks/lib/repo-base.js";
import { runArchive } from "./archive.js";
import { runMigrate } from "./migrate.js";
import { renderRecipe } from "./recipe.js";
import { listUnits, idleDays } from "../store/work-units.js";
import {
  readWriteToken,
  ensureWriteToken,
  ensureSealKey,
  computeSeal,
  type SealFields,
} from "../store/key-store.js";
import { assertCommittedForApprove, childInit, forwardVerdict, scopeLink, scopeUnlink, scopeVerify } from "./scope.js";
import { completionGuard, gateStatus, APPROVAL_EVENT, approvalPayload, classifySpec, intentGates, type IntentArtifact } from "./gate-status.js";
import { CHILD_LINK, CHILD_REGISTER, CHILD_GATE, SCOPE_VERIFY, SCOPE_UNLINK } from "../store/scope-pointer.js";

const gw = process.env.GW ?? `bun ${process.argv[1]}`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

/** Returns the current git HEAD SHA, or null if not a git repo or git unavailable. */
function getGitHead(cwd: string): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8", timeout: 3000 });
    if (r.status !== 0) return null;
    return (r.stdout ?? "").trim() || null;
  } catch { return null; }
}

let baseDir: string | undefined;
function repoBase(): string {
  return (baseDir ??= resolveRepoBase(process.cwd()));
}

function dbPath(): string {
  if (process.env.GROUNDWORK_DB) return process.env.GROUNDWORK_DB;
  return path.join(repoBase(), ".groundwork", "work.db");
}

function repoDir(): string {
  return path.dirname(path.dirname(dbPath()));
}

function requireDb(motiveSlug?: string): WorkStore {
  const p = dbPath();
  if (!existsSync(p)) {
    process.stderr.write(`error: no work store found — run \`${gw} init\` first\n`);
    process.exit(1);
  }
  const store = new WorkStore(p);
  if (motiveSlug) store.setMotiveContext(motiveSlug);
  return store;
}

function checkToken(store: WorkStore, args: string[]): void {
  const t = flag(args, "--token");
  // Token lives in config dir (not in work.db).  Fall back to meta for stores
  // that have not yet run $GW init under the new scheme.
  const stored = readWriteToken(repoDir()) ?? store.getMeta("token");
  if (!stored) {
    process.stderr.write(`error: store has no token — run \`${gw} init\` first\n`);
    store.close();
    process.exit(1);
  }
  if (t !== stored) {
    process.stderr.write("error: --token required for mutations\n");
    store.close();
    process.exit(1);
  }
}

function excludeWorkingTier(root: string): void {
  const r = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root, encoding: "utf8", timeout: 3000 });
  const rel = r.status === 0 ? (r.stdout ?? "").trim() : "";
  if (!rel) {
    process.stdout.write("note: not a git repository — .groundwork/ not excluded from git\n");
    return;
  }
  const file = path.resolve(root, rel);
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (cur.split(/\r?\n/).some(l => l.trim() === ".groundwork/")) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, (cur === "" || cur.endsWith("\n") ? "" : "\n") + ".groundwork/\n");
}

function scopeFail(e: unknown): never {
  if (e instanceof Error) {
    process.stderr.write(`gw: ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

function cmdInit(args: string[]): void {
  let child: ReturnType<typeof childInit> = null;
  try { child = childInit({ childDir: repoDir() }); }
  catch (e: unknown) { scopeFail(e); }
  if (child) {
    if (child.status === "no-child-store") {
      process.stdout.write(`no child store: direct-mode link (slice ${child.pointer.slice}); verify from the parent with \`${gw} scope verify\`\n`);
    } else {
      if (child.status === "created") excludeWorkingTier(repoDir());
      process.stdout.write(`${child.status === "created" ? "initialized child store" : child.status === "linked" ? "linked existing store" : "already initialized"}: ${child.dbPath}\nlinked to slice ${child.pointer.slice} (${child.pointer.mode})\n`);
    }
    return;
  }
  const p = dbPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  excludeWorkingTier(repoDir());
  const store = new WorkStore(p);

  const metaTok = store.getMeta("token");
  let tok = readWriteToken(repoDir());
  if (!tok) {
    tok = ensureWriteToken(repoDir(), metaTok ?? undefined);
    if (metaTok) store.database.run("DELETE FROM meta WHERE key = 'token'");
    process.stdout.write(`initialized: ${p}\ntoken: ${tok}\n`);
  } else {
    if (metaTok) store.database.run("DELETE FROM meta WHERE key = 'token'");
    process.stdout.write(`already initialized: ${p}\n`);
  }
  ensureSealKey(repoDir());

  const objective = flag(args, "--objective");
  if (objective) {
    store.appendEvent("OBJECTIVE", { msg: objective });
    process.stdout.write(`objective set\n`);
  }
  store.close();
}

function cmdSliceAdd(args: string[], motiveSlug?: string): void {
  const id = args[0];
  if (!id || id.startsWith("-")) {
    process.stderr.write(`usage: ${gw} slice add <id> [--desc TEXT] [--wave N] [--covers-ac AC-1,AC-3] [--blocked-by a,b] [--acceptance "x;y"] [--files a.ts,b.ts] --token T\n`);
    process.exit(1);
  }
  const waveRaw = flag(args, "--wave");
  let wave = 0;
  if (waveRaw !== undefined) {
    if (!/^-?\d+$/.test(waveRaw.trim())) {
      process.stderr.write(`error: --wave must be a numeric integer (got: ${JSON.stringify(waveRaw)})\nusage: ${gw} slice add <id> [--wave N] --token T\n`);
      process.exit(1);
    }
    wave = parseInt(waveRaw, 10);
  }
  const filesRaw = flag(args, "--files");
  const files = filesRaw ? JSON.stringify(filesRaw.split(",").map(f => f.trim()).filter(Boolean)) : null;
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.insertSlice({
    id,
    wave,
    status: "pending",
    description: flag(args, "--desc") ?? null,
    acceptance: flag(args, "--acceptance") ?? null,
    blocked_by: flag(args, "--blocked-by") ?? null,
    covers_ac: flag(args, "--covers-ac") ?? null,
    decisions: null,
    files,
  });
  process.stdout.write(`slice ${id} added\n`);
  store.close();
}

function cmdSliceComplete(args: string[], motiveSlug?: string): void {
  const id = args[0];
  if (!id) { process.stderr.write(`usage: ${gw} slice complete <id> --token T\n`); process.exit(1); }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  if (!store.getSlice(id)) {
    process.stderr.write(`error: slice '${id}' not found\n`);
    store.close();
    process.exit(1);
  }
  const guard = completionGuard(store, { slice: id, repoDir: repoDir() });
  if (!guard.ok) {
    process.stderr.write(`error: cannot complete slice '${id}': ${guard.message}\n`);
    for (const ev of guard.evidence) process.stderr.write(`  ${ev}\n`);
    store.close();
    process.exit(1);
  }
  store.completeSlice(id);
  process.stdout.write(`slice ${id} complete\n`);
  store.close();
}

function cmdSliceClaim(args: string[], motiveSlug?: string): void {
  const id = args[0];
  if (!id || id.startsWith("-")) {
    process.stderr.write(`usage: ${gw} slice claim <id> --by AGENT --token T\n`);
    process.exit(1);
  }
  const by = flag(args, "--by");
  if (!by) {
    process.stderr.write(`error: --by required\nusage: ${gw} slice claim <id> --by AGENT --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  if (!store.getSlice(id)) {
    process.stderr.write(`error: slice '${id}' not found\n`);
    store.close();
    process.exit(1);
  }
  try {
    store.claimSlice(id, by);
    process.stdout.write(`slice ${id} claimed by ${by}\n`);
  } catch (e: unknown) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    store.close();
    process.exit(1);
  }
  store.close();
}

function cmdSliceSetAc(args: string[], motiveSlug?: string): void {
  const id = args[0];
  if (!id || id.startsWith("-")) {
    process.stderr.write(`usage: ${gw} slice set-ac <id> --covers-ac AC-1,AC-3 --token T\n`);
    process.exit(1);
  }
  const covers_ac = flag(args, "--covers-ac");
  if (!covers_ac) {
    process.stderr.write(`error: --covers-ac required\nusage: ${gw} slice set-ac <id> --covers-ac AC-1,AC-3 --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  if (!store.getSlice(id)) {
    process.stderr.write(`error: slice '${id}' not found\n`);
    store.close();
    process.exit(1);
  }
  store.setCoversAc(id, covers_ac);
  process.stdout.write(`slice ${id} covers-ac set to ${covers_ac}\n`);
  store.close();
}

function cmdSliceStatus(motiveSlug?: string): void {
  const store = requireDb(motiveSlug);
  const slices = store.getAllSlices();
  const done = slices.filter(s => s.status === "complete" || s.status === "archived").length;
  const newestGate = store.getNewestGateVerdict();
  const gate = newestGate ? newestGate.event_type.replace("GATE_", "") : "pending";
  const hold = store.getHoldState() ?? "none";
  const motiveLabel = motiveSlug ? `  motive: ${motiveSlug}` : "";
  process.stdout.write(`slices: ${done}/${slices.length} complete  gate: ${gate}  hold: ${hold}${motiveLabel}\n`);
  for (const s of slices) {
    const bl = s.blocked_by ? `  blocked-by=[${s.blocked_by}]` : "";
    const d = s.description ? `  ${s.description.slice(0, 60)}` : "";
    const filesArr: string[] = s.files ? (() => { try { return JSON.parse(s.files) as string[]; } catch { return []; } })() : [];
    const fl = filesArr.length ? `  files=[${filesArr.join(",")}]` : "";
    process.stdout.write(`  ${s.status.padEnd(11)} ${s.id}${bl}${d}${fl}\n`);
  }
  store.close();
}

function cmdSliceRm(args: string[], motiveSlug?: string): void {
  const id = args[0];
  if (!id) { process.stderr.write(`usage: ${gw} slice rm <id> --token T\n`); process.exit(1); }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  const s = store.getSlice(id);
  if (!s) { process.stderr.write(`error: slice '${id}' not found\n`); store.close(); process.exit(1); }
  store.appendEvent("RETENTION_ACTION", { slice_id: id, reason: "cli rm", prior_status: s.status });
  try {
    store.database.run("DELETE FROM slices WHERE id = ?", [id]);
    process.stdout.write(`slice ${id} removed\n`);
  } catch (e: unknown) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    store.close();
    process.exit(1);
  }
  store.close();
}

function cmdGateVerdict(verdict: string, args: string[], motiveSlug?: string): void {
  const upper = verdict.toUpperCase() as typeof GATE_VERDICTS[number];
  if (!(GATE_VERDICTS as readonly string[]).includes(upper)) {
    process.stderr.write(`error: unknown gate verdict '${verdict}'\nvalid: ${GATE_VERDICTS.map(v => v.toLowerCase()).join(", ")}\n`);
    process.exit(1);
  }
  const citation = flag(args, "--citation");
  if (!citation || !/\S+:\d+/.test(citation)) {
    process.stderr.write("error: --citation must include at least one file:line reference (e.g. src/foo.ts:42)\n");
    process.exit(1);
  }
  if (upper === "APPROVE") {
    try { assertCommittedForApprove(repoBase()); } catch (e: unknown) { scopeFail(e); }
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  const eventType = `GATE_${upper}`;
  const payload: Record<string, unknown> = { citation };
  if (upper === "APPROVE") {
    const head = getGitHead(repoBase());
    if (head) payload.base_commit = head;
    const sealKey = ensureSealKey(repoDir());
    const createdAt = new Date().toISOString();
    payload.created_at = createdAt;
    const motiveId = motiveSlug ?? store.activeMotive;
    const sealFields: SealFields = {
      citation,
      created_at: createdAt,
      event_type: eventType,
      motive_id: motiveId,
      base_commit: typeof payload.base_commit === "string" ? payload.base_commit : null,
    };
    payload.seal = computeSeal(sealKey, sealFields);
  }
  store.appendEvent(eventType, payload);
  process.stdout.write(`${eventType} recorded  citation: ${citation}\n`);
  store.close();
  try {
    const head = getGitHead(repoBase());
    const fwd = forwardVerdict({ childDir: repoBase(), verdict: upper, citation, base_commit: head ?? "" });
    if (fwd) process.stdout.write(`forwarded to parent: ${fwd.event_id}\n`);
  } catch (e: unknown) {
    process.stderr.write(`gw: verdict forward failed: ${e instanceof Error ? e.message : String(e)}\n(local ${eventType} remains recorded)\n`);
    process.exit(1);
  }
}

function cmdScope(sub: string | undefined, args: string[], motiveSlug?: string): void {
  const slice = flag(args, "--slice");
  if (sub !== "link" && sub !== "unlink" && sub !== "verify") {
    process.stderr.write(`unknown scope subcommand: ${sub ?? "(none)"}\nsubcommands: link <dir> --slice S [--mode direct|delegate], unlink --slice S --reason TEXT, verify --slice S --citation file:line\n`);
    process.exit(1);
  }
  const childDir = sub === "link" ? args[0] : undefined;
  if (!slice || (sub === "link" && (!childDir || childDir.startsWith("-")))) {
    process.stderr.write(`usage: ${gw} scope ${sub === "link" ? "link <dir> --slice S [--mode direct|delegate]" : sub === "unlink" ? "unlink --slice S --reason TEXT" : "verify --slice S --citation file:line"} --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  try {
    if (sub === "link") {
      const l = scopeLink(store, { childDir: path.resolve(childDir!), slice, mode: flag(args, "--mode"), repoDir: repoDir() });
      process.stdout.write(`linked ${l.link_id}: slice ${slice} -> ${path.resolve(childDir!)} (${l.mode})\n`);
    } else if (sub === "unlink") {
      const l = scopeUnlink(store, { slice, reason: flag(args, "--reason") ?? "" });
      process.stdout.write(`unlinked ${l.link_id}: slice ${slice}\n`);
    } else {
      scopeVerify(store, { slice, citation: flag(args, "--citation") ?? "" });
      process.stdout.write(`verified slice ${slice}\n`);
    }
  } catch (e: unknown) {
    store.close();
    scopeFail(e);
  }
  store.close();
}

function cmdGateStatus(args: string[]): void {
  const st = gateStatus({ cwd: repoBase() });
  if (boolFlag(args, "--json")) {
    process.stdout.write(JSON.stringify(st, null, 2) + "\n");
    return;
  }
  process.stdout.write(`scope: ${st.scope}  gate: ${st.gate}  slices: ${st.slices.complete} complete, ${st.slices.open} open${st.intent?.applies ? `  H1: ${st.intent.h1.state}  H2: ${st.intent.h2.state}` : ""}\n`);
}

function cmdApprove(args: string[], motiveSlug?: string): void {
  const artifact = args[0];
  if (artifact !== "charter" && artifact !== "spec") {
    process.stderr.write(`usage: ${gw} approve charter|spec [--auto] --token T\n`);
    process.exit(1);
  }
  let autoFlag = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--token" && i + 1 < args.length && !args[i + 1].startsWith("-")) i++;
    else if (args[i] === "--auto" && !autoFlag) autoFlag = true;
    else {
      process.stderr.write(`usage: ${gw} approve charter|spec [--auto] --token T\n`);
      process.exit(1);
    }
  }
  if (artifact === "charter" && autoFlag) {
    process.stderr.write(`usage: ${gw} approve charter [--token T]; --auto applies to spec only\n`);
    process.exit(1);
  }
  const a: IntentArtifact = artifact;
  const auto = a === "spec" && autoFlag;
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  const slug = store.activeMotive;
  const root = repoDir();
  const label = a === "charter" ? "H1 charter" : "H2 spec";
  if (auto) {
    const specPath = path.join(root, ".groundwork", "work", slug, "spec.md");
    const cls = classifySpec(existsSync(specPath) ? readFileSync(specPath, "utf8") : null);
    if (!cls.auto) {
      const reason = cls.openDecision ?? "H2 needs human approval";
      store.appendEvent("HOLD", { reason });
      process.stdout.write(`H2 awaiting human: ${reason}\n`);
      store.close();
      process.exit(2);
    }
    try {
      store.appendEvent(APPROVAL_EVENT.spec, approvalPayload(root, slug, "spec", "auto", cls.rows) as unknown as Record<string, unknown>);
    } catch (e: unknown) {
      store.close();
      process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    }
    process.stdout.write(`H2 auto-pass: ${cls.rows.join(", ")}\n`);
    store.close();
    return;
  }
  let payload;
  try { payload = approvalPayload(root, slug, a, "human"); }
  catch (e: unknown) {
    store.close();
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  store.appendEvent(APPROVAL_EVENT[a], payload as unknown as Record<string, unknown>);
  if (a === "spec" && store.getHoldState()?.startsWith("H2 ")) store.appendEvent("HOLD_CLEAR", {});
  process.stdout.write(`${label} approved: ${payload.hash}\n`);
  store.close();
}

function cmdHoldSet(args: string[], motiveSlug?: string): void {
  const reason = flag(args, "--reason");
  if (!reason) { process.stderr.write(`usage: ${gw} hold set --reason "established: ...; still need: ..." --token T\n`); process.exit(1); }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.appendEvent("HOLD", { reason });
  process.stdout.write(`hold set: ${reason}\n`);
  store.close();
}

function cmdHoldClear(args: string[], motiveSlug?: string): void {
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.appendEvent("HOLD_CLEAR", {});
  process.stdout.write("hold cleared\n");
  store.close();
}

function cmdEventAppend(args: string[], motiveSlug?: string): void {
  const type = flag(args, "--type");
  if (!type) { process.stderr.write(`usage: ${gw} event append --type TYPE [--msg TEXT] [--data JSON] --token T\n`); process.exit(1); }
  // Gate verdict types must go through `$GW gate <verdict>` with a citation.
  if ([CHILD_LINK, CHILD_REGISTER, CHILD_GATE, SCOPE_VERIFY, SCOPE_UNLINK, "SCOPE_PARENT"].includes(type)) {
    process.stderr.write(`error: ${type} is a scope event and cannot be appended directly — use \`$GW scope\` commands\n`);
    process.exit(1);
  }
  const gatePrefix = "GATE_";
  if (type.startsWith(gatePrefix)) {
    const verdictLower = type.slice(gatePrefix.length).toLowerCase();
    process.stderr.write(`error: gate verdict types cannot be appended directly — use \`$GW gate ${verdictLower}\` with --citation\n`);
    process.exit(1);
  }
  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    process.stderr.write(`error: unknown event type '${type}'\nvalid: ${EVENT_TYPES.join(", ")}\n`);
    process.exit(1);
  }
  const msg = flag(args, "--msg") ?? "";
  const dataRaw = flag(args, "--data") ?? "{}";
  let data: Record<string, unknown>;
  try { data = JSON.parse(dataRaw) as Record<string, unknown>; }
  catch { process.stderr.write("error: --data must be valid JSON\n"); process.exit(1); }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.appendEvent(type, { msg, ...data });
  process.stdout.write(`event ${type} appended\n`);
  store.close();
}

function buildAcCoverage(slices: import("../store/store.js").Slice[]): Map<string, string[]> {
  const coverage = new Map<string, string[]>();
  for (const s of slices) {
    if (!s.covers_ac) continue;
    for (const ac of s.covers_ac.split(",").map(a => a.trim()).filter(Boolean)) {
      const existing = coverage.get(ac) ?? [];
      existing.push(s.id);
      coverage.set(ac, existing);
    }
  }
  return coverage;
}

function cmdCompile(args: string[], motiveSlug?: string): void {
  const asJson = boolFlag(args, "--json");
  const store = requireDb(motiveSlug);
  const motive = store.activeMotive;
  const objective = store.getObjective();
  const slices = store.getAllSlices();
  const openSlices = slices.filter(s => s.status === "pending" || s.status === "in_progress");
  const decisions = store.getDecisionEvents();
  const newestGateEvent = store.getNewestGateVerdict();
  const gateOk = newestGateEvent?.event_type === "GATE_APPROVE";
  const hold = store.getHoldState();
  const lastPause = store.getLastEvent("PAUSE");
  const pausePayload = lastPause ? JSON.parse(lastPause.payload) as Record<string, unknown> : null;
  const acCoverage = buildAcCoverage(slices);
  const acCoverageObj = Object.fromEntries([...acCoverage.entries()]);
  const unitRoot = repoDir();
  const intent = intentGates(unitRoot, motive, t => store.getLastEvent(t)?.payload ?? null);
  const idleUnits: { slug: string; idle_days: number }[] = [];
  for (const slug of listUnits(unitRoot)) {
    try {
      const d = idleDays(path.join(unitRoot, ".groundwork", "work", slug));
      if (d >= 14) idleUnits.push({ slug, idle_days: d });
    } catch {
      // Unit vanished or is unreadable mid-scan; the resume view must not crash.
    }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      motive,
      objective: objective ?? null,
      decisions,
      open_slices: openSlices,
      last_pause: pausePayload,
      gate: gateOk ? "APPROVED" : "pending",
      hold: hold ?? null,
      intent,
      ac_coverage: acCoverageObj,
      idle_units: idleUnits,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`motive: ${motive}\n`);
    process.stdout.write(`objective: ${objective ?? "(none)"}\n`);
    process.stdout.write(`gate: ${gateOk ? "APPROVED" : "pending"}\n`);
    if (!intent.applies) {
      process.stdout.write(`intent gates: n/a (no doc/${motive}/ human view)\n`);
    } else {
      const fmt = (g: typeof intent.h1) => g.state === "approved" ? `approved (${g.approved?.by})` : g.state;
      process.stdout.write(`H1 charter: ${fmt(intent.h1)}\n`);
      process.stdout.write(`H2 spec: ${fmt(intent.h2)}\n`);
    }
    if (hold) {
      const [first, ...rest] = hold.split("\n");
      process.stdout.write(`hold: awaiting human — ${first}\n`);
      for (const line of rest) process.stdout.write(`    ${line}\n`);
    } else {
      process.stdout.write("hold: none\n");
    }
    process.stdout.write(`open slices (${openSlices.length}):\n`);
    for (const s of openSlices) {
      process.stdout.write(`  ${s.id} [wave ${s.wave}] ${s.status}${s.blocked_by ? ` blocked-by=${s.blocked_by}` : ""}\n`);
    }
    process.stdout.write(`decisions (${decisions.length}):\n`);
    for (const d of decisions) {
      process.stdout.write(`  [event ${d.id}] ${d.msg.slice(0, 80)}\n`);
    }
    if (acCoverage.size > 0) {
      const slicesWithAc = slices.filter(s => s.covers_ac).length;
      process.stdout.write(`ac coverage: ${acCoverage.size} ACs covered by ${slicesWithAc} slice(s)\n`);
      for (const [ac, ids] of [...acCoverage.entries()].sort()) {
        process.stdout.write(`  ${ac}: ${ids.join(", ")}\n`);
      }
    } else {
      process.stdout.write(`ac coverage: none\n`);
    }
    if (pausePayload) {
      process.stdout.write(`last PAUSE: ${String(pausePayload.msg ?? "(no msg)")}\n`);
      if (pausePayload.pointer) process.stdout.write(`  pointer: ${String(pausePayload.pointer)}\n`);
      if (pausePayload.summary) process.stdout.write(`  summary: ${String(pausePayload.summary)}\n`);
      if (pausePayload.next_actions) process.stdout.write(`  next_actions: ${String(pausePayload.next_actions)}\n`);
    }
    process.stdout.write(idleUnits.length > 0
      ? `idle units (≥14d): ${idleUnits.map(u => `${u.slug} (${u.idle_days}d)`).join(", ")}\n`
      : `idle units: none\n`);
  }
  store.close();
}

function cmdMotiveAdd(args: string[], motiveSlug?: string): void {
  const slug = args[0];
  if (!slug || slug.startsWith("-")) {
    process.stderr.write(`usage: ${gw} motive add <slug> [--use] --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.createMotive(slug);
  const useFlag = boolFlag(args, "--use");
  if (useFlag) {
    store.setActiveMotive(slug);
    process.stdout.write(`motive ${slug} added and set as active\n`);
  } else {
    process.stdout.write(`motive ${slug} added\n`);
  }
  store.close();
}

function cmdMotiveUse(args: string[]): void {
  const slug = args[0];
  if (!slug || slug.startsWith("-")) {
    process.stderr.write(`usage: ${gw} motive use <slug> --token T\n`);
    process.exit(1);
  }
  const store = requireDb();
  checkToken(store, args);
  // Ensure the motive exists.
  const motives = store.listMotives();
  if (!motives.some(m => m.id === slug)) {
    process.stderr.write(`error: motive '${slug}' not found — run \`${gw} motive add ${slug}\` first\n`);
    store.close();
    process.exit(1);
  }
  store.setActiveMotive(slug);
  process.stdout.write(`active motive: ${slug}\n`);
  store.close();
}

function cmdMotiveList(): void {
  const store = requireDb();
  const motives = store.listMotives();
  const active = store.getActiveMotive();
  for (const m of motives) {
    const marker = m.id === active ? "* " : "  ";
    process.stdout.write(`${marker}${m.id}  [${m.status}]\n`);
  }
  store.close();
}

function cmdMotiveComplete(args: string[], motiveSlug?: string): void {
  const slug = args[0];
  if (!slug || slug.startsWith("-")) {
    process.stderr.write(`usage: ${gw} motive complete <slug> --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.completeMotive(slug);
  process.stdout.write(`motive ${slug} marked complete\n`);
  store.close();
}
function cmdMigrate(args: string[]): void {
  const apply = args.includes("--apply");
  if (apply) {
    if (!flag(args, "--token")) {
      process.stderr.write(`usage: ${gw} migrate [--apply --token T]\n`);
      process.exit(1);
    }
    const store = requireDb();
    checkToken(store, args);
    store.close();
  }
  const r = runMigrate(repoDir(), apply);
  process.stdout.write(r.lines.join("\n") + "\n");
  process.exit(r.code);
}
function cmdArchive(args: string[], motiveSlug?: string): void {
  const slug = args[0];
  if (!slug || slug.startsWith("-")) {
    process.stderr.write(`usage: ${gw} archive <slug> --token T\n`);
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  const r = runArchive(repoDir(), slug);
  if (!r.ok) {
    process.stderr.write(`error: ${r.err}\n`);
    store.close();
    process.exit(1);
  }
  store.completeMotive(slug);
  process.stdout.write(`archived: ${slug} → ${r.dest}\n`);
  store.close();
}

// ---------------------------------------------------------------------------
// Entry point — parse global --motive flag before subcommand dispatch
// ---------------------------------------------------------------------------

const rawArgv = process.argv.slice(2);

// Extract global --motive <slug> before subcommand parsing.
const motiveIdx = rawArgv.indexOf("--motive");
let globalMotive: string | undefined;
let argv: string[];
if (motiveIdx >= 0 && motiveIdx + 1 < rawArgv.length) {
  globalMotive = rawArgv[motiveIdx + 1];
  argv = [...rawArgv.slice(0, motiveIdx), ...rawArgv.slice(motiveIdx + 2)];
} else {
  argv = rawArgv;
}

const cmd = argv[0];

if (cmd === "init") {
  cmdInit(argv.slice(1));
} else if (cmd === "token") {
  const tok = readWriteToken(repoDir());
  if (!tok) { process.stderr.write(`error: no token — run \`${gw} init\` first\n`); process.exit(1); }
  process.stdout.write(`token: ${tok}\n`);
} else if (cmd === "slice") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "add") cmdSliceAdd(rest, globalMotive);
  else if (sub === "complete") cmdSliceComplete(rest, globalMotive);
  else if (sub === "claim") cmdSliceClaim(rest, globalMotive);
  else if (sub === "set-ac") cmdSliceSetAc(rest, globalMotive);
  else if (sub === "status") cmdSliceStatus(globalMotive);
  else if (sub === "rm") cmdSliceRm(rest, globalMotive);
  else { process.stderr.write(`unknown slice subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "gate") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "status") cmdGateStatus(rest);
  else if (sub && (GATE_VERDICTS as readonly string[]).includes(sub.toUpperCase())) cmdGateVerdict(sub, rest, globalMotive);
  else { process.stderr.write(`unknown gate subcommand: ${sub ?? "(none)"}\nvalid: ${GATE_VERDICTS.map(v => v.toLowerCase()).join(", ")}\n`); process.exit(1); }
} else if (cmd === "scope") {
  cmdScope(argv[1], argv.slice(2), globalMotive);
} else if (cmd === "hold") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "set") cmdHoldSet(rest, globalMotive);
  else if (sub === "clear") cmdHoldClear(rest, globalMotive);
  else { process.stderr.write(`unknown hold subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "approve") {
  cmdApprove(argv.slice(1), globalMotive);
} else if (cmd === "event") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "append") cmdEventAppend(rest, globalMotive);
  else { process.stderr.write(`unknown event subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "compile") {
  cmdCompile(argv.slice(1), globalMotive);
} else if (cmd === "archive") {
  cmdArchive(argv.slice(1), globalMotive);
} else if (cmd === "migrate") {
  cmdMigrate(argv.slice(1));
} else if (cmd === "recipe") {
  process.stdout.write(renderRecipe());
} else if (cmd === "motive") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "add") cmdMotiveAdd(rest, globalMotive);
  else if (sub === "use") cmdMotiveUse(rest);
  else if (sub === "list") cmdMotiveList();
  else if (sub === "complete") cmdMotiveComplete(rest, globalMotive);
  else { process.stderr.write(`unknown motive subcommand: ${sub}\nsubcommands: add, use, list, complete\n`); process.exit(1); }
} else {
  process.stderr.write(`unknown command: ${cmd ?? "(none)"}\ncommands: init, token, slice add|complete|claim|set-ac|status|rm, gate status [--json]|${GATE_VERDICTS.map(v => v.toLowerCase()).join("|")}, scope link|unlink|verify, hold set|clear, approve charter|spec [--auto], event append, compile, motive add|use|list|complete, archive, migrate, recipe\n`);
  process.exit(1);
}
