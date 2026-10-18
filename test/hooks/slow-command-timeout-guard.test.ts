import { describe, it, expect } from "bun:test";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/slow-command-timeout-guard.js";

const HOOK_PATH = path.resolve(import.meta.dir, "../../src/hooks/slow-command-timeout-guard.ts");

function bash(command: string, run_in_background?: boolean) {
  const tool_input: Record<string, unknown> = { command, description: "test" };
  if (run_in_background !== undefined) tool_input.run_in_background = run_in_background;
  return {
    session_id: "s1",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input,
  };
}

function reason(command: string, bg?: boolean): string | null {
  const r = check(bash(command, bg));
  if (!r.stdout.trim()) return null;
  const out = JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  return out.hookSpecificOutput.permissionDecisionReason;
}

const DENY: Array<[string, string]> = [
  ["moor start", "moor start"],
  ["moor run foo", "moor run"],
  ["moor close", "moor close"],
  ["crabbox warmup", "crabbox warmup"],
  ["crabbox run x", "crabbox run"],
  ["docker build .", "docker build"],
  ["npx agent37 deploy", "npx agent37"],
  ["ssh host ls", "ssh"],
  ["scp a h:b", "scp"],
  ["cd x && moor run foo", "moor run"],
  ["FOO=1 ssh host ls", "ssh"],
  ["/usr/bin/ssh h", "ssh"],
  ["sudo docker build -t x .", "docker build"],
  ["echo hi | ssh h cat", "ssh"],
  ["echo $(ssh h hostname)", "ssh"],
  ["while ! pgrep x; do sleep 5; done", "wait loop"],
  ["until curl -s u; do sleep 2; done", "wait loop"],
  ["timeout 600 echo a; ssh h ls", "ssh"],
  ["timeout moor start x", "moor start"],
  ["timeout -k 5 moor run x", "moor run"],
  ["docker buildx build .", "docker build"],
  ["docker compose build", "docker build"],
  ["docker-compose build", "docker build"],
  ["ssh h uptime && echo done", "ssh"],
  ["ssh h 2>&1", "ssh"],
];

const PASS = [
  "moor --help",
  "moor status",
  "grep crabbox README.md",
  "ls ~/.ssh/config",
  "cat /home/u/sshkeys/x",
  "timeout 600 moor run x",
  "timeout -k 5 300 ssh h ls",
  "timeout --signal=KILL 300 docker build .",
  "timeout -s TERM 60 scp a h:b",
  "timeout 600 bash -c 'while ! pgrep x; do sleep 5; done'",
  "timeout 600 sh -c 'until curl -s u; do sleep 2; done'",
  "for f in *; do echo $f; done",
  "while read l; do echo $l; done < f",
  'echo "ssh later"',
  'git commit -m "moor run fix"',
  "timeout 10m ssh h",
  "timeout 1.5h docker build .",
  "moor start --help",
  "ssh -V",
  "docker build --help",
  "docker build --version",
  "ssh -h",
  "command -v ssh",
  "type ssh",
  "which ssh",
  "moor run x &",
  "ssh h uptime & echo started",
  "docker buildx ls",
  "docker compose ps",
];

describe("slow-command-timeout-guard", () => {
  for (const [cmd, op] of DENY) {
    it(`denies: ${cmd}`, () => {
      const r = reason(cmd);
      expect(r).not.toBeNull();
      expect(r).toContain(`"${op}"`);
      expect(r?.toLowerCase()).toContain("wrap it in `timeout 600 …` or run it in the background with a monitor until-condition");
    });
    it(`passes when backgrounded: ${cmd}`, () => {
      expect(reason(cmd, true)).toBeNull();
    });
  }

  for (const cmd of PASS) {
    it(`passes: ${cmd}`, () => {
      expect(reason(cmd)).toBeNull();
    });
  }

  it("passes non-Bash tool", () => {
    const r = check({ tool_name: "Write", tool_input: { command: "ssh h" } });
    expect(r).toEqual({ stdout: "", stderr: "", exit: 0 });
  });

  it("fails open on malformed input", () => {
    for (const bad of [null, undefined, "x", 3, {}, { tool_name: "Bash" }, { tool_name: "Bash", tool_input: { command: 5 } }]) {
      expect(check(bad)).toEqual({ stdout: "", stderr: "", exit: 0 });
    }
  });

  it("script: denies via stdin JSON, allows clean command", () => {
    const run = (cmd: string) =>
      spawnSync("bun", [HOOK_PATH], { input: JSON.stringify(bash(cmd)), encoding: "utf8" });
    const denied = run("ssh h ls");
    expect(denied.status).toBe(0);
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(run("ls").stdout).toBe("");
  });
});
