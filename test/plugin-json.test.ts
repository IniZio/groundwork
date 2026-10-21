import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// helper: collect all hook commands from a manifest
function collectHookCommands(manifest: {
  hooks?: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;
}): string[] {
  const cmds: string[] = [];
  for (const groups of Object.values(manifest.hooks ?? {})) {
    for (const group of groups) {
      for (const h of group.hooks) cmds.push(h.command);
    }
  }
  return cmds;
}

describe("plugin manifest parity", () => {
  const groundworkManifest = JSON.parse(
    readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")
  );
  const houseRulesManifest = JSON.parse(
    readFileSync(
      join(ROOT, "plugins/house-rules/.claude-plugin/plugin.json"),
      "utf8"
    )
  );

  const gwCmds = collectHookCommands(groundworkManifest);
  const hrCmds = collectHookCommands(houseRulesManifest);

  it("hooks/guard.ts appears only in house-rules manifest, exactly once in PreToolUse Edit|Write|MultiEdit group", () => {
    const inGw = gwCmds.filter((c) => c.includes("hooks/guard.ts"));
    expect(inGw).toHaveLength(0);

    const inHr = hrCmds.filter((c) => c.includes("hooks/guard.ts"));
    expect(inHr).toHaveLength(1);

    // must be in the PreToolUse Edit|Write|MultiEdit group
    const preToolUseGroups = houseRulesManifest.hooks?.PreToolUse ?? [];
    const matchingGroup = preToolUseGroups.find(
      (g: { matcher?: string; hooks: Array<{ type: string; command: string }> }) =>
        g.matcher === "Edit|Write|MultiEdit" &&
        g.hooks.some((h) => h.command.includes("hooks/guard.ts"))
    );
    expect(matchingGroup).toBeDefined();
  });

  it("hooks/gate.ts appears only in house-rules manifest, exactly twice (Stop + SubagentStop)", () => {
    const inGw = gwCmds.filter((c) => c.includes("hooks/gate.ts"));
    expect(inGw).toHaveLength(0);

    const inHr = hrCmds.filter((c) => c.includes("hooks/gate.ts"));
    expect(inHr).toHaveLength(2);

    const stopGroups: Array<{ hooks: Array<{ type: string; command: string }> }> =
      houseRulesManifest.hooks?.Stop ?? [];
    const stopHasDensityGate = stopGroups.some((g) =>
      g.hooks.some((h) => h.command.includes("hooks/gate.ts"))
    );
    expect(stopHasDensityGate).toBe(true);

    const subagentStopGroups: Array<{
      hooks: Array<{ type: string; command: string }>;
    }> = houseRulesManifest.hooks?.SubagentStop ?? [];
    const subagentStopHasDensityGate = subagentStopGroups.some((g) =>
      g.hooks.some((h) => h.command.includes("hooks/gate.ts"))
    );
    expect(subagentStopHasDensityGate).toBe(true);
  });

  it("groundwork plugin.json has a house-rules dependency with version starting with ~", () => {
    const deps: Array<{ name: string; version?: string; marketplace?: string }> =
      groundworkManifest.dependencies ?? [];
    const houseRulesDep = deps.find((d) => d.name === "house-rules");
    expect(houseRulesDep).toBeDefined();
    // version is a semver range like ~0.1.0 that includes 0.1.0
    expect(houseRulesDep?.version).toMatch(/^~/);
  });

  // A dependency on another marketplace only installs if the user added that marketplace first.
  it("groundwork's pstack dependency resolves from this marketplace", () => {
    const deps: Array<{ name: string; marketplace?: string }> =
      groundworkManifest.dependencies ?? [];
    expect(deps).toContainEqual({ name: "pstack" });

    const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === "pstack");
    expect(entry?.source).toMatchObject({
      source: "git-subdir",
      url: "https://github.com/cursor/plugins.git",
      path: "harness/pstack/claude-code",
    });
  });

  it("marketplace.json groundwork entry keeps its name and root source", () => {
    const marketplace = JSON.parse(
      readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8")
    );
    const groundwork = marketplace.plugins.find((p: { name: string }) => p.name === "groundwork");
    expect(groundwork).toBeDefined();
    expect(groundwork.source).toBe("./");
  });

  it("every groundwork hook command points at a file in this repo", () => {
    expect(gwCmds.length).toBeGreaterThan(0);
    for (const cmd of gwCmds) {
      const rel = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/)?.[1];
      expect(rel).toBeDefined();
      expect(existsSync(join(ROOT, rel!))).toBe(true);
    }
  });
});
