import { describe, it, expect } from "bun:test";
import { check } from "../../src/hooks/prose-quality-guard.js";

function edit(fp: string, old_string: string, new_string: string) {
  return { tool_name: "Edit", tool_input: { file_path: fp, old_string, new_string } };
}
function write(fp: string, content: string) {
  return { tool_name: "Write", tool_input: { file_path: fp, content } };
}

function safeAdvisory(result: { stdout: string }): string | null {
  const s = result.stdout.trim();
  if (!s) return null;
  try {
    const out = JSON.parse(s) as { hookSpecificOutput?: { additionalContext?: string } };
    return out.hookSpecificOutput?.additionalContext ?? null;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

describe("prose-quality-guard — Family 4 (advisory)", () => {
  it("VIOLATION negation-loss: 'must not delegate' → 'must delegate' in prose file → advise", () => {
    const result = check(edit("agents/foo.md",
      "The orchestrator must not delegate this task to itself.",
      "The orchestrator must delegate this task to itself."));
    const advisory = safeAdvisory(result);
    expect(advisory).toContain("prose-quality-guard [advisory]");
    expect(advisory).toContain("negation-loss");
  });

  it("VIOLATION hedge-upgrade: 'may fail' → 'will fail' in prose file → advise", () => {
    const result = check(edit("agents/foo.md",
      "The build process may fail under concurrent writes.",
      "The build process will fail under concurrent writes."));
    const advisory = safeAdvisory(result);
    expect(advisory).toContain("prose-quality-guard [advisory]");
    expect(advisory).toContain("hedge-upgrade");
  });

  it("VIOLATION abbreviation: introduces cfg in prose → advise", () => {
    const result = check(edit("doc/spec.md",
      "Load the configuration before starting.",
      "Load the cfg before starting."));
    expect(safeAdvisory(result)).toContain("abbreviation");
  });

  it("VIOLATION slop: AI-fingerprint comment opener → advise", () => {
    const result = check(write("src/foo.ts", "// Let's implement this function\nfunction foo() {}\n"));
    expect(safeAdvisory(result)).toContain("slop");
  });

  it("CLEAN prose edit with no violations → passthrough", () => {
    const result = check(edit("agents/bar.md",
      "This hook enforces the model registry.",
      "This hook enforces the model registry contract."));
    expect(result.stdout).toBe("");
  });

  it("CLEAN non-prose file edit → passthrough (negation rules skip non-prose)", () => {
    const result = check(edit("src/index.ts",
      "This function must not be called twice.",
      "This function must be called once."));
    expect(result.stdout).toBe("");
  });

  it("CLEAN wholesale rewrite (low sentence overlap) → passthrough (detection cliff by design)", () => {
    const result = check(edit("agents/baz.md",
      "The orchestrator must not spawn workers directly.",
      "Dispatch is managed by the registry and follows the depth constraint."));
    expect(result.stdout).toBe("");
  });

  it("GUARD-CAN-FAIL: clean prose file with no violations → no advisory (proves guard is not vacuous)", () => {
    const r1 = check(edit("agents/test.md",
      "The pipeline may encounter errors during processing.",
      "The pipeline will encounter errors during processing."));
    const r2 = check(edit("agents/test.md",
      "The pipeline may encounter errors during processing.",
      "The pipeline may encounter errors during processing still."));
    expect(safeAdvisory(r1)).toContain("hedge-upgrade");
    expect(r2.stdout).toBe("");
  });

  it("advisory result emits PostToolUse hookEventName with additionalContext (never blocks)", () => {
    const result = check(edit("agents/foo.md",
      "The agent must not proceed without approval.",
      "The agent must proceed without approval."));
    const out = JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("prose-quality-guard [advisory]");
    expect(out.hookSpecificOutput.additionalContext).toContain("negation-loss");
  });
});
