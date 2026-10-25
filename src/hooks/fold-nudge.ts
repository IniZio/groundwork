/**
 * Tells a groundwork:junior or groundwork:worker to stop and hand back once it has made
 * too many tool calls. A long run is usually a stuck run, and every turn re-reads the whole context.
 * The caller escalates the receipt to a fresh, stronger agent instead of resuming this one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface HookResult { stdout: string; stderr: string; exit: number }

export const LIMITS = {
  "groundwork:junior": 30,
  "groundwork:worker": 40,
} as const satisfies Record<string, number>;
type Limited = keyof typeof LIMITS;
/** After the first nudge, repeat it every this many calls until the agent stops. */
export const REPEAT = 10;
export const DEFAULT_DIR = path.join(tmpdir(), "groundwork-fold-nudge");

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function nudge(text: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }) + "\n", stderr: "", exit: 0 };
}

export function message(calls: number): string {
  return `fold-nudge: you have made ${calls} tool calls. Stop now and hand back; do not start another step. ` +
    "Leave your edits in place. Report in at most 150 words: the files you touched, the check command with its exit code " +
    "and pass/fail line quoted exactly, what you tried, and what remains. Your caller decides who finishes it.";
}

export function check(input: unknown, dir = DEFAULT_DIR): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    const type = String(inp.agent_type ?? "");
    const limit = Object.hasOwn(LIMITS, type) ? LIMITS[type as Limited] : undefined;
    const id = typeof inp.agent_id === "string" ? inp.agent_id.replace(/[^A-Za-z0-9_-]/g, "") : "";
    if (!limit || !id) return allow();
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, id);
    const calls = (existsSync(file) ? Number(readFileSync(file, "utf8")) || 0 : 0) + 1;
    writeFileSync(file, String(calls));
    if (calls >= limit && (calls - limit) % REPEAT === 0) return nudge(message(calls));
  } catch { /* fail-open */ }
  return allow();
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
