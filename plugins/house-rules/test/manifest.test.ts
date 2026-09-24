import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// All paths relative to this file (import.meta.dir), never process.cwd or CLAUDE_PROJECT_DIR
const dir = import.meta.dir;
// plugins/house-rules/test → plugins/house-rules
const pluginRoot = join(dir, "..");
// repo root
const repoRoot = join(pluginRoot, "../..");

describe("house-rules manifest", () => {
  it("plugin.json has correct name and version and no hooks key", () => {
    const pluginJson = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8")
    );
    expect(pluginJson.name).toBe("house-rules");
    expect(pluginJson.version).toBe("0.1.0");
    expect(pluginJson.hooks).toBeUndefined();
  });

  it("marketplace.json has house-rules entry with correct source and version", () => {
    const marketplace = JSON.parse(
      readFileSync(join(repoRoot, ".claude-plugin/marketplace.json"), "utf8")
    );
    const houseRules = marketplace.plugins.find((p: { name: string }) => p.name === "house-rules");
    expect(houseRules).toBeDefined();
    expect(houseRules.source).toBe("./plugins/house-rules");
    expect(houseRules.version).toBe("0.1.0");
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
