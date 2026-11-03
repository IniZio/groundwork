/**
 * Denies a background Bash call from groundwork:worker or groundwork:junior.
 * A worker's background process dies with its turn, and the idle hand-back carries no receipt,
 * so the coordinator pays for the run and still has to do the check itself.
 */

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}

export const GUARDED_AGENTS = ["groundwork:worker", "groundwork:junior"];

export const REASON =
  "worker-background-guard: a background command dies when your turn ends, and an idle hand-back carries no receipt. " +
  "Run the check in the foreground under `timeout`. If it needs longer than the timeout allows, fold and report that instead.";

export function check(input: unknown): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    if (inp.tool_name !== "Bash") return allow();
    if (!GUARDED_AGENTS.includes(String(inp.agent_type ?? ""))) return allow();
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    if (ti.run_in_background === true) return deny(REASON);
  } catch { /* fail-open */ }
  return allow();
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
