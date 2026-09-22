import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");

interface HookEntry { type: string; command: string }
interface MatcherGroup { hooks: HookEntry[] }
const pluginJson = JSON.parse(readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks?: Record<string, MatcherGroup[]>;
};

function allCommands(): string[] {
  const cmds: string[] = [];
  for (const groups of Object.values(pluginJson.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks ?? []) cmds.push(entry.command);
    }
  }
  return cmds;
}

describe("plugin.json hook commands", () => {
  it("every hook command starts with 'bun ${CLAUDE_PLUGIN_ROOT}/'", () => {
    const commands = allCommands();
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      expect(cmd).toMatch(/^bun \$\{CLAUDE_PLUGIN_ROOT\}\//);
    }
  });

  it("every referenced hook file exists relative to repo root", () => {
    for (const cmd of allCommands()) {
      const match = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)$/);
      if (!match) continue;
      expect(existsSync(path.join(ROOT, match[1]))).toBe(true);
    }
  });

  it("claude plugin validate . exits 0", () => {
    let exitCode = 0;
    try {
      execSync("claude plugin validate .", { cwd: ROOT, stdio: "pipe" });
    } catch (e) {
      exitCode = (e as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(0);
  });
});
