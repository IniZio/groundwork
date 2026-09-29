import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const GW_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(GW_ROOT, "src/cli/main.ts");
const PLUGIN_DIR = path.join(GW_ROOT, "plugins/house-rules");

const root = mkdtempSync(path.join(tmpdir(), "gw-recipe-e2e-"));
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
  const id = `recipe-e2e-${process.pid}-${++sessionSeq}`;
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
    session_id: "recipe-e2e-guard",
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

describe("gw recipe enforces the working tier", () => {
  it("AC6 e2e: Stop gate blocks a spec that lacks folds_into", () => {
    const spec = put(".groundwork/work/foo/spec.md", "---\ntitle: x\n---\n\n## Purpose\n\np\n\n## Requirements\n\nr\n");
    const r = stop([spec]);
    console.log("case1 stdout:", r.stdout, "stderr:", r.stderr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBe("block");
    // The block reason is short; the per-finding detail is in the file it points at.
    const reason = JSON.parse(r.stdout).reason as string;
    const detail = reason.match(/full list: (\S+)/)![1];
    expect(readFileSync(detail, "utf8")).toContain("folds_into");
  });

  it("AC6 e2e: Stop gate passes a valid spec", () => {
    const spec = put(".groundwork/work/bar/spec.md", "---\nfolds_into: some-doc\n---\n\n## Purpose\n\np\n\n## Requirements\n\nr\n");
    const r = stop([spec]);
    console.log("case2 stdout:", r.stdout, "stderr:", r.stderr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBeUndefined();
    expect(JSON.parse(r.stdout).continue).toBe(true);
  });

  it("AC6 e2e: PreToolUse guard denies .scratch/x.md with the redirect", () => {
    const r = guardWrite(path.join(repo, ".scratch/x.md"), "notes\n");
    console.log("case3 stdout:", r.stdout, "stderr:", r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.additionalContext).toContain("Use `.groundwork/work/{slug}/`");
  });

  it("AC6 e2e: a new root README.md is not denied and does not block Stop", () => {
    const readme = path.join(repo, "README.md");
    const g = guardWrite(readme, "# Product\n");
    console.log("case4 guard stdout:", g.stdout, "stderr:", g.stderr);
    expect(g.stdout).not.toContain("deny");
    writeFileSync(readme, "# Product\n");
    const r = stop([readme]);
    console.log("case4 stop stdout:", r.stdout, "stderr:", r.stderr);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).decision).toBeUndefined();
  });
});
