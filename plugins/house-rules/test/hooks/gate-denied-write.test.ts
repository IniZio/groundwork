import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE = path.join(import.meta.dir, "../../src/hooks/gate.ts");

function setup(rel: string, create: boolean) {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hr-denied-")));
  const g = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  mkdirSync(path.join(repo, "doc")); mkdirSync(path.join(repo, "docs"));
  writeFileSync(path.join(repo, "doc/a.md"), "a\n");
  writeFileSync(path.join(repo, "docs/b.md"), "b\n");
  g("add", "-A"); g("commit", "-qm", "init");
  const target = path.join(repo, rel);
  if (create) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "hi\n");
  }
  const tp = path.join(repo, ".transcript.jsonl");
  const lines = [
    { type: "assistant", cwd: repo, timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id: "tu1", name: "Write", input: { file_path: target, content: "hi\n" } }] } },
    { type: "user", cwd: repo,
      message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: !create,
        content: create ? "ok" : "PreToolUse:Write hook error: house-rules: docs/ and doc/ coexist under root" }] } },
  ];
  writeFileSync(tp, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(path.join(repo, ".git/info/exclude"), ".transcript.jsonl\n.tmp/\n");
  return { repo, tp, target };
}

function runGate(repo: string, tp: string) {
  const env = { ...process.env, TMPDIR: path.join(repo, ".tmp") } as Record<string, string>;
  delete env.CLAUDE_PROJECT_DIR; delete env.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(env.TMPDIR);
  const r = spawnSync("bun", [GATE], { cwd: repo, env, encoding: "utf8",
    input: JSON.stringify({ hook_event_name: "Stop", session_id: "s1", transcript_path: tp, cwd: repo }) });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  return { r, out };
}

describe("gate: denied Write never reaches disk", () => {
  it("does not block on a artifact-structure path that does not exist", () => {
    const { repo, tp, target } = setup("docs/x/a.md", false);
    expect(existsSync(target)).toBe(false);
    const { r, out } = runGate(repo, tp);
    expect(out.decision).not.toBe("block");
    expect(r.stdout).not.toContain("docs/x/a.md");
  });

  it("control: blocks on a Write that reached disk under docs/", () => {
    const { repo, tp, target } = setup("docs/y/b.md", true);
    expect(existsSync(target)).toBe(true);
    const { r, out } = runGate(repo, tp);
    expect(out.decision).toBe("block");
    expect(r.stdout).toContain("docs/y/b.md");
  });
});
