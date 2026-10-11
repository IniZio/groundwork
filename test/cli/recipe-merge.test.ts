import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { HOUSE_RULES_SCHEMA_URL } from "../../src/cli/recipe.js";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const base = mkdtempSync(path.join(tmpdir(), "gw-recipe-merge-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
delete env.CLAUDE_PROJECT_DIR;
delete env.GROUNDWORK_DB;

let n = 0;
function tempRepo(): string {
  const d = mkdtempSync(path.join(base, `r${n++}-`));
  spawnSync("git", ["init", "-q"], { cwd: d, env, encoding: "utf8" });
  return d;
}
function gw(cwd: string, ...args: string[]) {
  return spawnSync("bun", [MAIN, "recipe", ...args], { cwd, env, encoding: "utf8", timeout: 30000 });
}

describe("recipe --merge", () => {
  it("keeps $schema and other rules, replaces artifact-structure", () => {
    const d = tempRepo();
    const original = {
      $schema: "https://example.com/custom.schema.json",
      rules: { "commit-message": ["warn", { style: "conventional" }], "artifact-structure": ["off"] },
      extra: { keep: true },
    };
    writeFileSync(path.join(d, ".house-rules.json"), JSON.stringify(original, null, 2));
    const plain = JSON.parse(gw(d).stdout);
    const r = gw(d, "--merge");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.$schema).toBe(original.$schema);
    expect(out.rules["commit-message"]).toEqual(original.rules["commit-message"]);
    expect(out.extra).toEqual(original.extra);
    expect(out.rules["artifact-structure"]).toEqual(plain.rules["artifact-structure"]);
  });

  it("adds $schema when the existing file lacks one", () => {
    const d = tempRepo();
    writeFileSync(path.join(d, ".house-rules.json"), '{"rules":{"commit-message":["warn"]}}');
    const out = JSON.parse(gw(d, "--merge").stdout);
    expect(out.$schema).toBe(HOUSE_RULES_SCHEMA_URL);
    expect(out.rules["commit-message"]).toEqual(["warn"]);
  });

  it("no file: output equals plain recipe", () => {
    const d = tempRepo();
    const plain = gw(d);
    const merged = gw(d, "--merge");
    expect(merged.status).toBe(0);
    expect(plain.stdout.length).toBeGreaterThan(0);
    expect(merged.stdout).toBe(plain.stdout);
  });

  it("broken file: exits non-zero, empty stdout, stderr names the file", () => {
    const d = tempRepo();
    writeFileSync(path.join(d, ".house-rules.json"), "{ not json");
    const r = gw(d, "--merge");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(".house-rules.json");
  });

  it("plain recipe has $schema equal to the constant", () => {
    const parsed = JSON.parse(gw(tempRepo()).stdout);
    expect(parsed.$schema).toBe(HOUSE_RULES_SCHEMA_URL);
    expect(Object.keys(parsed)[0]).toBe("$schema");
  });

  it("never writes: file bytes identical after --merge", () => {
    const d = tempRepo();
    const f = path.join(d, ".house-rules.json");
    writeFileSync(f, '{"rules":{"commit-message":["warn"]}}\n');
    const before = readFileSync(f);
    expect(gw(d, "--merge").status).toBe(0);
    expect(readFileSync(f).equals(before)).toBe(true);
  });
});
