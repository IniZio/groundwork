/**
 * Family 1: Spawn topology + model discipline.
 * Design level: declarative registry lookup.
 * D-11 reuse: v1 agent-model-guard structure; debug logging, prefix warnings, banned-builtins env dropped.
 * D5: depth-allowlist per caller type (replaces dead JUNIOR_BANNED rule).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface HookResult { stdout: string; stderr: string; exit: number }

function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function inject(ti: Record<string, unknown>, model: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: `spawn-model-guard: injected model "${model}" (was unset — would inherit session model)`, updatedInput: { ...ti, model } } }) + "\n", stderr: "", exit: 0 };
}

/**
 * Flat allowlist per caller agent type (D5).
 * Callers NOT in this map are unrestricted (main thread, orchestrator, non-groundwork plugins).
 * Source of truth for each entry:
 *   junior-orchestrator: ticket T20 — may spawn implementer + explore
 *   implementer/designer/debugger: ticket T20 — leaf implementers → explore only
 *   advisor: agents/advisor.md — no Agent in disallowedTools, delegates read-only work → explore
 *   explore: agents/explore.md — disallowedTools includes Agent → empty set
 *   git-master: agents/git-master.md — tools:[Bash,Read], Agent absent → empty set
 *   planner/researcher: agents/*.md — Agent not in disallowedTools → explore
 *   qa: agents/qa.md — tools includes Agent (delegates haiku walkthroughs) → explore
 */
export const DEPTH_ALLOWLIST = new Map<string, ReadonlySet<string>>([
  ["groundwork:junior-orchestrator", new Set(["groundwork:implementer", "groundwork:explore"])],
  ["groundwork:implementer",         new Set(["groundwork:explore"])],
  ["groundwork:designer",            new Set(["groundwork:explore"])],
  ["groundwork:debugger",            new Set(["groundwork:explore"])],
  ["groundwork:advisor",             new Set(["groundwork:explore"])],
  ["groundwork:explore",             new Set()],
  ["groundwork:git-master",          new Set()],
  ["groundwork:planner",             new Set(["groundwork:explore"])],
  ["groundwork:researcher",          new Set(["groundwork:explore"])],
  ["groundwork:qa",                  new Set(["groundwork:explore"])],
]);

// Built-in agent names that are banned; value is the groundwork replacement to name in the deny reason.
const BANNED_BUILTINS: Record<string, string> = {
  "explore": "groundwork:explore",
  "general-purpose": "groundwork:implementer",
};

export function loadRegistry(): Record<string, string> {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const raw = JSON.parse(readFileSync(path.join(here, "..", "..", "model-registry.json"), "utf8")) as Record<string, unknown>;
    const agents = (raw.agents ?? {}) as Record<string, Record<string, string> | string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(agents)) {
      const m = typeof v === "string" ? v : (v as Record<string, string>)["claude-code"];
      if (m) out[k] = m;
    }
    return out;
  } catch { return {}; }
}

export function check(input: unknown, callerType?: string): HookResult {
  try {
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const tool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    if (tool !== "Agent" && tool !== "Task") return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
    const subType = typeof ti.subagent_type === "string" ? ti.subagent_type.trim() : "";
    const caller = callerType ?? (typeof inp.agent_type === "string" ? inp.agent_type : "");

    // D5: depth-allowlist — apply only to known groundwork callers.
    if (caller && DEPTH_ALLOWLIST.has(caller)) {
      const allowed = DEPTH_ALLOWLIST.get(caller)!;
      if (subType && !allowed.has(subType)) {
        const list = allowed.size ? [...allowed].join(", ") : "none";
        return deny(`depth-guard: "${caller}" may not spawn "${subType}" — allowed: [${list}].`);
      }
    }

    // Deny bare built-ins that have a groundwork replacement.
    if (subType && !subType.includes(":")) {
      const lc = subType.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(BANNED_BUILTINS, lc)) {
        const replacement = BANNED_BUILTINS[lc];
        return deny(`spawn-model-guard: built-in "${subType}" is banned — use "${replacement}" instead.`);
      }
    }

    if (typeof ti.model === "string" && ti.model.trim()) return allow();

    const registry = loadRegistry();
    const rawKey = subType.startsWith("groundwork:") ? subType.slice(11) : subType;
    const key = rawKey.toLowerCase();
    const model = registry[key] ?? registry[rawKey] ?? "sonnet";
    return inject(ti, model);
  } catch { return allow(); }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input, process.env.CLAUDE_SUBAGENT_TYPE);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
