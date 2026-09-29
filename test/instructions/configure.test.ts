import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SKILL_PATH = path.join(ROOT, "plugins/house-rules/skills/configure/SKILL.md");
const SCHEMA_URL =
  "https://raw.githubusercontent.com/IniZio/groundwork/main/plugins/house-rules/house-rules.schema.json";
const FORBIDDEN = /kill.?switch|bypass|GROUNDWORK_|--no-verify|disable/i;

describe("configure skill", () => {
  it("SKILL.md exists", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  it("SKILL.md has name frontmatter", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toMatch(/^name:\s*configure\s*$/m);
  });

  it("SKILL.md stays model-invocable", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).not.toContain("disable-model-invocation");
  });

  it("SKILL.md tells the agent to run house-rules config", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toContain("house-rules config");
  });

  it("SKILL.md cites the published schema URL", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).toContain(SCHEMA_URL);
  });

  it("SKILL.md shows pinning a preset in .house-rules.json", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toContain('"preset"');
    expect(content).toContain(".house-rules.json");
  });

  it("SKILL.md states loosening is a human decision", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    expect(content).toMatch(/human decision/i);
    expect(content).toMatch(/ask the user/i);
  });

  it("SKILL.md teaches no escape route", () => {
    expect(readFileSync(SKILL_PATH, "utf8")).not.toMatch(FORBIDDEN);
  });

  it("escape-route regex matches a known-bad sentence (positive control)", () => {
    const sample = "Set GROUNDWORK_X=1 or use --no-verify to bypass the hook.";
    expect(sample).toMatch(FORBIDDEN);
  });
});
