/**
 * Stop/SubagentStop hook. Blocks a turn whose reply asks the user something
 * without a matching question task, so the question stays on screen with a stable #N.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface HookResult { stdout: string; stderr: string; exit: number }

type Entry = Record<string, any>;

const QUESTION_RE = /\?[*_)\s]*($|\(?\s*[*_]*recommend)/i;
const MAX_LISTED = 5;
const MAX_LINE = 120;
const MAX_CONSECUTIVE_BLOCKS = 2;

export function questionLines(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^#{1,6}\s/.test(line) || line.startsWith(">") || line.startsWith("|")) continue;
    const probe = line.replace(/`[^`]*`/g, "CODE").replace(/https?:\/\/\S+/g, "URL");
    if (QUESTION_RE.test(probe)) out.push(line);
  }
  return out;
}

function blocks(entry: Entry): Entry[] {
  const c = entry.message?.content;
  return Array.isArray(c) ? c.filter((b) => b && typeof b === "object") : [];
}

function isGenuineUser(entry: Entry): boolean {
  if (entry.type !== "user") return false;
  const c = entry.message?.content;
  if (typeof c === "string") return !c.trimStart().startsWith("<");
  return blocks(entry).some((b) => b.type === "text" && typeof b.text === "string" && !b.text.trimStart().startsWith("<"));
}

function resultText(block: Entry): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  return "";
}

function recordedQuestionIds(entries: Entry[]): Set<string> {
  const pending = new Set<string>();
  const ids = new Set<string>();
  for (const e of entries) {
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b.type === "tool_use" && b.name === "TaskCreate" && b.input?.metadata?.kind === "question" && typeof b.id === "string") {
        pending.add(b.id);
      } else if (e.type === "user" && b.type === "tool_result" && pending.has(b.tool_use_id)) {
        const m = resultText(b).match(/Task #(\d+) created successfully/);
        if (m) ids.add(m[1]!);
      }
    }
  }
  return ids;
}

export function evaluate(transcriptLines: object[]): { uncovered: string[] } {
  const entries = (transcriptLines as Entry[]).filter((e) => e && e.isSidechain !== true);
  let start = 0;
  entries.forEach((e, i) => { if (isGenuineUser(e)) start = i + 1; });
  const ids = recordedQuestionIds(entries);
  const uncovered: string[] = [];
  for (const e of entries.slice(start)) {
    if (e.type !== "assistant") continue;
    for (const b of blocks(e)) {
      if (b.type !== "text" || typeof b.text !== "string") continue;
      for (const line of questionLines(b.text)) {
        const covered = [...line.matchAll(/(?<![\w#])#(\d+)\b/g)].some((m) => ids.has(m[1]!));
        if (!covered) uncovered.push(line);
      }
    }
  }
  return { uncovered };
}

function silentAllow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

export function reasonFor(uncovered: string[]): string {
  const lines = uncovered.slice(0, MAX_LISTED).map((l) => `- ${l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l}`);
  return [
    "These lines ask the user something but have no question task:",
    ...lines,
    "For each: TaskCreate with subject `❓ <question> (rec: <answer>)` and metadata {kind: \"question\", source: \"<your agent name, or lead>\"}, then TaskUpdate owner \"user\". End your turn with one line per question: `#N <question>? Recommend: <answer>`. A line that is not a question for the user: say it as a statement.",
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

export function run(inp: Record<string, any>, env: Record<string, string | undefined>): HookResult {
  try {
    if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js") return silentAllow();
    const event = inp.hook_event_name ?? inp.event;
    if (event !== "Stop" && event !== "SubagentStop") return silentAllow();
    const tp = event === "SubagentStop" ? (inp.agent_transcript_path ?? inp.transcript_path) : inp.transcript_path;
    if (typeof tp !== "string" || !existsSync(tp)) return silentAllow();
    const raw = readFileSync(tp, "utf8");
    if (!raw.includes("TaskCreate")) return silentAllow();

    const entries: object[] = [];
    for (const l of raw.split("\n")) {
      if (!l.trim()) continue;
      try { entries.push(JSON.parse(l)); } catch { /* skip torn line */ }
    }
    const { uncovered } = evaluate(entries);
    const cf = counterFile(String(inp.session_id ?? "unknown"), event === "SubagentStop" && inp.agent_id ? String(inp.agent_id) : "main");
    if (uncovered.length === 0) { writeFileSync(cf, "0"); return silentAllow(); }

    const blocked = readCount(cf);
    if (blocked >= MAX_CONSECUTIVE_BLOCKS) {
      writeFileSync(cf, "0");
      return { stdout: JSON.stringify({ systemMessage: `question-ledger: ${uncovered.length} question(s) not recorded as tasks` }) + "\n", stderr: "", exit: 0 };
    }
    writeFileSync(cf, String(blocked + 1));
    return { stdout: JSON.stringify({ decision: "block", reason: reasonFor(uncovered) }) + "\n", stderr: "", exit: 0 };
  } catch {
    return silentAllow();
  }
}

if (import.meta.main) {
  let inp: Record<string, any> = {};
  try { inp = JSON.parse(await Bun.stdin.text()); } catch { /* fail open */ }
  const r = run(inp ?? {}, process.env);
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
