import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const GW_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(GW_ROOT, "src/cli/main.ts");
const PLUGIN_DIR = path.join(GW_ROOT, "plugins/house-rules");

const root = mkdtempSync(path.join(tmpdir(), "gw-recipe-adr-"));
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

let sessionSeq = 0;
function stop(writtenFiles: string[]) {
  const id = `recipe-adr-${process.pid}-${++sessionSeq}`;
  const transcript = path.join(root, `${id}.jsonl`);
  const lines = writtenFiles.map(f => JSON.stringify({
    type: "assistant",
    cwd: repo,
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: f, content: "x" } }] },
  }));
  writeFileSync(transcript, lines.join("\n") + "\n");
  return spawnHook(registeredCommand("Stop"), { hook_event_name: "Stop", session_id: id, cwd: repo, transcript_path: transcript });
}

function guardWrite(file: string, content: string) {
  return spawnHook(registeredCommand("PreToolUse", "Edit|Write|MultiEdit"), {
    hook_event_name: "PreToolUse",
    session_id: "recipe-adr-guard",
    cwd: repo,
    tool_name: "Write",
    tool_input: { file_path: file, content },
  });
}

function put(rel: string, body: string): string {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  expect(run("git", ["init", "-q"], repo).status).toBe(0);
  const init = run("bun", [MAIN, "init"], repo);
  expect(init.status).toBe(0);
  const recipe = run("bun", [MAIN, "recipe"], repo);
  expect(recipe.status).toBe(0);
  writeFileSync(path.join(repo, ".house-rules.json"), recipe.stdout);
});

const GOOD = "---\nstatus: accepted\n---\n\n# Pick X\n\n## Context\n\nc\n\n## Decision\n\nd\n\n## Rejected alternatives\n\nr\n\n## Consequences\n\nq\n";
const NO_STATUS = "---\ntitle: x\n---\n\n# No status\n\n## Context\n\nc\n\n## Decision\n\nd\n\n## Rejected alternatives\n\nr\n\n## Consequences\n\nq\n";

describe("adr doc type through the deployed hooks", () => {
  it("recipe stdout declares an adr type", () => {
    const cfg = JSON.parse(readFileSync(path.join(repo, ".house-rules.json"), "utf8"));
    const types = cfg.rules["artifact-structure"][1].types;
    expect(Object.keys(types)).toContain("adr");
  });

  it("(a) valid .groundwork/adr record passes Stop and is not denied by the guard", () => {
    const f = put(".groundwork/adr/0001-pick-x.md", GOOD);
    const g = guardWrite(f, GOOD);
    console.log("caseA guard stdout:", g.stdout, "stderr:", g.stderr);
    expect(g.stdout).not.toContain("deny");
    const r = stop([f]);
    console.log("caseA stop stdout:", r.stdout, "stderr:", r.stderr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBeUndefined();
    expect(JSON.parse(r.stdout).continue).toBe(true);
  });

  it("(b) doc/adr path is denied with the .groundwork/adr redirect", () => {
    const f = path.join(repo, "doc/adr/0001-pick-x.md");
    const g = guardWrite(f, GOOD);
    console.log("caseB guard stdout:", g.stdout, "stderr:", g.stderr);
    const out = JSON.parse(g.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.additionalContext).toContain(".groundwork/adr/");
  });

  it("(c) control: adr record without status blocks Stop naming status", () => {
    const f = put(".groundwork/adr/0002-no-status.md", NO_STATUS);
    const r = stop([f]);
    console.log("caseC stop stdout:", r.stdout, "stderr:", r.stderr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBe("block");
    const detail = (JSON.parse(r.stdout).reason as string).match(/full list: (\S+)/)![1];
    expect(readFileSync(detail, "utf8")).toContain("status");
  });
});
