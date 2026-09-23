import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../../src/hooks/commit-message-guard.js";

function bash(command: string, cwd?: string) {
  const toolInput: Record<string, string> = { command };
  if (cwd !== undefined) toolInput["cwd"] = cwd;
  return { tool_name: "Bash", tool_input: toolInput };
}

/**
 * Parse stdout. Empty stdout = allow. Returns permissionDecision string or "allow".
 * Callers assert "deny" on violation tests so a parse error produces a clear failure.
 */
function decision(result: { stdout: string; exit: number }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

function reason(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason;
  } catch {
    return "";
  }
}

describe("commit-message-guard — Family 6", () => {
  it("ALLOW: valid subject-only message passes through (empty stdout, exit 0)", () => {
    const result = check(bash('git commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("DENY: message with body blocked — reason names the offending line", () => {
    const result = check(bash(
      'git commit -m "fix(auth): correct token expiry check" -m "This explains the why"',
    ));
    expect(result.exit).toBe(0);
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/line \d+/);
  });

  it("DENY: process vocabulary in subject — reason says line 1 and process vocabulary", () => {
    const result = check(bash('git commit -m "fix(auth): advisor APPROVE gate cycle"'));
    expect(result.exit).toBe(0);
    expect(decision(result)).toBe("deny");
    const r = reason(result);
    expect(r).toMatch(/line 1/);
    expect(r).toMatch(/process vocabulary/);
  });

  it("ALLOW: GROUNDWORK_COMMIT_LINT=0 suppresses denial (kill-switch)", () => {
    const badPayload = bash(
      'git commit -m "fix(auth): correct token expiry check" -m "This explains the why"',
    );

    // Positive control: without kill-switch, denied
    const withoutKillSwitch = check(badPayload);
    expect(decision(withoutKillSwitch)).toBe("deny");

    // With kill-switch, allowed
    const origVal = process.env["GROUNDWORK_COMMIT_LINT"];
    process.env["GROUNDWORK_COMMIT_LINT"] = "0";
    try {
      const withKillSwitch = check(badPayload);
      expect(withKillSwitch.stdout).toBe("");
      expect(withKillSwitch.exit).toBe(0);
    } finally {
      if (origVal === undefined) delete process.env["GROUNDWORK_COMMIT_LINT"];
      else process.env["GROUNDWORK_COMMIT_LINT"] = origVal;
    }
  });

  it("ALLOW: non-git-commit Bash command passes through", () => {
    const result = check(bash("echo hello"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: non-Bash tool passes through", () => {
    const result = check({ tool_name: "Write", tool_input: { command: 'git commit -m "fix: bad"' } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: editor-driven commit (no -m) passes through", () => {
    const result = check(bash("git commit --amend"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: attribution trailer stripped, valid subject allowed", () => {
    const result = check(bash(
      'git commit -m "fix(auth): correct token expiry" -m "Claude-Session: https://claude.ai/test"',
    ));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("DENY: -F with violating message — reason names line 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-test-"));
    try {
      const msgFile = join(dir, "msg.txt");
      writeFileSync(msgFile, "Bad commit message\n");
      const result = check(bash(`git commit -F ${msgFile}`));
      expect(result.exit).toBe(0);
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/line 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOW: -F with conforming message", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-test-"));
    try {
      const msgFile = join(dir, "msg.txt");
      writeFileSync(msgFile, "fix(auth): correct token expiry check\n");
      const result = check(bash(`git commit -F ${msgFile}`));
      expect(result.stdout).toBe("");
      expect(result.exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ALLOW: nonexistent -F path passes through silently", () => {
    const result = check(bash("git commit -F /tmp/groundwork-no-such-file-xyzzy.txt"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: -F - (stdin) passes through silently", () => {
    const result = check(bash("git commit -F -"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("BITE-PROOF: modifying the guard to skip body check breaks TC DENY body test", () => {
    const result = check(bash(
      'git commit -m "fix(auth): correct token expiry check" -m "Body text here"',
    ));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/line/);
  });
});

describe("commit-message-guard — wrapper forms", () => {
  it("DENY: command git commit — bad message blocked", () => {
    const result = check(bash('command git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: command git commit — valid message passes", () => {
    const result = check(bash('command git commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
  });

  it("DENY: builtin git commit — bad message blocked", () => {
    const result = check(bash('builtin git commit -m "bad message"'));
    expect(decision(result)).toBe("deny");
  });

  it("DENY: FOO=1 git commit — bad message blocked", () => {
    const result = check(bash('FOO=1 git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: FOO=1 git commit — valid message passes", () => {
    const result = check(bash('FOO=1 git commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
  });

  it("DENY: git -C /some/path commit — bad message blocked", () => {
    const result = check(bash('git -C /tmp commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: git -C /some/path commit — valid message passes", () => {
    const result = check(bash('git -C /tmp commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
  });

  it("DENY: git -c core.autocrlf=true commit — bad message blocked", () => {
    const result = check(bash('git -c core.autocrlf=true commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: git -c core.autocrlf=true commit — valid message passes", () => {
    const result = check(bash('git -c core.autocrlf=true commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
  });

  it("DENY: git --git-dir=.git commit — bad message blocked", () => {
    const result = check(bash('git --git-dir=.git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("DENY: cmd && git commit — bad message after && blocked", () => {
    const result = check(bash('git add . && git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: cmd && git commit — valid message after && passes", () => {
    const result = check(bash('git add . && git commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
  });

  it("DENY: cmd; git commit — bad message after ; blocked", () => {
    const result = check(bash('echo prep; git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });

  it("ALLOW: unrelated command only — no false positive", () => {
    const result = check(bash('git add . && echo done'));
    expect(result.stdout).toBe("");
  });

  it("BITE-PROOF: reverting command-prefix handling makes command-git test fail", () => {
    const result = check(bash('command git commit -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
  });
});
