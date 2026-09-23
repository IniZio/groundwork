import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/prompt-reminder.ts");

function run(
  payload: unknown = {},
  env: Record<string, string> = {},
): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    cwd: ROOT,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

describe("prompt-reminder hook", () => {
  it("emits UserPromptSubmit hookEventName", () => {
    const { stdout, exit } = run({});
    expect(exit).toBe(0);
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("per-turn line is ≤20 tokens (~80 chars)", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const line = out.hookSpecificOutput.additionalContext;
    // ~4 chars/token proxy; 20 tokens = 80 chars
    expect(line.length).toBeLessThanOrEqual(80);
  });

  it("delegation half present in full line", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("debugger");
    expect(out.hookSpecificOutput.additionalContext).toContain("explore");
    expect(out.hookSpecificOutput.additionalContext).toContain("fan-out");
  });

  it("style half present when caveman not active", () => {
    const tmpDir = path.join(os.tmpdir(), `gw-test-caveman-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const { stdout } = run({}, { CLAUDE_CONFIG_DIR: tmpDir });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/articles|filler/i);
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

  it("kill switch GW_PROMPT_REMINDER_DISABLE=1 suppresses output", () => {
    const { stdout, exit } = run({}, { GW_PROMPT_REMINDER_DISABLE: "1" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  it("caveman active: no style half, delegation half present", () => {
    const tmpDir = path.join(os.tmpdir(), `gw-test-caveman-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const flagPath = path.join(tmpDir, ".caveman-active");
    writeFileSync(flagPath, "full");
    try {
      const { stdout } = run({}, { CLAUDE_CONFIG_DIR: tmpDir });
      const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      const line = out.hookSpecificOutput.additionalContext;
      // Delegation must be present
      expect(line).toContain("debugger");
      expect(line).toContain("explore");
      // Style half must NOT be injected (no "articles" or "filler")
      expect(line).not.toMatch(/articles|filler/i);
    } finally {
      try { unlinkSync(flagPath); } catch { /* ignore */ }
    }
  });

  it("caveman flag='off': style half is injected", () => {
    const tmpDir = path.join(os.tmpdir(), `gw-test-caveman-off-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const flagPath = path.join(tmpDir, ".caveman-active");
    writeFileSync(flagPath, "off");
    try {
      const { stdout } = run({}, { CLAUDE_CONFIG_DIR: tmpDir });
      const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(out.hookSpecificOutput.additionalContext).toMatch(/articles|filler/i);
    } finally {
      try { unlinkSync(flagPath); } catch { /* ignore */ }
    }
  });
});
