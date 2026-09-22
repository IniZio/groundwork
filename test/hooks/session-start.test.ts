import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/session-start.ts");

function run(payload: unknown, env: Record<string, string> = {}): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
    cwd: ROOT,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

describe("session-start hook", () => {
  it("emits SessionStart hookEventName", () => {
    const { stdout, exit } = run({ session_id: "test-123" });
    expect(exit).toBe(0);
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("additionalContext defines GW invocation and uses $GW commands", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/GW="bun .+\/src\/cli\/main\.ts"/);
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW init");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW slice complete");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW gate approve");
  });

  it("additionalContext contains stop-gate and new-code-gate info", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("Stop-gate");
    expect(out.hookSpecificOutput.additionalContext).toContain("New-code-gate");
  });

  it("additionalContext contains mattpocock skills", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("mattpocock-skills:");
  });

  it("includes session_id when present", () => {
    const { stdout } = run({ session_id: "abc-456", transcript_path: "/tmp/t.jsonl" });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("abc-456");
    expect(out.hookSpecificOutput.additionalContext).toContain("/tmp/t.jsonl");
  });

  it("omits identity block when payload empty", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).not.toContain("session_id:");
  });

  it("exits 0 silently for sdk-py embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 silently for sdk-js embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });
});
