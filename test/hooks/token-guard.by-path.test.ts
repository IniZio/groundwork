/**
 * BY-PATH tests: spawn bun <root>/src/hooks/store-write-guard.ts exactly as
 * plugin.json invokes it.  Covers bypass routes identified in T15 review.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/store-write-guard.ts");

function runHook(payload: unknown): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
    cwd: ROOT,
    timeout: 15_000,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

function decision(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch { return `parse-error(${s.slice(0, 60)})`; }
}

function subagentBash(command: string) {
  return { tool_name: "Bash", tool_input: { command }, agent_type: "groundwork:implementer" };
}
function mainBash(command: string) {
  return { tool_name: "Bash", tool_input: { command } };
}
function subagentRead(file_path: string) {
  return { tool_name: "Read", tool_input: { file_path }, agent_type: "groundwork:implementer" };
}
function mainRead(file_path: string) {
  return { tool_name: "Read", tool_input: { file_path } };
}
function subagentGlob(pattern: string) {
  return { tool_name: "Glob", tool_input: { pattern }, agent_type: "groundwork:implementer" };
}

describe("token-guard by-path — T15 bypass probes", () => {
  it("BYPASS-1: subagent `bun src/cli/main.ts init` → deny", () => {
    expect(decision(runHook(subagentBash("bun src/cli/main.ts init")).stdout)).toBe("deny");
  });

  it("BYPASS-1 control: main thread `bun src/cli/main.ts init` → allow", () => {
    expect(decision(runHook(mainBash("bun src/cli/main.ts init")).stdout)).toBe("allow");
  });

  it("BYPASS-1: subagent `$GW init` → deny", () => {
    expect(decision(runHook(subagentBash("$GW init")).stdout)).toBe("deny");
  });

  it("BYPASS-1: subagent `gw init` → deny", () => {
    expect(decision(runHook(subagentBash("gw init")).stdout)).toBe("deny");
  });

  it("BYPASS-1: subagent `gw token` → deny", () => {
    expect(decision(runHook(subagentBash("gw token")).stdout)).toBe("deny");
  });

  it("BYPASS-1 control: main thread `gw token` → allow", () => {
    expect(decision(runHook(mainBash("gw token")).stdout)).toBe("allow");
  });

  it("BYPASS-2: subagent `cat ~/.config/groundwork/repos/*/write.token` → deny", () => {
    expect(decision(runHook(subagentBash("cat ~/.config/groundwork/repos/*/write.token")).stdout)).toBe("deny");
  });

  it("BYPASS-2 control: main thread same glob → allow", () => {
    expect(decision(runHook(mainBash("cat ~/.config/groundwork/repos/*/write.token")).stdout)).toBe("allow");
  });

  it("BYPASS-2: subagent `find .config/groundwork -name write.token` → deny", () => {
    expect(decision(runHook(subagentBash("find .config/groundwork -name write.token")).stdout)).toBe("deny");
  });

  it("BYPASS-2: subagent `ls groundwork/repos` → deny", () => {
    expect(decision(runHook(subagentBash("ls groundwork/repos")).stdout)).toBe("deny");
  });

  it("BYPASS-2: subagent Read of seal.key → deny", () => {
    expect(decision(runHook(subagentRead("/home/user/.config/groundwork/repos/abc123/seal.key")).stdout)).toBe("deny");
  });

  it("BYPASS-2: subagent Read of write.token → deny", () => {
    expect(decision(runHook(subagentRead("/home/user/.config/groundwork/repos/abc123/write.token")).stdout)).toBe("deny");
  });

  it("BYPASS-2 control: main thread Read of write.token → allow", () => {
    expect(decision(runHook(mainRead("/home/user/.config/groundwork/repos/abc123/write.token")).stdout)).toBe("allow");
  });

  it("BYPASS-2: subagent Glob pattern matching groundwork/repos → deny", () => {
    expect(decision(runHook(subagentGlob("~/.config/groundwork/repos/**")).stdout)).toBe("deny");
  });

  it("CLEAN: subagent reading ordinary file → allow", () => {
    expect(decision(runHook({ tool_name: "Read", tool_input: { file_path: "/repo/src/foo.ts" }, agent_type: "groundwork:implementer" }).stdout)).toBe("allow");
  });
});
