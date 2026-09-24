import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
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

  it("comment-density-gate.ts appears only in house-rules manifest, exactly twice (Stop + SubagentStop)", () => {
    const inGw = gwCmds.filter((c) => c.includes("comment-density-gate.ts"));
    expect(inGw).toHaveLength(0);

    const inHr = hrCmds.filter((c) => c.includes("comment-density-gate.ts"));
    expect(inHr).toHaveLength(2);

    const stopGroups: Array<{ hooks: Array<{ type: string; command: string }> }> =
      houseRulesManifest.hooks?.Stop ?? [];
    const stopHasDensityGate = stopGroups.some((g) =>
      g.hooks.some((h) => h.command.includes("comment-density-gate.ts"))
    );
    expect(stopHasDensityGate).toBe(true);

    const subagentStopGroups: Array<{
      hooks: Array<{ type: string; command: string }>;
    }> = houseRulesManifest.hooks?.SubagentStop ?? [];
    const subagentStopHasDensityGate = subagentStopGroups.some((g) =>
      g.hooks.some((h) => h.command.includes("comment-density-gate.ts"))
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
});
