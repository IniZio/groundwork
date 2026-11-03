/**
 * Resolves the hook caller's agent definition type. An in-process agent-teams teammate
 * (Claude Code 2.1.317) reports its teammate *name* as `agent_type`, so the real type
 * comes from the team config's member record.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultTeamsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "teams");
}

interface Member { name?: unknown; agentType?: unknown }
interface TeamConfig { leadSessionId?: unknown; createdAt?: unknown; members?: unknown }

function readTeams(teamsDir: string): TeamConfig[] {
  const out: TeamConfig[] = [];
  let names: string[];
  try { names = readdirSync(teamsDir); } catch { return out; }
  for (const n of names) {
    try {
      const cfg = JSON.parse(readFileSync(join(teamsDir, n, "config.json"), "utf8")) as TeamConfig;
      if (cfg && typeof cfg === "object") out.push(cfg);
    } catch { /* not a team */ }
  }
  return out;
}

function memberType(cfg: TeamConfig, name: string): string | null {
  if (!Array.isArray(cfg.members)) return null;
  const m = (cfg.members as Member[]).find((x) => x && x.name === name);
  return m && typeof m.agentType === "string" && m.agentType ? m.agentType : null;
}

/** The caller's agent type as recorded by Claude Code, with teammate names mapped through the team config. */
export function resolveCallerAgentType(input: unknown, teamsDir: string = defaultTeamsDir()): string | null {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    const raw = typeof inp.agent_type === "string" && inp.agent_type ? inp.agent_type : null;
    if (!raw) return null;
    if (raw.includes(":")) return raw;
    const teams = readTeams(teamsDir);
    const session = typeof inp.session_id === "string" ? inp.session_id : "";
    const own = teams.find((t) => t.leadSessionId === session);
    const fromOwn = own ? memberType(own, raw) : null;
    if (fromOwn) return fromOwn;
    const others = teams
      .filter((t) => t !== own)
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    for (const t of others) {
      const ty = memberType(t, raw);
      if (ty) return ty;
    }
    return raw;
  } catch {
    return null;
  }
}
