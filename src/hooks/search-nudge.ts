/**
 * Search-nudge hook (PreToolUse).
 * Counts code searches per prompt on the main thread; on the 3rd one, emits
 * a single reminder line suggesting groundwork:explore. Never blocks.
 *
 * Code search = Grep, Glob, or a Bash command whose primary invocation is
 * grep/rg/find/ag/git-grep (not a pipeline filter like `cmd | grep foo`).
 */

import os from "node:os";
import path from "node:path";

const NUDGE = "3 code searches this turn — spawn groundwork:explore for the rest.";

const SEARCH_CMD_RE =
  /(?:^|[;\n]|\s*(?:&&|\|\|)\s*)\s*(?:grep|rg|find|ag|git\s+grep)\b/;

function isEmbedded(env: Record<string, string | undefined>): boolean {
  return (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk-");
}

function stripQuoted(cmd: string): string {
  return cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/** True when a Bash command runs a search tool as a primary command, not a pipeline filter. */
export function isBashSearch(command: string): boolean {
  return SEARCH_CMD_RE.test(stripQuoted(command));
}

function counterPath(dir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 64);
  return path.join(dir, `search-nudge-counter.${safe}.json`);
}

interface Counter {
  prompt_id: string;
  count: number;
}

async function readCounter(file: string): Promise<Counter> {
  try {
    return JSON.parse(await Bun.file(file).text()) as Counter;
  } catch {
    return { prompt_id: "", count: 0 };
  }
}

async function writeCounter(file: string, counter: Counter): Promise<void> {
  await Bun.write(file, JSON.stringify(counter));
}

export async function check(input: unknown): Promise<void> {
  const env = process.env as Record<string, string | undefined>;
  if (env.GW_SEARCH_NUDGE_DISABLE === "1") return;
  if (isEmbedded(env)) return;

  const inp = (input ?? {}) as Record<string, unknown>;
  if (typeof inp.agent_type === "string" && inp.agent_type.length > 0) return;

  const toolName = typeof inp.tool_name === "string" ? inp.tool_name : "";
  let isSearch = false;
  if (toolName === "Grep" || toolName === "Glob") {
    isSearch = true;
  } else if (toolName === "Bash") {
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    const cmd = typeof ti.command === "string" ? ti.command : "";
    isSearch = isBashSearch(cmd);
  }
  if (!isSearch) return;

  const sessionId = typeof inp.session_id === "string" ? inp.session_id : "default";
  const promptId = typeof inp.prompt_id === "string" ? inp.prompt_id : "default";
  const scratchpadDir = typeof inp.scratchpad_dir === "string" ? inp.scratchpad_dir : "";
  const dir = scratchpadDir || os.tmpdir();

  const file = counterPath(dir, sessionId);
  const prev = await readCounter(file);
  const count = prev.prompt_id === promptId ? prev.count + 1 : 1;
  await writeCounter(file, { prompt_id: promptId, count });

  if (count === 3) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NUDGE },
      }) + "\n",
    );
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  await check(input).catch(() => {});
}
