import { describe, it, expect } from "bun:test";
import path from "node:path";
import { makeRepo } from "../hooks/commit-sandbox.js";
import type { HookInput } from "../../src/hooks/lib/hook-input.js";

const REPO = path.resolve(import.meta.dir, "../..");
const FIXTURES = path.join(REPO, "test/fixtures/pr-body");
const dense = path.join(FIXTURES, "moor-956-dense.md");
const reheaded = path.join(FIXTURES, "moor-421-reheaded.md");

async function spawnHook(script: string, payload: HookInput, cwd: string) {
  const proc = Bun.spawn(["bun", path.join(REPO, "src/hooks", script)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/decoy/project/dir", CLAUDE_PLUGIN_ROOT: REPO },
  });
  proc.stdin.write(JSON.stringify({ session_id: "test", cwd, ...payload }));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  const output = stdout.trim() === "" ? null : (JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } }).hookSpecificOutput;
  return { stdout, stderr, exit, output };
}

const bash = (command: string) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

describe("pr-body-guard deployed path", () => {
  const on = makeRepo({ rules: { "pr-body": "error" } });
  const off = makeRepo({ rules: {} });

  it("denies a dense PR body and names the word count", async () => {
    const r = await spawnHook("pr-body-guard.ts", bash(`gh pr create --body-file ${dense}`), on);
    expect(r.exit).toBe(0);
    expect(r.output?.permissionDecision).toBe("deny");
    expect(r.output?.permissionDecisionReason).toContain("69 words");
  });

  it("denies a top-level PR comment", async () => {
    const r = await spawnHook("pr-body-guard.ts", bash("gh pr comment 940 --body x"), on);
    expect(r.output?.permissionDecision).toBe("deny");
  });

  it("allows a re-headed PR body", async () => {
    const r = await spawnHook("pr-body-guard.ts", bash(`gh pr create --body-file ${reheaded}`), on);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("allows the dense body in a repo without the rule", async () => {
    const r = await spawnHook("pr-body-guard.ts", bash(`gh pr create --body-file ${dense}`), off);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("doc-prose-advisory deployed path", () => {
  it("names the word count of a long sentence in a written doc", async () => {
    const repo = makeRepo({ rules: { "pr-body": "error" } });
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ") + ".";
    const payload = {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: `${repo}/docs/x.md`, content: `# Title\n\n${long}\n` },
    };
    const r = await spawnHook("doc-prose-advisory.ts", payload, repo);
    expect(r.exit).toBe(0);
    expect(r.output?.additionalContext).toContain("30 words");
  });
});
