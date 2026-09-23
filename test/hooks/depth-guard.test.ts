import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { check, DEPTH_ALLOWLIST } from "../../src/hooks/spawn-model-guard.js";

const HOOK = new URL("../../src/hooks/spawn-model-guard.ts", import.meta.url).pathname;

function spawnHook(payload: unknown): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_SUBAGENT_TYPE: undefined as unknown as string },
  });
  return { stdout: r.stdout ?? "", exit: r.status ?? 1 };
}

function spawnDecision(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch { return `parse-error(${s.slice(0, 60)})`; }
}

function spawnReason(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason ?? "";
  } catch { return ""; }
}

function agent(subagent_type: string, caller?: string, model?: string) {
  return {
    tool_name: "Agent",
    tool_input: { subagent_type, ...(model ? { model } : {}) },
    ...(caller ? { agent_type: caller, agent_id: "abc123" } : {}),
  };
}

function decision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

function reason(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason ?? "";
  } catch { return ""; }
}

describe("depth-guard (T20)", () => {
  it("DENY: implementer → implementer", () => {
    const r = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(r)).toBe("deny");
    const msg = reason(r);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("ALLOW: implementer → explore", () => {
    const r = check(agent("groundwork:explore", "groundwork:implementer"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: implementer → junior-orchestrator", () => {
    const r = check(agent("groundwork:junior-orchestrator", "groundwork:implementer"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: junior → orchestrator", () => {
    const r = check(agent("groundwork:orchestrator", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: junior → junior-orchestrator", () => {
    const r = check(agent("groundwork:junior-orchestrator", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("ALLOW: junior → implementer", () => {
    const r = check(agent("groundwork:implementer", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: junior → explore", () => {
    const r = check(agent("groundwork:explore", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: junior → advisor", () => {
    const r = check(agent("groundwork:advisor", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("ALLOW: main thread → any agent (no agent_type)", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:implementer" } });
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: main thread → junior-orchestrator", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:junior-orchestrator" } });
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: foreign plugin caller → any agent", () => {
    const r = check(agent("groundwork:implementer", "other-plugin:worker"));
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: foreign plugin caller → orchestrator", () => {
    const r = check(agent("groundwork:orchestrator", "acme:planner"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: explore → anything", () => {
    const r = check(agent("groundwork:explore", "groundwork:explore"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: git-master → anything", () => {
    const r = check(agent("groundwork:explore", "groundwork:git-master"));
    expect(decision(r)).toBe("deny");
  });

  it("deny reason names caller, target, allowed list", () => {
    const r = check(agent("groundwork:implementer", "groundwork:implementer"));
    const msg = reason(r);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("deny reason for explore names 'none' allowed", () => {
    const r = check(agent("groundwork:implementer", "groundwork:explore"));
    const msg = reason(r);
    expect(msg).toContain("none");
  });
});

describe("by-path (entrypoint) — spawn bun src/hooks/spawn-model-guard.ts", () => {
  it("DENY by-path: implementer → implementer (exit 0, JSON deny, reason names both)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
      agent_type: "groundwork:implementer",
      agent_id: "abc123",
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("deny");
    const msg = spawnReason(r.stdout);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("ALLOW by-path: junior → implementer (exit 0, empty stdout)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
      agent_type: "groundwork:junior-orchestrator",
      agent_id: "abc123",
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("allow");
  });

  it("ALLOW by-path: main thread (no agent_type) → implementer (exit 0, empty or inject)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("allow");
  });
});

describe("bite proof — depth-guard sensitivity", () => {
  it("widening implementer allowlist defeats the deny", () => {
    const beforeWiden = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(beforeWiden)).toBe("deny");

    const implementerSet = DEPTH_ALLOWLIST.get("groundwork:implementer") as Set<string>;
    implementerSet.add("groundwork:implementer");

    const afterWiden = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(afterWiden)).toBe("allow");

    implementerSet.delete("groundwork:implementer");

    const afterRestore = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(afterRestore)).toBe("deny");
  });
});
