import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// All paths relative to this file (import.meta.dir), never process.cwd or CLAUDE_PROJECT_DIR
const dir = import.meta.dir;
const pluginRoot = join(dir, "..");
const repoRoot = join(pluginRoot, "../..");

describe("house-rules manifest", () => {
  const pluginJson = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8")
  );
  const expectedVersion: string = pluginJson.version;

  it("plugin.json has correct name and version with comment-density hooks registered", () => {
    expect(pluginJson.name).toBe("house-rules");
    expect(expectedVersion).toMatch(/^\d+\.\d+\.\d+/);

    // Stop has exactly one group with gate.ts
    const stopGroups: Array<{ hooks: Array<{ type: string; command: string }> }> =
      pluginJson.hooks?.Stop ?? [];
    expect(
      stopGroups.some((g) =>
        g.hooks.some((h) => h.command.includes("gate.ts"))
      )
    ).toBe(true);

    const subagentStopGroups: Array<{
      hooks: Array<{ type: string; command: string }>;
    }> = pluginJson.hooks?.SubagentStop ?? [];
    expect(
      subagentStopGroups.some((g) =>
        g.hooks.some((h) => h.command.includes("gate.ts"))
      )
    ).toBe(true);

    // PreToolUse has a group with matcher Edit|Write|MultiEdit and comment-density-guard.ts
    const preToolUseGroups: Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string }>;
    }> = pluginJson.hooks?.PreToolUse ?? [];
    expect(
      preToolUseGroups.some(
        (g) =>
          g.matcher === "Edit|Write|MultiEdit" &&
          g.hooks.some((h) => h.command.includes("guard.ts"))
      )
    ).toBe(true);

    expect(
      preToolUseGroups.some(
        (g) =>
          typeof g.matcher === "string" &&
          g.matcher.split("|").includes("Read") &&
          g.hooks.some((h) => h.command.includes("autofix-notice.ts"))
      )
    ).toBe(true);
  });

  it("marketplace.json has house-rules entry with correct source and version", () => {
    const marketplace = JSON.parse(
      readFileSync(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8")
    );
    const houseRules = marketplace.plugins.find((p: { name: string }) => p.name === "house-rules");
    expect(houseRules).toBeDefined();
    expect(houseRules.source).toBe("./plugins/house-rules");
    expect(houseRules.version).toBe(expectedVersion);
  });

  it("marketplace.json groundwork entry is byte-unchanged in name and source", () => {
    const marketplace = JSON.parse(
      readFileSync(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8")
    );
    const groundwork = marketplace.plugins.find((p: { name: string }) => p.name === "groundwork");
    expect(groundwork).toBeDefined();
    expect(groundwork.name).toBe("groundwork");
    expect(groundwork.source).toBe("./");
  });

  it("README contains minimum version requirement v2.1.193", () => {
    const readme = readFileSync(join(pluginRoot, "README.md"), "utf8");
    expect(readme).toContain("v2.1.193");
  });
});
