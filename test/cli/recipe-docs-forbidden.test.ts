import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const GW_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(GW_ROOT, "src/cli/main.ts");
const PLUGIN_DIR = path.join(GW_ROOT, "plugins/house-rules");

const root = mkdtempSync(path.join(tmpdir(), "gw-recipe-docs-forbidden-"));
const repo = path.join(root, "repo");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
delete env.CLAUDE_PROJECT_DIR;
delete env.GROUNDWORK_DB;
delete env.CLAUDE_CODE_ENTRYPOINT; // gate goes silent under sdk entrypoints
Object.assign(env, {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  XDG_CONFIG_HOME: path.join(root, "xdg"),
});

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 30000 });
}

interface PluginHooks {
  hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
}
function registeredCommand(event: string, matcher?: string): string {
  const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, ".claude-plugin/plugin.json"), "utf8")) as PluginHooks;
  const entry = manifest.hooks[event].find(e => e.matcher === matcher && e.hooks[0].command.includes(event === "Stop" ? "gate.ts" : "guard.ts"));
  if (!entry) throw new Error(`no ${event} hook registered`);
  return entry.hooks[0].command.split("${CLAUDE_PLUGIN_ROOT}").join(PLUGIN_DIR);
}

function spawnHook(command: string, payload: object) {
  return spawnSync("sh", ["-c", command], { cwd: repo, env, encoding: "utf8", input: JSON.stringify(payload), timeout: 30000 });
}

function guardWrite(file: string) {
  return spawnHook(registeredCommand("PreToolUse", "Edit|Write|MultiEdit"), {
    hook_event_name: "PreToolUse",
    session_id: "recipe-docs-forbidden",
    cwd: repo,
    tool_name: "Write",
    tool_input: { file_path: file, content: "x" },
  });
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  expect(run("git", ["init", "-q"], repo).status).toBe(0);
  const recipe = run("bun", [MAIN, "recipe"], repo);
  expect(recipe.status).toBe(0);
  writeFileSync(path.join(repo, ".house-rules.json"), recipe.stdout);
});

describe("docs/*/ per-slug views through the deployed PreToolUse hook", () => {
  it("denies docs/x/spec.md with the pr-body redirect", () => {
    const g = guardWrite(path.join(repo, "docs/x/spec.md"));
    console.log("deny stdout:", g.stdout);
    const out = JSON.parse(g.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.additionalContext).toContain("doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`");
  });

  it("allows docs/spec/x.md", () => {
    const g = guardWrite(path.join(repo, "docs/spec/x.md"));
    expect(g.stdout).not.toContain("deny");
  });
});
