export interface HookResult { stdout: string; stderr: string; exit: number }

function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const READ_TOOLS  = new Set(["Read", "Grep", "Glob"]);
const STORE_PATH_RE = /\.groundwork\/[^/\s]*\.db\b/;

/**
 * Secret-string detection: any text containing these literals is considered a
 * reference to the groundwork secret store.  Covers expanded paths, globs,
 * find/ls output, and shell variables whose value contains these strings.
 * A determined subagent building the path fully dynamically (e.g. a bun -e
 * script computing $HOME at runtime) could still bypass this; the HMAC seal
 * is the primary security control against forged verdicts.
 */
const SECRET_STRINGS: RegExp[] = [
  /\.config\/groundwork\b/,
  /groundwork\/repos\b/,
  /\bwrite\.token\b/,
  /\bseal\.key\b/,
];

function touchesSecret(text: string): boolean {
  return SECRET_STRINGS.some(re => re.test(text));
}

/**
 * Patterns matching a subagent invoking the gw CLI's token-printing commands.
 * Covers bare gw init, $GW init, and bun .../main.ts init forms.
 */
const GW_SECRET_CMDS: RegExp[] = [
  /(?:^|[;&\n|])\s*(?:gw|\$GW)\s+init\b/,
  /(?:^|[;&\n|])\s*(?:gw|\$GW)\s+token\b/,
  /\bmain\.ts\s+init\b/,
  /\bmain\.ts\s+token\b/,
  /\bbun\b[^|;&\n]*\binit\b/,
];

function isGwSecretCmd(cmd: string): boolean {
  return GW_SECRET_CMDS.some(re => re.test(cmd));
}

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
    const isSubagent = typeof inp.agent_type === "string" && inp.agent_type.length > 0;

    if (WRITE_TOOLS.has(tool)) {
      const fp = typeof ti.file_path === "string" ? ti.file_path : "";
      if (STORE_PATH_RE.test(fp)) {
        return deny(`store-write-guard: ${tool} to store db path "${fp}" denied — mutate store only via WorkStore API.`);
      }
    }

    if (isSubagent) {
      if (READ_TOOLS.has(tool) || WRITE_TOOLS.has(tool)) {
        const fp = typeof ti.file_path === "string" ? ti.file_path
          : typeof ti.pattern === "string" ? ti.pattern : "";
        if (touchesSecret(fp)) {
          return deny(`token-guard: subagent ${tool} referencing groundwork secret location denied.`);
        }
      }
      if (tool.toLowerCase() === "bash") {
        const cmd = typeof ti.command === "string" ? ti.command : "";
        if (touchesSecret(cmd)) {
          return deny(`token-guard: subagent bash referencing groundwork secret location denied.`);
        }
        if (isGwSecretCmd(cmd)) {
          return deny(`token-guard: subagent cannot invoke gw init/token — token must be passed explicitly.`);
        }
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
