import { describe, it, expect } from "bun:test";
import { check } from "../../src/hooks/store-write-guard.js";

function decision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try { return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision; }
  catch { return `parse-error(${s.slice(0, 60)})`; }
}

const SECRET = "/home/user/.config/groundwork/repos/abcd1234ef5678ab/write.token";
const SEAL   = "/home/user/.config/groundwork/repos/abcd1234ef5678ab/seal.key";

describe("token-guard — subagent blocked from secret files", () => {
  it("VIOLATION: subagent Read of write.token → deny", () => {
    const r = check({ tool_name: "Read", tool_input: { file_path: SECRET }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("deny");
  });

  it("VIOLATION: subagent Read of seal.key → deny", () => {
    const r = check({ tool_name: "Read", tool_input: { file_path: SEAL }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("deny");
  });

  it("VIOLATION: subagent Bash cat of write.token → deny", () => {
    const r = check({ tool_name: "Bash", tool_input: { command: `cat ${SECRET}` }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("deny");
  });

  it("VIOLATION: subagent Bash cat of seal.key → deny", () => {
    const r = check({ tool_name: "Bash", tool_input: { command: `cat ${SEAL}` }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("deny");
  });

  it("CLEAN: main session Read of write.token → allow (no agent_type)", () => {
    const r = check({ tool_name: "Read", tool_input: { file_path: SECRET } });
    expect(decision(r)).toBe("allow");
  });

  it("CLEAN: subagent Read of unrelated file → allow", () => {
    const r = check({ tool_name: "Read", tool_input: { file_path: "/home/user/project/src/foo.ts" }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("allow");
  });

  it("GUARD-CAN-FAIL: completely unrelated path → allow (proves guard is path-specific)", () => {
    const r = check({ tool_name: "Read", tool_input: { file_path: "/home/user/.config/nvim/init.lua" }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("allow");
  });
});
