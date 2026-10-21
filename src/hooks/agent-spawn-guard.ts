/** Routes Agent spawns: Explore runs on sonnet, and groundwork:junior takes work only from pstack:poteto-agent. */

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}
function setModel(ti: Record<string, unknown>, model: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: `agent-spawn-guard: Explore runs on ${model}`, updatedInput: { ...ti, model } } }) + "\n", stderr: "", exit: 0 };
}

export const JUNIOR = "groundwork:junior";
export const JUNIOR_CALLER = "pstack:poteto-agent";
export const EXPLORE_MODEL = "sonnet";

const JUNIOR_DENY =
  `${JUNIOR} takes leaf work only from ${JUNIOR_CALLER}. ` +
  `Spawn a ${JUNIOR_CALLER} for the task and brief it to fan out the mechanical leaves to ${JUNIOR}.`;

export function check(input: unknown): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    if (inp.tool_name !== "Agent" && inp.tool_name !== "Task") return allow();
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    const subType = typeof ti.subagent_type === "string" ? ti.subagent_type : "";
    if (subType === JUNIOR && inp.agent_type !== JUNIOR_CALLER) return deny(JUNIOR_DENY);
    const hasModel = typeof ti.model === "string" && ti.model.trim() !== "";
    if (subType.toLowerCase() === "explore" && !hasModel) return setModel(ti, EXPLORE_MODEL);
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
