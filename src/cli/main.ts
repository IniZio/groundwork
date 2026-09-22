#!/usr/bin/env bun
import { WorkStore, EVENT_TYPES } from "../store/store.js";
import { mkdirSync, existsSync, readFileSync, createReadStream, statSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
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

function requireDb(): WorkStore {
  const p = dbPath();
  if (!existsSync(p)) {
    process.stderr.write(`error: no work store found — run \`${gw} init\` first\n`);
    process.exit(1);
  }
  return new WorkStore(p);
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

function cmdInit(): void {
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
  store.close();
}

function cmdSliceAdd(args: string[]): void {
  const id = args[0];
  if (!id || id.startsWith("-")) {
    process.stderr.write(`usage: ${gw} slice add <id> [--desc TEXT] [--wave N] [--blocked-by a,b] [--acceptance "x;y"] --token T\n`);
    process.exit(1);
  }
  const store = requireDb();
  checkToken(store, args);
  store.insertSlice({
    id,
    wave: parseInt(flag(args, "--wave") ?? "0", 10),
    status: "pending",
    description: flag(args, "--desc") ?? null,
    acceptance: flag(args, "--acceptance") ?? null,
    blocked_by: flag(args, "--blocked-by") ?? null,
    covers_ac: null,
    decisions: null,
  });
  process.stdout.write(`slice ${id} added\n`);
  store.close();
}

function cmdSliceComplete(args: string[]): void {
  const id = args[0];
  if (!id) { process.stderr.write(`usage: ${gw} slice complete <id> --token T\n`); process.exit(1); }
  const store = requireDb();
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

function cmdSliceStatus(): void {
  const store = requireDb();
  const slices = store.getAllSlices();
  const done = slices.filter(s => s.status === "complete" || s.status === "archived").length;
  const gate = store.getEvents("GATE_APPROVE").length > 0 ? "APPROVED" : "pending";
  const hold = store.getHoldState() ?? "none";
  process.stdout.write(`slices: ${done}/${slices.length} complete  gate: ${gate}  hold: ${hold}\n`);
  for (const s of slices) {
    const bl = s.blocked_by ? `  blocked-by=[${s.blocked_by}]` : "";
    const d = s.description ? `  ${s.description.slice(0, 60)}` : "";
    process.stdout.write(`  ${s.status.padEnd(11)} ${s.id}${bl}${d}\n`);
  }
  store.close();
}

function cmdSliceRm(args: string[]): void {
  const id = args[0];
  if (!id) { process.stderr.write(`usage: ${gw} slice rm <id> --token T\n`); process.exit(1); }
  const store = requireDb();
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

function cmdGateApprove(args: string[]): void {
  const citation = flag(args, "--citation");
  if (!citation || !/\S+:\d+/.test(citation)) {
    process.stderr.write("error: --citation must include at least one file:line reference (e.g. src/foo.ts:42)\n");
    process.exit(1);
  }
  const store = requireDb();
  checkToken(store, args);
  store.appendEvent("GATE_APPROVE", { citation });
  process.stdout.write(`GATE_APPROVE recorded  citation: ${citation}\n`);
  store.close();
}

function cmdHoldSet(args: string[]): void {
  const reason = flag(args, "--reason");
  if (!reason) { process.stderr.write(`usage: ${gw} hold set --reason TEXT --token T\n`); process.exit(1); }
  const store = requireDb();
  checkToken(store, args);
  store.appendEvent("HOLD", { reason });
  process.stdout.write(`hold set: ${reason}\n`);
  store.close();
}

function cmdHoldClear(args: string[]): void {
  const store = requireDb();
  checkToken(store, args);
  store.appendEvent("HOLD_CLEAR", {});
  process.stdout.write("hold cleared\n");
  store.close();
}

function cmdEventAppend(args: string[]): void {
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
  const store = requireDb();
  checkToken(store, args);
  store.appendEvent(type, { msg, ...data });
  process.stdout.write(`event ${type} appended\n`);
  store.close();
}

function cmdCompile(args: string[]): void {
  const asJson = boolFlag(args, "--json");
  const store = requireDb();
  const charter = store.getCharter();
  const slices = store.getAllSlices();
  const openSlices = slices.filter(s => s.status === "pending" || s.status === "in_progress");
  const decisions = store.getAllDecisions();
  const gateOk = store.getEvents("GATE_APPROVE").length > 0;
  const hold = store.getHoldState();
  const lastPause = store.getLastEvent("PAUSE");
  const pausePayload = lastPause ? JSON.parse(lastPause.payload) as Record<string, unknown> : null;

  if (asJson) {
    process.stdout.write(JSON.stringify({
      objective: charter?.objective ?? null,
      decisions,
      open_slices: openSlices,
      last_pause: pausePayload,
      gate: gateOk ? "APPROVED" : "pending",
      hold: hold ?? null,
    }, null, 2) + "\n");
  } else {
    process.stdout.write(`objective: ${charter?.objective ?? "(none)"}\n`);
    process.stdout.write(`gate: ${gateOk ? "APPROVED" : "pending"}\n`);
    process.stdout.write(`hold: ${hold ?? "none"}\n`);
    process.stdout.write(`open slices (${openSlices.length}):\n`);
    for (const s of openSlices) {
      process.stdout.write(`  ${s.id} [wave ${s.wave}] ${s.status}${s.blocked_by ? ` blocked-by=${s.blocked_by}` : ""}\n`);
    }
    process.stdout.write(`decisions (${decisions.length}):\n`);
    for (const d of decisions) {
      process.stdout.write(`  ${d.id} [${d.status}] ${d.decision.slice(0, 80)}\n`);
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

interface V1Slice {
  id: string;
  wave?: number;
  status?: string;
  desc?: string;
  acceptance?: string[] | string | null;
  blocked_by?: string[] | string | null;
  decisions?: string[] | string | null;
}

interface V1JournalEntry {
  ts?: string;
  session?: string;
  motive?: string;
  type?: string;
  verdict?: string;
  msg?: string;
  data?: Record<string, unknown>;
}

function mapV1Type(entry: V1JournalEntry): string | null {
  const t = entry.type ?? "";
  const verdict = (entry.data?.verdict as string | undefined) ?? entry.verdict;
  if (t === "GATE" && verdict === "APPROVE") return "GATE_APPROVE";
  if (t === "TASK_COMPLETE") return "SLICE_COMPLETE";
  if ((EVENT_TYPES as readonly string[]).includes(t)) return t;
  return null;
}

async function cmdImportV1(args: string[]): Promise<void> {
  const ledgerPath = flag(args, "--ledger");
  const journalPath = flag(args, "--journal");
  const motiveSlug = flag(args, "--motive");
  if (!ledgerPath || !journalPath || !motiveSlug) {
    process.stderr.write(`usage: ${gw} import-v1 --ledger PATH --journal PATH --motive SLUG --token T\n`);
    process.exit(1);
  }
  const store = requireDb();
  checkToken(store, args);

  let sliceCount = 0;
  try {
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as { slices?: V1Slice[] };
    for (const s of ledger.slices ?? []) {
      const rawStatus = s.status ?? "pending";
      const status = rawStatus === "complete" ? "complete"
        : rawStatus === "in_progress" ? "in_progress"
        : rawStatus === "archived" ? "archived"
        : "pending";
      try {
        store.insertSlice({
          id: s.id,
          wave: s.wave ?? 0,
          status: status as "pending" | "in_progress" | "complete" | "archived",
          description: s.desc ?? null,
          acceptance: Array.isArray(s.acceptance) ? s.acceptance.join(";") : (s.acceptance ?? null),
          blocked_by: Array.isArray(s.blocked_by) ? s.blocked_by.join(",") : (s.blocked_by ?? null),
          covers_ac: null,
          decisions: Array.isArray(s.decisions) ? s.decisions.join(",") : (s.decisions ?? null),
        });
        sliceCount++;
      } catch { /* skip duplicates */ }
    }
  } catch (e) {
    process.stderr.write(`error reading ledger: ${e}\n`);
  }

  let eventCount = 0;
  let noMotiveCount = 0;
  const skipped = new Map<string, number>();

  try {
    const stat = statSync(journalPath);
    const files: string[] = stat.isDirectory()
      ? readdirSync(journalPath).filter((f: string) => f.endsWith(".jsonl")).map((f: string) => path.join(journalPath, f))
      : [journalPath];

    for (const file of files) {
      const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as V1JournalEntry;
          if (entry.motive === undefined) { noMotiveCount++; continue; }
          if (entry.motive !== motiveSlug) continue;
          const mapped = mapV1Type(entry);
          if (mapped === null) {
            const raw = entry.type ?? "UNKNOWN";
            skipped.set(raw, (skipped.get(raw) ?? 0) + 1);
            continue;
          }
          store.appendEvent(mapped, { msg: entry.msg ?? "", session: entry.session, ts: entry.ts, ...(entry.data ?? {}) });
          eventCount++;
        } catch { /* skip malformed lines */ }
      }
    }
  } catch (e) {
    process.stderr.write(`error reading journal: ${e}\n`);
  }

  store.upsertCharter(motiveSlug, motiveSlug, `imported from v1 motive: ${motiveSlug}`);

  let out = `import-v1 complete: ${sliceCount} slices, ${eventCount} events`;
  if (skipped.size > 0) {
    const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
    const detail = [...skipped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t}: ${n}`).join(", ");
    out += `, skipped ${skippedTotal} unknown-type (${detail})`;
  }
  if (noMotiveCount > 0) out += `, skipped ${noMotiveCount} no-motive`;
  process.stdout.write(out + "\n");
  store.close();
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === "init") {
  cmdInit();
} else if (cmd === "slice") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "add") cmdSliceAdd(rest);
  else if (sub === "complete") cmdSliceComplete(rest);
  else if (sub === "status") cmdSliceStatus();
  else if (sub === "rm") cmdSliceRm(rest);
  else { process.stderr.write(`unknown slice subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "gate") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "approve") cmdGateApprove(rest);
  else { process.stderr.write(`unknown gate subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "hold") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "set") cmdHoldSet(rest);
  else if (sub === "clear") cmdHoldClear(rest);
  else { process.stderr.write(`unknown hold subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "event") {
  const sub = argv[1];
  const rest = argv.slice(2);
  if (sub === "append") cmdEventAppend(rest);
  else { process.stderr.write(`unknown event subcommand: ${sub}\n`); process.exit(1); }
} else if (cmd === "compile") {
  cmdCompile(argv.slice(1));
} else if (cmd === "import-v1") {
  await cmdImportV1(argv.slice(1));
} else {
  process.stderr.write(`unknown command: ${cmd ?? "(none)"}\ncommands: init, slice add|complete|status|rm, gate approve, hold set|clear, event append, compile, import-v1\n`);
  process.exit(1);
}
