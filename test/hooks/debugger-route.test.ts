/**
 * T17 — debugger-route: registry maps debugger → opus; spawn guard injects it.
 * Uses spawn-model-guard BY PATH to exercise the deployed invocation path.
 */
import { describe, it, expect } from "bun:test";
import { check, loadRegistry } from "../../src/hooks/spawn-model-guard.js";

function agent(subagent_type: string, model?: string) {
  return { tool_name: "Agent", tool_input: { subagent_type, ...(model ? { model } : {}) } };
}

describe("debugger route — T17", () => {
  it("registry maps debugger to opus", () => {
    const reg = loadRegistry();
    expect(reg["debugger"]).toBe("opus");
  });

  it("spawn guard injects opus for groundwork:debugger (no model set)", () => {
    const result = check(agent("groundwork:debugger"));
    expect(result.exit).toBe(0);
    const out = JSON.parse(result.stdout) as {
      hookSpecificOutput: { permissionDecision: string; updatedInput: { model: string } };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("opus");
  });

  it("spawn guard passes through when model already set", () => {
    const result = check(agent("groundwork:debugger", "opus"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });
});
