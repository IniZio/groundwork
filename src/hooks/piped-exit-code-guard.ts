/**
 * Family 5: Exit-code integrity.
 * Design level: port-only (D-11: v1 piped-exit-code-guard.ts is already minimal at 57 lines;
 * re-deriving would produce the same regex with no saving).
 * Detects a shell command whose exit status is masked by piping through a filter command.
 */

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}

const DENY_REASON =
  "This command reads $? after piping through a filter (head/tail/grep/sort/uniq/wc/cut/awk/sed). " +
  "$? captures the last pipeline element — the filter — not the upstream command. " +
  "Filter commands almost always exit 0, so the check is a silent no-op. " +
  "Remedies: " +
  "(1) use ${PIPESTATUS[0]} to read the first command's exit status; " +
  "(2) drop the pipe and capture a count: n=$(cmd | wc -l); echo $n.";

const PIPED_EXIT_RE =
  /\|[^|;\n&]*\b(?:head|tail|grep|sort|uniq|wc|cut|awk|sed)\b[^|;\n&]*(?:;|\n|&&)[ \t]*(?:echo|printf|test|\[\[?|if|rc=|status=)?[^;\n&|]*\$\?/;

export function check(input: unknown): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    if (inp.tool_name !== "Bash") return allow();
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    const cmd = ti.command;
    if (typeof cmd !== "string" || !cmd.trim()) return allow();
    const stripped = cmd.replace(/'[^']*'/g, "''");
    if (PIPED_EXIT_RE.test(stripped)) return deny(DENY_REASON);
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
