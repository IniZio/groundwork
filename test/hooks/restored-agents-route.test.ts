/**
 * T19 — restored-agents-route: registry maps git-master/planner/researcher/designer
 * to their correct models; spawn guard injects them.
 * Spawns src/hooks/spawn-model-guard.ts BY PATH (deployed invocation path).
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/spawn-model-guard.ts");

function run(subagent_type: string): { stdout: string; stderr: string; exit: number } {
  const payload = { tool_name: "Agent", tool_input: { subagent_type } };
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
    cwd: ROOT,
    timeout: 15_000,
  });
  return {
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
    exit: r.status ?? 1,
  };
}

function injectedModel(stdout: string): string {
  const out = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string; updatedInput: { model: string } };
  };
  expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  return out.hookSpecificOutput.updatedInput.model;
}

describe("restored-agents route — T19", () => {
  it("spawn guard injects haiku for groundwork:git-master", () => {
    const result = run("groundwork:git-master");
    expect(result.exit).toBe(0);
    expect(injectedModel(result.stdout)).toBe("haiku");
  });

  it("spawn guard injects opus for groundwork:planner", () => {
    const result = run("groundwork:planner");
    expect(result.exit).toBe(0);
    expect(injectedModel(result.stdout)).toBe("opus");
  });

  it("spawn guard injects opus for groundwork:researcher", () => {
    const result = run("groundwork:researcher");
    expect(result.exit).toBe(0);
    expect(injectedModel(result.stdout)).toBe("opus");
  });

  it("spawn guard injects opus for groundwork:designer", () => {
    const result = run("groundwork:designer");
    expect(result.exit).toBe(0);
    expect(injectedModel(result.stdout)).toBe("opus");
  });
});
