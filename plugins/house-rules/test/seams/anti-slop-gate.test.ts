import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
const pluginJson = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
};
const GATE_CMD = pluginJson.hooks.Stop[0].hooks[0].command;
const GUARD_CMD = pluginJson.hooks.PreToolUse.find(g => g.hooks[0].command.endsWith("guard.ts"))!.hooks[0].command;

const LINE = "const v = Reflect.get(o, k);";

function spawnHook(cmd: string, payload: unknown, projectDir: string): { stdout: string; exit: number | null } {
  const [exe, ...args] = cmd.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT).split(" ");
  const r = spawnSync(exe, args, {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: projectDir,
    timeout: 60000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  return { stdout: r.stdout ?? "", exit: r.status };
}

describe("anti-slop seam via plugin.json hook commands", () => {
  let dir: string;
  let n = 0;
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });

  function commitBase(extra: Record<string, string> = {}): void {
    writeFileSync(path.join(dir, "a.ts"), `${LINE}\n`);
    for (const [f, c] of Object.entries(extra)) writeFileSync(path.join(dir, f), c);
    git("add", "-A");
    const old = new Date(Date.now() - 3600_000).toISOString();
    spawnSync("git", ["commit", "-qm", "base"], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old } });
  }

  function stop(): { out: Record<string, unknown>; exit: number | null } {
    const files = { "a.ts": `${LINE}\n${LINE}\n`, "a.test.ts": "vi.mock('x');\n" };
    const ts = new Date(Date.now() - 5000).toISOString();
    const lines = Object.entries(files).map(([rel, content]) => {
      const fp = path.join(dir, rel);
      writeFileSync(fp, content);
      const block = { type: "tool_use", name: "Write", input: { file_path: fp, content } };
      return JSON.stringify({ type: "assistant", message: { content: [block] }, timestamp: ts, cwd: dir });
    });
    const tp = path.join(dir, `transcript-${++n}.jsonl`);
    writeFileSync(tp, lines.join("\n") + "\n");
    const r = spawnHook(GATE_CMD, { hook_event_name: "Stop", session_id: `seam-${process.pid}-${Date.now()}`, transcript_path: tp, cwd: dir }, dir);
    return { out: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : {}, exit: r.exit };
  }

  function guard(file: string, content: string): { hso: Record<string, unknown>; exit: number | null } {
    const payload = { hook_event_name: "PreToolUse", tool_name: "Write", cwd: dir, tool_input: { file_path: path.join(dir, file), content } };
    const r = spawnHook(GUARD_CMD, payload, dir);
    return { hso: r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput ?? {} : {}, exit: r.exit };
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "seam-antislop-"));
    git("init", "-q");
    git("config", "user.email", "t@t.com");
    git("config", "user.name", "T");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("AC1: gate warns on added lines only, never blocks", () => {
    commitBase();
    const { out, exit } = stop();
    expect(exit).toBe(0);
    expect(out.decision).not.toBe("block");
    const msg = out.systemMessage as string;
    expect(msg).toMatch(/a\.ts:2 code-smells /);
    expect(msg).toMatch(/a\.test\.ts\S* no-module-mocking /);
    expect(msg).not.toContain("a.ts:1 ");
  });

  it("AC2: guard adds non-blocking context for dictionary type", () => {
    commitBase();
    const { hso, exit } = guard("b.ts", "const x: Record<string, unknown> = {};\n");
    expect(exit).toBe(0);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.additionalContext as string).toContain("house-rules type-escape-hatches: [no-unsafe-dictionary-type]");
  });

  it("AC3: code-smells off silences both hooks, others stay", () => {
    commitBase({ ".house-rules.json": JSON.stringify({ rules: { "code-smells": "off" } }) });
    const { out } = stop();
    const msg = out.systemMessage as string;
    expect(msg).not.toContain("code-smells");
    expect(msg).toMatch(/a\.test\.ts\S* no-module-mocking /);
    const g = guard("c.ts", `${LINE}\n`);
    expect(g.exit).toBe(0);
    expect(JSON.stringify(g.hso)).not.toContain("code-smells");
  });

  it("AC4: ambient CLAUDE_PROJECT_DIR is overridden by the explicit one", () => {
    commitBase();
    const prev = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = "/decoy/project/dir";
    try {
      const { out } = stop();
      expect(out.systemMessage as string).toMatch(/a\.ts:2 code-smells /);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = prev;
    }
  });
});
