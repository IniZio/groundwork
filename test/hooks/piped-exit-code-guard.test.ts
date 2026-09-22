import { describe, it, expect } from "bun:test";
import { check } from "../../src/hooks/piped-exit-code-guard.js";

function bash(command: string) {
  return { tool_name: "Bash", tool_input: { command } };
}

/**
 * Parse hook stdout safely.
 * Empty stdout is the allow-by-silence contract; treat it as permissionDecision:"allow"
 * so VIOLATION tests fail with "expected deny, got allow" instead of a SyntaxError.
 */
function safeDecision(result: { stdout: string; exit: number }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

describe("piped-exit-code-guard — Family 5", () => {
  it("VIOLATION: pipe to grep then echo $? → deny", () => {
    const result = check(bash("git push | grep error; echo $?"));
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: pipe to tail then $? check → deny", () => {
    const result = check(bash("make build | tail -5\nif [ $? -ne 0 ]; then exit 1; fi"));
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: pipe to wc then rc= → deny", () => {
    const result = check(bash("find . -name '*.ts' | wc -l; rc=$?; echo $rc"));
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: $? without pipe → allow (empty stdout + exit 0)", () => {
    const result = check(bash("git push; echo $?"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: pipe to grep without $? check → allow (empty stdout + exit 0)", () => {
    const result = check(bash("cat foo.txt | grep pattern"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: $? inside single quotes (no expansion) → allow (empty stdout + exit 0)", () => {
    const result = check(bash("echo 'pipe | grep foo; echo $?'"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: non-Bash tool → allow (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Write", tool_input: { command: "pipe | grep x; echo $?" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: empty command → allow (empty stdout + exit 0)", () => {
    const result = check(bash(""));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("GUARD-CAN-FAIL: command without $? after pipe → allow (proves regex does not over-match)", () => {
    const result = check(bash("git push | grep 'error' && echo done"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });
});
