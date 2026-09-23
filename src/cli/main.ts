#!/usr/bin/env bun
import { WorkStore, EVENT_TYPES } from "../store/store.js";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const gw = process.env.GW ?? `bun ${process.argv[1]}`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function boolFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function dbPath(): string {
  if (process.env.GROUNDWORK_DB) return process.env.GROUNDWORK_DB;
  return path.join(process.cwd(), ".groundwork", "work.db");
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
  const stored = store.getMeta("token");
  if (!stored) {
    process.stderr.write(`error: store has no token — re-run \`${gw} init\`\n`);
    store.close();
    process.exit(1);
  }
  if (t !== stored) {
    process.stderr.write("error: --token required for mutations\n");
    store.close();
    process.exit(1);
  }
}

function cmdInit(args: string[]): void {
  const p = dbPath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const store = new WorkStore(p);
  let tok = store.getMeta("token");
  if (!tok) {
    tok = randomBytes(16).toString("hex");
    store.setMeta("token", tok);
    process.stdout.write(`initialized: ${p}\ntoken: ${tok}\n`);
  } else {
    process.stdout.write(`already initialized: ${p}\n`);
  }
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
    process.stderr.write(`usage: ${gw} slice add <id> [--desc TEXT] [--wave N] [--covers-ac AC-1,AC-3] [--blocked-by a,b] [--acceptance "x;y"] --token T\n`);
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
  const gate = store.getEvents("GATE_APPROVE").length > 0 ? "APPROVED" : "pending";
  const hold = store.getHoldState() ?? "none";
  const motiveLabel = motiveSlug ? `  motive: ${motiveSlug}` : "";
  process.stdout.write(`slices: ${done}/${slices.length} complete  gate: ${gate}  hold: ${hold}${motiveLabel}\n`);
  for (const s of slices) {
    const bl = s.blocked_by ? `  blocked-by=[${s.blocked_by}]` : "";
    const d = s.description ? `  ${s.description.slice(0, 60)}` : "";
    process.stdout.write(`  ${s.status.padEnd(11)} ${s.id}${bl}${d}\n`);
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

function cmdGateApprove(args: string[], motiveSlug?: string): void {
  const citation = flag(args, "--citation");
  if (!citation || !/\S+:\d+/.test(citation)) {
    process.stderr.write("error: --citation must include at least one file:line reference (e.g. src/foo.ts:42)\n");
    process.exit(1);
  }
  const store = requireDb(motiveSlug);
  checkToken(store, args);
  store.appendEvent("GATE_APPROVE", { citation });
  process.stdout.write(`GATE_APPROVE recorded  citation: ${citation}\n`);
  store.close();
}

function cmdHoldSet(args: string[], motiveSlug?: string): void {
  const reason = flag(args, "--reason");
  if (!reason) { process.stderr.write(`usage: ${gw} hold set --reason TEXT --token T\n`); process.exit(1); }
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
  const gateOk = store.getEvents("GATE_APPROVE").length > 0;
  const hold = store.getHoldState();
  const lastPause = store.getLastEvent("PAUSE");
  const pausePayload = lastPause ? JSON.parse(lastPause.payload) as Record<string, unknown> : null;
  const acCoverage = buildAcCoverage(slices);
  const acCoverageObj = Object.fromEntries([...acCoverage.entries()]);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      motive,
      objective: objective ?? null,
      decisions,
      open_slices: openSlices,
      last_pause: pausePayload,
      gate: gateOk ? "APPROVED" : "pending",
      hold: hold ?? null,
      ac_coverage: acCoverageObj,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`motive: ${motive}\n`);
    process.stdout.write(`objective: ${objective ?? "(none)"}\n`);
    process.stdout.write(`gate: ${gateOk ? "APPROVED" : "pending"}\n`);
    process.stdout.write(`hold: ${hold ?? "none"}\n`);
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
  if (sub === "approve") cmdGateApprove(rest, globalMotive);
  else { process.stderr.write(`unknown gate subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "hold") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "set") cmdHoldSet(rest, globalMotive);
  else if (sub === "clear") cmdHoldClear(rest, globalMotive);
  else { process.stderr.write(`unknown hold subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "event") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "append") cmdEventAppend(rest, globalMotive);
  else { process.stderr.write(`unknown event subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "compile") {
  cmdCompile(argv.slice(1), globalMotive);
} else if (cmd === "motive") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "add") cmdMotiveAdd(rest, globalMotive);
  else if (sub === "use") cmdMotiveUse(rest);
  else if (sub === "list") cmdMotiveList();
  else if (sub === "complete") cmdMotiveComplete(rest, globalMotive);
  else { process.stderr.write(`unknown motive subcommand: ${sub}\nsubcommands: add, use, list, complete\n`); process.exit(1); }
} else {
  process.stderr.write(`unknown command: ${cmd ?? "(none)"}\ncommands: init, slice add|complete|claim|set-ac|status|rm, gate approve, hold set|clear, event append, compile, motive add|use|list|complete\n`);
  process.exit(1);
}
