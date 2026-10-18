/**
 * Denies a foreground Bash call that runs a slow or remote operation without
 * `timeout <dur>` and without run_in_background. Such calls have hung a session for an hour.
 */

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}

interface Ctx { inWaitLoop: boolean }
interface SlowOp { name: string; match: (words: string[], ctx: Ctx) => boolean }

const base = (w: string | undefined): string => (w ?? "").split("/").pop() ?? "";
const sub = (words: string[], cmd: string, subs: string[]): boolean =>
  base(words[0]) === cmd && subs.includes(words[1] ?? "");

/** The one list of operations that need a timeout or a background run. */
export const SLOW_OPS: SlowOp[] = [
  { name: "moor start", match: (w) => sub(w, "moor", ["start"]) },
  { name: "moor run", match: (w) => sub(w, "moor", ["run"]) },
  { name: "moor close", match: (w) => sub(w, "moor", ["close"]) },
  { name: "crabbox warmup", match: (w) => sub(w, "crabbox", ["warmup"]) },
  { name: "crabbox run", match: (w) => sub(w, "crabbox", ["run"]) },
  { name: "docker build", match: (w) => sub(w, "docker", ["build"]) },
  { name: "npx agent37", match: (w) => base(w[0]) === "npx" && w.slice(1, 3).includes("agent37") },
  { name: "ssh", match: (w) => base(w[0]) === "ssh" },
  { name: "scp", match: (w) => base(w[0]) === "scp" },
  { name: "wait loop", match: (w, c) => c.inWaitLoop && ["sleep", "pgrep"].includes(base(w[0])) },
];

/** Splits into simple-command segments of words; quoted text stays inside one word. */
function segments(cmd: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let cur = "";
  let has = false;
  const endWord = () => { if (has) words.push(cur); cur = ""; has = false; };
  const endSeg = () => { endWord(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j < 0 ? cmd.length : j;
      cur += cmd.slice(i + 1, end); has = true; i = end;
    } else if (c === '"') {
      i++;
      for (; i < cmd.length && cmd[i] !== '"'; i++) {
        if (cmd[i] === "\\" && i + 1 < cmd.length) i++;
        cur += cmd[i]; has = true;
      }
      has = true;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i]; has = true;
    } else if (";&|\n()`".includes(c)) {
      endSeg();
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      cur += c; has = true;
    }
  }
  endSeg();
  return out;
}

const LEADING_KEYWORDS = new Set(["do", "then", "else", "elif", "if", "!", "{", "}", "time"]);
const WRAPPERS = new Set(["sudo", "exec", "env", "command"]);
const TIMEOUT_ARG_FLAGS = new Set(["-k", "-s", "--kill-after", "--signal"]);

/** Strips env assignments and sudo/exec/env/command prefixes (with their flags). */
function stripPrefixes(words: string[]): string[] {
  let w = words;
  while (w.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!) || WRAPPERS.has(base(w[0])) || (w[0]!.startsWith("-") && w !== words)) w = w.slice(1);
    else break;
  }
  return w;
}

function isTimeoutWrapped(words: string[]): boolean {
  if (base(words[0]) !== "timeout") return false;
  let i = 1;
  while (i < words.length && words[i]!.startsWith("-")) i += TIMEOUT_ARG_FLAGS.has(words[i]!) ? 2 : 1;
  return /^\d+(\.\d+)?[smhd]?$/.test(words[i] ?? "") && i + 1 < words.length;
}

function findSlowOp(cmd: string): string | null {
  const loops: string[] = [];
  for (const seg of segments(cmd)) {
    let w = seg;
    while (w.length && LEADING_KEYWORDS.has(w[0]!)) w = w.slice(1);
    if (w[0] === "done") { loops.pop(); continue; }
    if (w[0] === "while" || w[0] === "until") {
      loops.push("wait");
      w = w.slice(1);
      while (w.length && LEADING_KEYWORDS.has(w[0]!)) w = w.slice(1);
    } else if (w[0] === "for" || w[0] === "select") {
      loops.push("for");
      continue;
    }
    w = stripPrefixes(w);
    if (!w.length || isTimeoutWrapped(w)) continue;
    const ctx = { inWaitLoop: loops.includes("wait") };
    const hit = SLOW_OPS.find((op) => op.match(w, ctx));
    if (hit) return hit.name;
  }
  return null;
}

export function check(input: unknown): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    if (inp.tool_name !== "Bash") return allow();
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    if (ti.run_in_background === true) return allow();
    const cmd = ti.command;
    if (typeof cmd !== "string" || !cmd.trim()) return allow();
    const op = findSlowOp(cmd);
    if (op) {
      return deny(
        `slow-command-timeout-guard: "${op}" can hang the session. ` +
        "Wrap it in `timeout 600 …` or run it in the background with a Monitor until-condition.",
      );
    }
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
