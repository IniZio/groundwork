/**
 * Family 1: Spawn topology + model discipline.
 * Design level: declarative registry lookup.
 * D-11 reuse: v1 agent-model-guard structure; debug logging, prefix warnings, banned-builtins env dropped.
 * D5: depth-allowlist per caller type (replaces dead JUNIOR_BANNED rule).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

export interface HookResult { stdout: string; stderr: string; exit: number }

function deny(r: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: r } }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function inject(ti: Record<string, unknown>, model: string): HookResult {
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: `spawn-model-guard: injected model "${model}" (was unset — would inherit session model)`, updatedInput: { ...ti, model } } }) + "\n", stderr: "", exit: 0 };
}
function redirect(ti: Record<string, unknown>, sliceId: string, fileCount: number, model: string, outsideFiles?: string[]): HookResult {
  const reasonSuffix = outsideFiles && outsideFiles.length > 0
    ? ` (brief files outside slice: ${outsideFiles.map(f => `"${f}"`).join(", ")})`
    : "";
  const reason = `size-guard: slice "${sliceId}" has ${fileCount} files — spawn redirected to groundwork:junior-orchestrator${reasonSuffix}.`;
  const context = `size-guard: slice "${sliceId}" owns ${fileCount} files — spawn was redirected from groundwork:implementer to groundwork:junior-orchestrator; split into ≤2-file leaves.`;
  const prefix = `[size-guard: slice ${sliceId} owns ${fileCount} files — redirected from implementer; split into ≤2-file leaves]`;
  const origPrompt = typeof ti.prompt === "string" ? ti.prompt : "";
  const newPrompt = `${prefix}\n${origPrompt}`;
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: reason,
        additionalContext: context,
        updatedInput: { ...ti, subagent_type: "groundwork:junior-orchestrator", model, prompt: newPrompt },
      }
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

/**
 * Parse the "Files owned" section from a brief prompt.
 * Returns the list of file entries, or null if missing/unparseable.
 * Accepts:
 *   Files owned: file1, file2   (same-line, comma-separated)
 *   Files owned:                 (followed by bullet lines)
 *   **Files owned** — …         (bold syntax, separators: : — -)
 */
export function parseBriefFiles(prompt: string): string[] | null {
  const lines = prompt.split("\n");
  const headerRe = /^\*{0,2}Files\s+owned(?:\s*[:—-])?\*{0,2}(?:\s*[:—-])?\s*(.*)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i].trim());
    if (!m) continue;
    const rest = m[1].trim();
    if (rest) {
      return rest.split(",").map(s => stripEntry(s)).filter(Boolean);
    }
    const files: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const bl = lines[j];
      const bm = /^[\s]*[-*]\s+(.+)/.exec(bl);
      if (!bm) break;
      const entry = stripEntry(bm[1]);
      if (entry) files.push(entry);
    }
    return files.length > 0 ? files : null;
  }
  return null;
}

function stripEntry(s: string): string {
  return s.trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/^`|`$/g, "").trim();
}

/**
 * Returns true if briefFile is within sliceFile: either exact match or sliceFile is a
 * directory prefix (sliceFile ends with a path separator boundary).
 */
export function isWithinSlice(briefFile: string, sliceFiles: string[]): boolean {
  for (const sf of sliceFiles) {
    if (briefFile === sf) return true;
    const prefix = sf.endsWith("/") ? sf : sf + "/";
    if (briefFile.startsWith(prefix)) return true;
  }
  return false;
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

export function check(input: unknown, callerType?: string, projectDir?: string): HookResult {
  try {
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const tool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    if (tool !== "Agent" && tool !== "Task") return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
    const rawSubType = typeof ti.subagent_type === "string" ? ti.subagent_type.trim() : "";
    const subTypeOmitted = rawSubType === "";
    const subType = subTypeOmitted ? "general-purpose" : rawSubType;
    const caller = callerType ?? (typeof inp.agent_type === "string" ? inp.agent_type : "");

    // D5: depth-allowlist — apply only to known groundwork callers.
    if (caller && DEPTH_ALLOWLIST.has(caller)) {
      const allowed = DEPTH_ALLOWLIST.get(caller)!;
      if (!allowed.has(subType)) {
        const list = allowed.size ? [...allowed].join(", ") : "none";
        const spawnedLabel = subTypeOmitted ? `"general-purpose" (subagent_type omitted)` : `"${subType}"`;
        return deny(`depth-guard: "${caller}" may not spawn ${spawnedLabel} — allowed: [${list}].`);
      }
    }

    if (subType === "groundwork:implementer" && caller !== "groundwork:junior-orchestrator") {
      const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
      const sliceMatch = /^SLICE:\s*(\S+)/.exec(prompt.trimStart());
      if (sliceMatch) {
        const sliceId = sliceMatch[1];
        try {
          const projDir = projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? "";
          if (projDir) {
            const dbPath = path.join(projDir, ".groundwork", "work.db");
            const db = new Database(dbPath, { readonly: true, create: false });
            try {
              const row = db.query<{ files: string | null }, [string]>(
                "SELECT files FROM slices WHERE id = ?"
              ).get(sliceId);
              if (row?.files) {
                const fileList: unknown = JSON.parse(row.files);
                if (Array.isArray(fileList) && fileList.length >= 3) {
                  const sliceFiles = fileList as string[];
                  const briefFiles = parseBriefFiles(prompt);
                  if (briefFiles !== null && briefFiles.length >= 1 && briefFiles.length <= 2) {
                    const outside = briefFiles.filter(f => !isWithinSlice(f, sliceFiles));
                    if (outside.length > 0) {
                      const reg = loadRegistry();
                      const joModel = reg["junior-orchestrator"] ?? "sonnet";
                      return redirect(ti, sliceId, sliceFiles.length, joModel, outside);
                    }
                  } else {
                    const reg = loadRegistry();
                    const joModel = reg["junior-orchestrator"] ?? "sonnet";
                    return redirect(ti, sliceId, sliceFiles.length, joModel);
                  }
                }
              }
            } finally {
              db.close();
            }
          }
        } catch { /* fail-open */ }
      }
    }

    // Deny bare built-ins that have a groundwork replacement.
    if (!subType.includes(":")) {
      const lc = subType.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(BANNED_BUILTINS, lc)) {
        const replacement = BANNED_BUILTINS[lc];
        const omitNote = subTypeOmitted ? ` (subagent_type omitted)` : "";
        return deny(`spawn-model-guard: built-in "${subType}"${omitNote} is banned — use "${replacement}" instead.`);
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
  const result = check(input, process.env.CLAUDE_SUBAGENT_TYPE, process.env.CLAUDE_PROJECT_DIR);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
