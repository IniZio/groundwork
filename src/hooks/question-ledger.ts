/**
 * Stop/SubagentStop hook. Blocks a turn whose reply asks the user something
 * without recording it through the ask tool, so the question stays on screen with a stable #N.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isHookInput, isRecordedQuestions, isTranscriptEntry } from "./lib/generated/transcript-validators.mjs";
import type { Block, HookInput, RecordedQuestions, TextBlock, TranscriptEntry } from "./lib/transcript-schemas.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

const QUESTION_MARK_RE = /\?(?=[*_)'"\s]|$)/g;
const SELF_ANSWERED_RE = /^[*_):]*\s+(?:Yes|No|Because)\b/;
const MAX_LISTED = 5;
const MAX_LINE = 120;
const MAX_CONSECUTIVE_BLOCKS = 2;
const ASK_TOOL = "mcp__groundwork__ask";

export function questionLines(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^#{1,6}\s/.test(line) || line.startsWith(">") || line.startsWith("|")) continue;
    const probe = line.replace(/`[^`]*`/g, "CODE").replace(/https?:\/\/\S+/g, "URL")
      .replace(/"[^"]*"/g, "QUOTED").replace(/\u201c[^\u201d]*\u201d/g, "QUOTED");
    const asks = [...probe.matchAll(QUESTION_MARK_RE)].some((m) => !SELF_ANSWERED_RE.test(probe.slice(m.index + 1)));
    if (asks) out.push(line);
  }
  return out;
}

const isText = (b: Block): b is TextBlock => b.type === "text" && "text" in b;

function blocks(entry: TranscriptEntry): Block[] {
  const c = entry.message?.content;
  return Array.isArray(c) ? c : [];
}

/** Parses a transcript once: torn, schema-invalid and sidechain lines are dropped. */
export function parseTranscript(raw: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const l of raw.split("\n")) {
    if (!l.trim()) continue;
    let v: unknown;
    try { v = JSON.parse(l); } catch { continue; }
    if (isTranscriptEntry(v) && v.isSidechain !== true) out.push(v);
  }
  return out;
}

export function isGenuineUser(entry: TranscriptEntry): boolean {
  if (entry.type !== "user") return false;
  const c = entry.message?.content;
  if (typeof c === "string") return !c.trimStart().startsWith("<");
  return blocks(entry).some((b) => isText(b) && !b.text.trimStart().startsWith("<"));
}

/** Entries split at each genuine user message; the first slice precedes the first one, the last follows the final one. */
function turnSlices(entries: TranscriptEntry[]): TranscriptEntry[][] {
  const slices: TranscriptEntry[][] = [[]];
  for (const e of entries) {
    if (isGenuineUser(e)) slices.push([]);
    else slices.at(-1)!.push(e);
  }
  return slices;
}

function assistantTexts(slice: TranscriptEntry[]): string[] {
  return slice.filter((e) => e.type === "assistant").flatMap((e) => blocks(e).filter(isText).map((b) => b.text));
}

/** Assistant text per user-delimited turn, skipping turns with none. */
export function turns(entries: TranscriptEntry[]): string[][] {
  return turnSlices(entries).map(assistantTexts).filter((t) => t.length > 0);
}

/** The mod's ledger file for this session; null when the ask tool is not live in it. */
export function readLedger(home: string, sessionId: string | undefined): RecordedQuestions | null {
  if (sessionId === undefined || !/^[\w-]+$/.test(sessionId)) return null;
  let v: unknown;
  try { v = JSON.parse(readFileSync(path.join(home, ".claude", "groundwork", "questions", `${sessionId}.json`), "utf8")); } catch { return null; }
  return isRecordedQuestions(v) ? v : null;
}

export interface Verdict { uncovered: string[] }

export function evaluate(entries: TranscriptEntry[], recorded: readonly number[], lastMessage?: string): Verdict {
  const ids = new Set(recorded);
  const uncovered: string[] = [];
  const texts = assistantTexts(turnSlices(entries).at(-1)!);
  if (lastMessage !== undefined && texts.at(-1) !== lastMessage) texts.push(lastMessage);
  for (const t of texts) {
    for (const line of questionLines(t)) {
      const covered = [...line.matchAll(/(?<![\w#])#(\d+)\b/g)].some((m) => ids.has(Number(m[1])));
      if (!covered) uncovered.push(line);
    }
  }
  return { uncovered };
}

function silentAllow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

export function reasonFor(uncovered: string[]): string {
  const lines = uncovered.slice(0, MAX_LISTED).map((l) => `- ${l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l}`);
  return [
    "These lines ask the user something but were not recorded:",
    ...lines,
    `For each: call \`${ASK_TOOL}\` (load it with ToolSearch if it is deferred) with the question, your recommended answer and your agent name as source. End your turn with one line per question: \`#N <question> Recommend: <answer>\`. A line that is not a question for the user: say it as a statement.`,
  ].join("\n");
}

function counterFile(sessionId: string, agentKey: string): string {
  const dir = path.join(os.tmpdir(), "groundwork-question-ledger");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sessionId}-${agentKey}`.replace(/[^\w.-]/g, "_") + ".count");
}

function readCount(p: string): number {
  try { return Number.parseInt(readFileSync(p, "utf8"), 10) || 0; } catch { return 0; }
}

export function run(inp: HookInput, env: Record<string, string | undefined>): HookResult {
  try {
    if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js") return silentAllow();
    const event = inp.hook_event_name ?? inp.event;
    if (event !== "Stop" && event !== "SubagentStop") return silentAllow();
    const ledger = readLedger(env.HOME ?? os.homedir(), inp.session_id);
    if (ledger === null) return silentAllow();
    const tp = event === "SubagentStop" ? (inp.agent_transcript_path ?? inp.transcript_path) : inp.transcript_path;
    if (tp === undefined || !existsSync(tp)) return silentAllow();
    const { uncovered } = evaluate(parseTranscript(readFileSync(tp, "utf8")), ledger.recorded, inp.last_assistant_message);
    const cf = counterFile(inp.session_id ?? "unknown", event === "SubagentStop" && inp.agent_id ? inp.agent_id : "main");
    if (uncovered.length === 0) { writeFileSync(cf, "0"); return silentAllow(); }

    const blocked = readCount(cf);
    if (blocked >= MAX_CONSECUTIVE_BLOCKS) {
      writeFileSync(cf, "0");
      return { stdout: JSON.stringify({ systemMessage: `question-ledger: ${uncovered.length} question(s) not recorded` }) + "\n", stderr: "", exit: 0 };
    }
    writeFileSync(cf, String(blocked + 1));
    return { stdout: JSON.stringify({ decision: "block", reason: reasonFor(uncovered) }) + "\n", stderr: "", exit: 0 };
  } catch {
    return silentAllow();
  }
}

if (import.meta.main) {
  let inp: HookInput = {};
  try {
    const parsed = JSON.parse(await Bun.stdin.text());
    if (isHookInput(parsed)) inp = parsed;
  } catch { /* fail open */ }
  const r = run(inp, process.env);
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
