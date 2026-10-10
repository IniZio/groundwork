/**
 * PreToolUse on Bash: an agent must not record a human approval.
 * Denies `$GW approve charter|spec` without --auto in any invocation form
 * (absolute path, $GW, bun .../main.ts, env/launcher prefix, bash -c, chains).
 * The human runs it with the `!` prompt prefix, which never fires PreToolUse.
 */

export interface HookResult { stdout: string; stderr: string; exit: number }

const REASON = "approve-guard: agents cannot record a human approval. Ask the human to run `! $GW approve charter|spec --token T` from the prompt (the `!` prefix runs outside agent tools). `$GW approve spec --auto` is allowed.";

function deny(): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

/** Remove unquoted word-start `#` comments up to end of line; `#` inside quotes is kept. */
function stripComments(cmd: string): string {
  let out = "";
  let q = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === "\\" && q === '"') { out += c + (cmd[++i] ?? ""); continue; }
      if (c === q) q = "";
    } else if (c === "\\") {
      out += c + (cmd[++i] ?? ""); continue;
    } else if (c === "'" || c === '"') {
      q = c;
    } else if (c === "#" && (i === 0 || /[\s;&|()]/.test(cmd[i - 1]))) {
      while (i < cmd.length && cmd[i] !== "\n") i++;
      i--; continue;
    }
    out += c;
  }
  return out;
}

/** Drop comments, split on separators and substitution openers, join quote fragments, split words. */
function segments(cmd: string): string[][] {
  return stripComments(cmd)
    .split(/&&|\|\||[;&|\n`()]|\$\(/)
    .map(seg => seg.replace(/["'\\]/g, "").replace(/[{}]/g, " ").split(/\s+/).filter(Boolean));
}

export function isHumanApproval(cmd: string): boolean {
  return segments(cmd).some(toks => {
    const i = toks.indexOf("approve");
    if (i < 0) return false;
    const kind = toks[i + 1];
    if (kind !== "charter" && kind !== "spec" && !kind?.startsWith("$")) return false;
    return !toks.slice(i + 2).includes("--auto");
  });
}

export function check(input: unknown): HookResult {
  try {
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    if (typeof inp.tool_name !== "string" || inp.tool_name.toLowerCase() !== "bash") return allow();
    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
    const cmd = typeof ti.command === "string" ? ti.command : "";
    if (isHumanApproval(cmd)) return deny();
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
