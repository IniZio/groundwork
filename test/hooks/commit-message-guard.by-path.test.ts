/**
 * By-path tests: spawn bun <root>/src/hooks/commit-message-guard.ts exactly
 * as plugin.json invokes it, with JSON on stdin. Catches broken entrypoints
 * that direct-import tests cannot see.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/commit-message-guard.ts");

function makeRepo(): string {
  const d = mkdtempSync(join(tmpdir(), "gw-cmg-bp-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: d });
  return d;
}

const REPO = makeRepo();
const extraRepos: string[] = [];
afterAll(() => {
  for (const d of [REPO, ...extraRepos]) rmSync(d, { recursive: true, force: true });
});

function run(
  payload: unknown,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; exit: number } {
  const { CLAUDE_PROJECT_DIR: _drop, ...base } = process.env;
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...base, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: REPO, ...env },
    cwd: REPO,
    timeout: 15_000,
  });
  return {
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
    exit: r.status ?? 1,
  };
}

function repoWith(config: unknown): string {
  const repo = makeRepo();
  extraRepos.push(repo);
  writeFileSync(join(repo, ".house-rules.json"), JSON.stringify(config));
  return repo;
}

function bash(command: string, cwd: string = REPO) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    cwd,
  };
}

function decision(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

function reason(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason;
  } catch {
    return "";
  }
}

describe("commit-message-guard — by-path (entrypoint test)", () => {
  it("exits 0 always (deny is signalled through stdout, not exit code)", () => {
    const { exit } = run(bash('git commit -m "bad message"'));
    expect(exit).toBe(0);
  });

  it("ALLOW: valid message — empty stdout, exit 0", () => {
    const { stdout, exit } = run(bash('git commit -m "Fix token expiry check"'));
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("DENY: message with body — stdout contains deny decision", () => {
    const { stdout, exit } = run(
      bash(
        'git commit -m "Fix token expiry check" -m "body text here"',
        repoWith({ rules: { "commit-message": ["error", { preset: "subject-only" }] } }),
      ),
    );
    expect(exit).toBe(0);
    expect(decision(stdout)).toBe("deny");
    expect(reason(stdout)).toMatch(/line \d+/);
  });

  it("DENY: process vocabulary — reason names line 1 and process vocabulary", () => {
    const { stdout, exit } = run(bash('git commit -m "fix(auth): advisor APPROVE gate cycle"'));
    expect(exit).toBe(0);
    expect(decision(stdout)).toBe("deny");
    const r = reason(stdout);
    expect(r).toMatch(/line 1/);
    expect(r).toMatch(/process vocabulary/);
  });

  it("DENY: GROUNDWORK_COMMIT_LINT=0 is ignored — bad message still denied", () => {
    const { stdout, exit } = run(
      bash('git commit -m "fix(auth): correct token expiry" -m "body here"'),
      { GROUNDWORK_COMMIT_LINT: "0" },
    );
    expect(exit).toBe(0);
    expect(decision(stdout)).toBe("deny");
  });

  it("DENY: no .house-rules.json — last reason line is the config pointer", () => {
    const { stdout } = run(bash('git commit -m "fix(auth): correct token expiry" -m "body here"'));
    expect(decision(stdout)).toBe("deny");
    const last = reason(stdout).split("\n").at(-1);
    expect(last).toBe(
      'Commit style is set by .house-rules.json: rules["commit-message"].preset (active: handbook, source: default)',
    );
  });

  it("DENY: invalid .house-rules.json — reason names the offending key path", () => {
    const repo = repoWith({ rules: { "commit-message": ["error", { preset: "nonesuch" }] } });
    const { stdout } = run(bash('git commit -m "fix(auth): correct token expiry"', repo));
    expect(decision(stdout)).toBe("deny");
    expect(reason(stdout)).toContain('rules["commit-message"][1].preset');
  });

  it("DENY: absolute-path /usr/bin/git commit — deny line on stdout, exit 0", () => {
    const { stdout, exit } = run(bash('/usr/bin/git commit -m "bad message no convention"'));
    expect(exit).toBe(0);
    expect(decision(stdout)).toBe("deny");
    expect(reason(stdout)).toMatch(/line 1/);
  });

  it("ALLOW: non-git-commit Bash command — empty stdout", () => {
    const { stdout, exit } = run(bash("echo hello"));
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("ALLOW: non-Bash tool — empty stdout", () => {
    const { stdout, exit } = run({ tool_name: "Write", tool_input: { content: "x" } });
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("DENY: -F file with violating message — reason names line 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-bp-test-"));
    try {
      const msgFile = join(dir, "msg.txt");
      writeFileSync(msgFile, "Bad commit message\n");
      const { stdout, exit } = run(bash(`git commit -F ${msgFile}`));
      expect(exit).toBe(0);
      expect(decision(stdout)).toBe("deny");
      expect(reason(stdout)).toMatch(/line 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOW: -F with conforming message — empty stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-bp-test-"));
    try {
      const msgFile = join(dir, "msg.txt");
      writeFileSync(msgFile, "Fix token expiry check\n");
      const { stdout, exit } = run(bash(`git commit -F ${msgFile}`));
      expect(exit).toBe(0);
      expect(stdout.trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
