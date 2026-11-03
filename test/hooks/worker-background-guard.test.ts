import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/worker-background-guard.js";

const HOOK = new URL("../../src/hooks/worker-background-guard.ts", import.meta.url).pathname;

function bash(opts: { bg?: boolean; agent?: string; tool?: string }) {
  const tool_input: Record<string, unknown> = { command: "timeout 600 make test", description: "t" };
  if (opts.bg !== undefined) tool_input.run_in_background = opts.bg;
  return {
    session_id: "s1",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_name: opts.tool ?? "Bash",
    tool_input,
    ...(opts.agent ? { agent_type: opts.agent, agent_id: "abc123" } : {}),
  };
}

function decision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision;
}

describe("worker-background-guard", () => {
  it("groundwork:worker backgrounding Bash → deny with the fold instruction", () => {
    const r = check(bash({ bg: true, agent: "groundwork:worker" }));
    expect(decision(r)).toBe("deny");
    expect(r.stdout).toContain("foreground under `timeout`");
  });

  it("groundwork:junior backgrounding Bash → deny", () => {
    expect(decision(check(bash({ bg: true, agent: "groundwork:junior" })))).toBe("deny");
  });

  it("groundwork:worker foreground Bash → allow", () => {
    expect(decision(check(bash({ bg: false, agent: "groundwork:worker" })))).toBe("allow");
    expect(decision(check(bash({ agent: "groundwork:worker" })))).toBe("allow");
  });

  it("main thread (no agent_type) backgrounding Bash → allow; the coordinator is told to background", () => {
    expect(decision(check(bash({ bg: true })))).toBe("allow");
  });

  it("another agent type backgrounding Bash → allow", () => {
    expect(decision(check(bash({ bg: true, agent: "general-purpose" })))).toBe("allow");
    expect(decision(check(bash({ bg: true, agent: "Explore" })))).toBe("allow");
  });

  it("non-Bash tool from a worker → allow", () => {
    expect(decision(check(bash({ bg: true, agent: "groundwork:worker", tool: "Read" })))).toBe("allow");
  });

  it("malformed input → allow (fail-open)", () => {
    expect(decision(check(null))).toBe("allow");
    expect(decision(check({ tool_name: "Bash", agent_type: "groundwork:worker", tool_input: "x" }))).toBe("allow");
  });

  it("as the harness runs it: spawned by path, denies the worker and allows the main thread", () => {
    const run = (payload: unknown) => spawnSync("bun", [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
    const w = run(bash({ bg: true, agent: "groundwork:worker" }));
    expect(w.status).toBe(0);
    expect(decision({ stdout: w.stdout })).toBe("deny");
    const m = run(bash({ bg: true }));
    expect(m.status).toBe(0);
    expect(decision({ stdout: m.stdout })).toBe("allow");
  });
});
