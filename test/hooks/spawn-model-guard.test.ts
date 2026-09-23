import { describe, it, expect } from "bun:test";
import { check, loadRegistry } from "../../src/hooks/spawn-model-guard.js";

function task(subagent_type: string, model?: string) {
  return { tool_name: "Task", tool_input: { subagent_type, ...(model ? { model } : {}) } };
}

/**
 * Parse hook stdout safely.
 * Empty stdout is the allow-by-silence contract; treat it as permissionDecision:"allow"
 * so VIOLATION tests fail with "expected deny, got allow" instead of a SyntaxError.
 */
function safeDecision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

describe("spawn-model-guard — Family 1", () => {
  it("VIOLATION: junior-orchestrator spawning junior-orchestrator → deny", () => {
    const result = check(task("groundwork:junior-orchestrator"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: junior-orchestrator spawning orchestrator → deny", () => {
    const result = check(task("groundwork:orchestrator"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: primary orchestrator spawning junior-orchestrator → inject model (allow)", () => {
    const result = check(task("groundwork:junior-orchestrator"), "groundwork:orchestrator");
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("sonnet");
  });

  it("CLEAN: explicit model set → passthrough (empty stdout + exit 0)", () => {
    const result = check(task("groundwork:advisor", "opus"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: non-Agent tool → passthrough (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "echo hi" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("injects registry model for advisor → opus", () => {
    const result = check(task("groundwork:advisor"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.updatedInput.model).toBe("opus");
  });

  it("GUARD-CAN-FAIL: general-purpose spawned by junior-orchestrator → allow (topology rule not triggered)", () => {
    const result = check(task("groundwork:general-purpose"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("allow");
  });

  it("loadRegistry returns sonnet for general-purpose", () => {
    const reg = loadRegistry();
    expect(reg["general-purpose"]).toBe("sonnet");
  });

  // T16: built-in ban + case-insensitive registry lookup
  it("VIOLATION: bare Explore → deny naming groundwork:explore", () => {
    const result = check(task("Explore"));
    expect(safeDecision(result)).toBe("deny");
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain("groundwork:explore");
  });

  it("VIOLATION: bare general-purpose → deny naming groundwork:implementer", () => {
    const result = check(task("general-purpose"));
    expect(safeDecision(result)).toBe("deny");
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain("groundwork:implementer");
  });

  it("VIOLATION: bare EXPLORE (upper) → deny (case-insensitive)", () => {
    const result = check(task("EXPLORE"));
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: groundwork:explore → inject haiku", () => {
    const result = check(task("groundwork:explore"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("haiku");
  });

  it("CLEAN: groundwork:Explore (mixed case) → inject haiku (case-insensitive registry)", () => {
    const result = check(task("groundwork:Explore"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("haiku");
  });

  it("CLEAN: unknown agent → no crash, allow", () => {
    const result = check(task("some-unknown-agent-xyz"));
    // Should not throw; may inject model or allow
    expect(result.exit).toBe(0);
  });
});
