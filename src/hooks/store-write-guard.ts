export interface HookResult { stdout: string; stderr: string; exit: number }

function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

import { posix } from "node:path";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const LINK_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const GW_ONLY_PATH_RE = /(?:^|\/)\.groundwork\/(?:parent$|inbox\/.)/;
const STORE_PATH_RE = /\.groundwork\/[^/\s]*\.db\b/;

const BASH_DENY: Array<[RegExp, string]> = [
  [/\bsqlite3\b[^|;&\n]*\.groundwork\/[^|;&\n\s]*\.db\b[^|;&\n]*\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE)\b/i, "sqlite3 mutation of store db"],
  [/>{1,2}\s*\S*\.groundwork\/[^/\s]*\.db\b/, "shell redirection into store db"],
  [/(?:^|[;&\n])\s*rm\b[^|;&\n]*\.groundwork\/[^/\s]*\.db\b/, "rm of store db"],
  [/(?:^|[;&\n])\s*mv\b[^|;&\n]*\.groundwork\/[^/\s]*\.db\b/, "mv involving store db"],
  [/(?:^|[;&\n])\s*cp\b\s+(?:\S+\s+)+\.groundwork\/[^/\s]*\.db\b/, "cp with store db as destination"],
];

export function check(input: unknown): HookResult {
  try {
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const tool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;

    if (WRITE_TOOLS.has(tool)) {
      const fp = typeof ti.file_path === "string" ? ti.file_path : "";
      if (STORE_PATH_RE.test(fp)) {
        return deny(`store-write-guard: ${tool} to store db path "${fp}" denied — mutate store only via WorkStore API.`);
      }
    }

    if (LINK_WRITE_TOOLS.has(tool)) {
      const raw = typeof ti.file_path === "string" ? ti.file_path
        : typeof ti.notebook_path === "string" ? ti.notebook_path : "";
      if (raw && GW_ONLY_PATH_RE.test(posix.normalize(raw.replace(/\\/g, "/")))) {
        return deny(`store-write-guard: ${tool} to "${raw}" denied — this path is written only by gw.`);
      }
    }

    if (tool.toLowerCase() === "bash") {
      const cmd = typeof ti.command === "string" ? ti.command : "";
      for (const [re, label] of BASH_DENY) {
        if (re.test(cmd)) {
          return deny(`store-write-guard: bash blocked — ${label}. Use WorkStore API.`);
        }
      }
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
