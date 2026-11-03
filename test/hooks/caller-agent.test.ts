import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCallerAgentType } from "../../src/hooks/caller-agent.js";
import { check as spawnCheck } from "../../src/hooks/agent-spawn-guard.js";
import { check as bgCheck } from "../../src/hooks/worker-background-guard.js";

const SPAWN_HOOK = new URL("../../src/hooks/agent-spawn-guard.ts", import.meta.url).pathname;
const BG_HOOK = new URL("../../src/hooks/worker-background-guard.ts", import.meta.url).pathname;

const LEAD = "2ec39a18-333e-4a33-8ddd-ca0012d376b4";
let cfgDir: string;
let teamsDir: string;

function team(name: string, leadSessionId: string, createdAt: number, members: Array<[string, string]>) {
  mkdirSync(join(teamsDir, name), { recursive: true });
  writeFileSync(join(teamsDir, name, "config.json"), JSON.stringify({
    name, createdAt, leadSessionId, leadAgentId: `team-lead@${name}`,
    members: [
      { agentId: `team-lead@${name}`, name: "team-lead", agentType: "team-lead" },
      ...members.map(([n, t]) => ({ agentId: `${n}@${name}`, name: n, agentType: t, tmuxPaneId: "in-process" })),
    ],
  }));
}

beforeAll(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "gw-teams-"));
  teamsDir = join(cfgDir, "teams");
  // the real shape from ~/.claude/teams/session-2ec39a18/config.json on 2026-11-03
  team("session-2ec39a18", LEAD, 2, [["artifact-download", "groundwork:worker"], ["scout", "Explore"]]);
  team("session-older", "0000", 1, [["artifact-download", "general-purpose"], ["only-old", "groundwork:worker"]]);
  mkdirSync(join(teamsDir, "broken"));
  writeFileSync(join(teamsDir, "broken", "config.json"), "{not json");
});

afterAll(() => rmSync(cfgDir, { recursive: true, force: true }));

function hook(agent_type: string | undefined, session_id = LEAD, extra: Record<string, unknown> = {}) {
  return { session_id, hook_event_name: "PreToolUse", ...(agent_type ? { agent_type, agent_id: "x" } : {}), ...extra };
}

describe("resolveCallerAgentType", () => {
  it("a plugin type passes through without touching disk", () => {
    expect(resolveCallerAgentType(hook("groundwork:worker"), "/nonexistent")).toBe("groundwork:worker");
  });

  it("a teammate name maps to the member's agentType in the session's own team", () => {
    expect(resolveCallerAgentType(hook("artifact-download"), teamsDir)).toBe("groundwork:worker");
    expect(resolveCallerAgentType(hook("scout"), teamsDir)).toBe("Explore");
  });

  it("the session's own team wins over an older team with the same member name", () => {
    expect(resolveCallerAgentType(hook("artifact-download", "0000"), teamsDir)).toBe("general-purpose");
  });

  it("a name found only in another team still resolves", () => {
    expect(resolveCallerAgentType(hook("only-old"), teamsDir)).toBe("groundwork:worker");
  });

  it("an unknown name, no agent_type, or a missing teams dir falls back", () => {
    expect(resolveCallerAgentType(hook("nobody"), teamsDir)).toBe("nobody");
    expect(resolveCallerAgentType(hook(undefined), teamsDir)).toBeNull();
    expect(resolveCallerAgentType(hook("artifact-download"), "/nonexistent")).toBe("artifact-download");
  });
});

describe("agent-spawn-guard — junior spawned by a teammate worker", () => {
  const junior = (agent_type?: string) =>
    hook(agent_type, LEAD, { tool_name: "Agent", tool_input: { subagent_type: "groundwork:junior", prompt: "p" } });

  it("teammate named artifact-download (a groundwork:worker) → allow", () => {
    expect(spawnCheck(junior("artifact-download"), teamsDir).stdout).toBe("");
  });

  it("teammate named scout (an Explore) → deny, naming the observed caller", () => {
    const s = spawnCheck(junior("scout"), teamsDir).stdout;
    expect(s).toContain('"deny"');
    expect(s).toContain("caller agent_type: Explore");
  });

  it("main thread → deny still names the main thread", () => {
    expect(spawnCheck(junior(), teamsDir).stdout).toContain("caller agent_type: main thread");
  });

  it("as the harness runs it, with CLAUDE_CONFIG_DIR pointing at the fixture", () => {
    const r = spawnSync("bun", [SPAWN_HOOK], {
      input: JSON.stringify(junior("artifact-download")), encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("worker-background-guard — teammate worker", () => {
  const bg = (agent_type?: string) =>
    hook(agent_type, LEAD, { tool_name: "Bash", tool_input: { command: "make test", run_in_background: true } });

  it("teammate named artifact-download (a groundwork:worker) → deny", () => {
    expect(bgCheck(bg("artifact-download"), teamsDir).stdout).toContain('"deny"');
  });

  it("teammate named scout (an Explore) → allow", () => {
    expect(bgCheck(bg("scout"), teamsDir).stdout).toBe("");
  });

  it("as the harness runs it", () => {
    const r = spawnSync("bun", [BG_HOOK], {
      input: JSON.stringify(bg("artifact-download")), encoding: "utf8",
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"deny"');
  });
});
