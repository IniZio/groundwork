import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/agent-spawn-guard.js";

const HOOK = new URL("../../src/hooks/agent-spawn-guard.ts", import.meta.url).pathname;

function agent(subagent_type: string, caller?: string, model?: string) {
  return {
    tool_name: "Agent",
    tool_input: { subagent_type, prompt: "p", ...(model ? { model } : {}) },
    ...(caller ? { agent_type: caller, agent_id: "abc123" } : {}),
  };
}

function out(result: { stdout: string }) {
  const s = result.stdout.trim();
  if (!s) return { decision: "allow", model: undefined, prompt: undefined };
  const h = (JSON.parse(s) as {
    hookSpecificOutput: { permissionDecision: string; updatedInput?: { model?: string; prompt?: string } };
  }).hookSpecificOutput;
  return { decision: h.permissionDecision, model: h.updatedInput?.model, prompt: h.updatedInput?.prompt };
}

describe("agent-spawn-guard — junior caller", () => {
  it("main thread spawning groundwork:junior → deny", () => {
    expect(out(check(agent("groundwork:junior"))).decision).toBe("deny");
  });

  it("another subagent spawning groundwork:junior → deny", () => {
    expect(out(check(agent("groundwork:junior", "general-purpose"))).decision).toBe("deny");
  });

  it("pstack:poteto-agent spawning groundwork:junior → allow, input untouched", () => {
    expect(check(agent("groundwork:junior", "pstack:poteto-agent")).stdout).toBe("");
  });

  it("the deny names the allowed caller", () => {
    const s = check(agent("groundwork:junior")).stdout;
    expect(s).toContain("pstack:poteto-agent");
  });
});

describe("agent-spawn-guard — Explore model", () => {
  it("Explore with no model → allow on sonnet, rest of input kept", () => {
    const r = out(check(agent("Explore")));
    expect(r.decision).toBe("allow");
    expect(r.model).toBe("sonnet");
    expect(r.prompt).toBe("p");
  });

  it("Explore with an explicit model → left alone", () => {
    expect(check(agent("Explore", undefined, "opus")).stdout).toBe("");
  });

  it("other agent types → left alone", () => {
    expect(check(agent("pstack:poteto-agent", undefined, "sonnet")).stdout).toBe("");
    expect(check(agent("groundwork:git")).stdout).toBe("");
  });

  it("non-Agent tools → left alone", () => {
    expect(check({ tool_name: "Bash", tool_input: { command: "ls" } }).stdout).toBe("");
  });
});

describe("agent-spawn-guard — poteto-agent model", () => {
  it("poteto-agent with no model → deny, naming the role rule", () => {
    const s = check(agent("pstack:poteto-agent")).stdout;
    expect(out({ stdout: s }).decision).toBe("deny");
    expect(s).toContain("pstack-models.md");
  });

  it("poteto-agent with a blank model → deny", () => {
    expect(out(check(agent("pstack:poteto-agent", undefined, " "))).decision).toBe("deny");
  });

  it("poteto-agent with an explicit model → allow, input untouched", () => {
    expect(check(agent("pstack:poteto-agent", undefined, "opus")).stdout).toBe("");
    expect(check(agent("pstack:poteto-agent", "pstack:poteto-agent", "sonnet")).stdout).toBe("");
  });
});

describe("agent-spawn-guard — as the harness runs it", () => {
  it("spawned by path, denies main-thread junior and sets Explore model", () => {
    const run = (payload: unknown) =>
      spawnSync("bun", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
    const j = run(agent("groundwork:junior"));
    expect(j.status).toBe(0);
    expect(out({ stdout: j.stdout }).decision).toBe("deny");
    const e = run(agent("Explore"));
    expect(e.status).toBe(0);
    expect(out({ stdout: e.stdout }).model).toBe("sonnet");
    const p = run(agent("pstack:poteto-agent"));
    expect(p.status).toBe(0);
    expect(out({ stdout: p.stdout }).decision).toBe("deny");
  });
});
