import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

  it("ALLOW: git -C /some/path commit — valid handbook message passes", () => {
    const result = check(bash('git -C /tmp commit -m "Fix token expiry check"'));
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

  it("DENY: git -C to non-git-repo uses target preset (handbook), not session preset (conventional)", () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-cmg-cross-'));
    try {
      const result = check(bash(`git -C ${dir} commit -m "feat: add new thing"`));
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/Add, Fix, Remove, Update, Refactor, Test/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DENY: Fixed … (past tense) not a valid handbook verb", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-hb-"));
    try {
      const result = check(bash(`git -C ${dir} commit -m "Fixed the login redirect"`));
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/Add, Fix, Remove, Update, Refactor, Test/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DENY: Addressed … not a valid handbook verb", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-hb-"));
    try {
      const result = check(bash(`git -C ${dir} commit -m "Addressed review comments"`));
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/Add, Fix, Remove, Update, Refactor, Test/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DENY: Fix: … (colon after verb) not a valid handbook verb", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-cmg-hb-"));
    try {
      const result = check(bash(`git -C ${dir} commit -m "Fix: correct the redirect"`));
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/Add, Fix, Remove, Update, Refactor, Test/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("commit-message-guard — chained command segment isolation", () => {
  // A: sibling git tag -m must not be joined into commit message
  it("ALLOW A: git commit valid && git tag -m should not fail due to tag message", () => {
    const result = check(bash('git commit -m "chore: b" && git tag -a v1 -m "v1"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  // B: semicolon separator
  it("ALLOW B: git commit valid; git tag -m should not fail due to tag message", () => {
    const result = check(bash('git commit -m "chore: b"; git tag -a v1 -m "v1"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW C: git commit valid && echo -m x should not fail due to echo flag", () => {
    const result = check(bash('git commit -m "chore: b" && echo -m "x"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW D: git tag -m before && git commit valid passes", () => {
    const result = check(bash('git tag -a v1 -m "v1" && git commit -m "chore: b"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("DENY E: git commit bad subject && grep -F must deny based on subject", () => {
    const result = check(bash('git commit -m "bad subject" && grep -F x y'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/subject does not match/);
  });

  it("DENY F: git commit bad subject && git tag -m must deny on commit", () => {
    const result = check(bash('git commit -m "bad subject" && git tag -a v1 -m "v1"'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/line 1/);
  });

  it("DENY G: multi -m in one commit segment is unchanged (body violation still denied)", () => {
    const result = check(bash('git commit -m "chore: b" -m "body line"'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/line/);
  });
});

describe("commit-message-guard — plumbing bypass (commit-tree, update-ref, no-verify)", () => {
  // --- git commit-tree -m "$var" → deny with shell-var guidance ---
  it("DENY: commit-tree with shell var in -m → denied, asks for literal message", () => {
    const cmd = 'c1=$(GIT_AUTHOR_DATE="$ad1" git commit-tree 002e4af^{tree} -p ebe57dc -m "$m1")';
    const result = check(bash(cmd));
    expect(decision(result)).toBe("deny");
    const r = reason(result);
    expect(r).toMatch(/shell variable/);
    expect(r).toMatch(/git commit/);
  });

  it("DENY: commit-tree with $var in double-quoted -m (full incident fixture segment)", () => {
    const cmd = 'c2=$(GIT_AUTHOR_DATE="$ad2" git commit-tree 27d2993^{tree} -p "$c1" -m "$m2")';
    const result = check(bash(cmd));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/shell variable/);
  });

  it("DENY: commit-tree with literal invalid message → linted, denied for format", () => {
    const result = check(bash('git commit-tree abc123^{tree} -p def456 -m "bad message no convention"'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/line 1/);
  });

  it("ALLOW: commit-tree with valid literal message passes lint", () => {
    const result = check(bash('git commit-tree abc123^{tree} -p def456 -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: full incident fixture — git log lines must not false-positive (no commit-tree match on log)", () => {
    const cmd = 'ad1=$(git log -1 --format=%ad --date=raw 002e4af); ad2=$(git log -1 --format=%ad --date=raw 27d2993)';
    const result = check(bash(cmd));
    // git log is not commit/commit-tree/update-ref → allow
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  // --- git update-ref refs/heads/* → deny ---
  it("DENY: update-ref on refs/heads/* (full incident fixture line) → denied with rebase guidance", () => {
    const cmd = 'git update-ref -m "reword: conventional commit subjects" refs/heads/develop "$c2" 27d293212b2';
    const result = check(bash(cmd));
    expect(decision(result)).toBe("deny");
    const r = reason(result);
    expect(r).toMatch(/refs\/heads/);
    expect(r).toMatch(/amend|rebase/);
  });

  it("DENY: update-ref -d refs/heads/feature → denied", () => {
    const result = check(bash('git update-ref -d refs/heads/feature-branch'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/refs\/heads/);
  });

  it("ALLOW: update-ref on refs/tags/* → allowed", () => {
    const result = check(bash('git update-ref refs/tags/v1.0.0 abc123'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: update-ref on refs/notes/* → allowed", () => {
    const result = check(bash('git update-ref refs/notes/commits abc123'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  // --- git commit --no-verify / -n → deny ---
  it("DENY: git commit --no-verify with valid message still denied (skips hook)", () => {
    const result = check(bash('git commit -m "Fix token expiry check" --no-verify'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/--no-verify/);
  });

  it("DENY: git commit -n (short form) denied", () => {
    const result = check(bash('git commit -m "Fix token expiry check" -n'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/--no-verify|-n/);
  });

  it("ALLOW: git commit without --no-verify passes (regression guard)", () => {
    const result = check(bash('git commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  // --- git -c core.hooksPath=... → deny ---
  it("DENY: git -c core.hooksPath=/dev/null commit → denied (overrides hooks dir)", () => {
    const result = check(bash('git -c core.hooksPath=/dev/null commit -m "Fix token expiry check"'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/core\.hooksPath|hooks/i);
  });

  it("ALLOW: git -c core.autocrlf=true commit valid msg → allowed (non-hooksPath config)", () => {
    const result = check(bash('git -c core.autocrlf=true commit -m "fix(auth): correct token expiry check"'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("payload top-level cwd wins over tool_input.cwd for preset resolution", () => {
    const handbookDir = mkdtempSync(join(tmpdir(), "gw-hb-cwd-"));
    const conventionalDir = mkdtempSync(join(tmpdir(), "gw-conv-cwd-"));
    try {
      const gi = { cwd: conventionalDir };
      spawnSync('git', ['init'], gi);
      spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'fix: initial'], gi);
      const payload = {
        tool_name: "Bash",
        tool_input: { command: 'git commit -m "feat: add new thing"', cwd: conventionalDir },
        cwd: handbookDir,
      };
      const result = check(payload);
      expect(decision(result)).toBe("deny");
      expect(reason(result)).toMatch(/Add, Fix, Remove, Update, Refactor, Test/);
    } finally {
      rmSync(handbookDir, { recursive: true, force: true });
      rmSync(conventionalDir, { recursive: true, force: true });
    }
  });

  it("DENY: multi-line command — commit-tree line caught despite git-log lines before it", () => {
    const cmd = [
      'ad1=$(git log -1 --format=%ad --date=raw 002e4af); ad2=$(git log -1 --format=%ad --date=raw 27d2993)',
      'c1=$(GIT_AUTHOR_DATE="$ad1" git commit-tree 002e4af^{tree} -p ebe57dc -m "$m1")',
      'c2=$(GIT_AUTHOR_DATE="$ad2" git commit-tree 27d2993^{tree} -p "$c1" -m "$m2")',
      'git update-ref -m "reword: conventional commit subjects" refs/heads/develop "$c2" 27d293212b2',
    ].join('\n');
    const result = check(bash(cmd));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/shell variable/);
  });

  it("DENY: commit-tree with no -m/-F (stdin pipe) → denied, guidance to use git commit", () => {
    const result = check(bash('echo "whatever" | git commit-tree HEAD^{tree} -p HEAD'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/git commit/);
  });

  it("DENY: commit-tree with no -m/-F (stdin redirect <) → denied", () => {
    const result = check(bash('git commit-tree HEAD^{tree} -p HEAD < /tmp/msg'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/git commit/);
  });

  it("DENY: update-ref HEAD abc123 → denied (moves current branch)", () => {
    const result = check(bash('git update-ref HEAD abc123'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/amend|rebase/);
  });

  it("DENY: update-ref bare branch name abc123 → denied", () => {
    const result = check(bash('git update-ref develop abc123'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/amend|rebase/);
  });

  it("DENY: update-ref --stdin → denied outright", () => {
    const result = check(bash('git update-ref --stdin'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/amend|rebase/);
  });

  it("DENY: git hash-object -t commit -w → denied (loose commit object)", () => {
    const result = check(bash('git hash-object -t commit -w /tmp/obj'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/hash-object|commit/i);
  });

  it("DENY: git hash-object --type=commit -w → denied", () => {
    const result = check(bash('git hash-object --type=commit -w /tmp/obj'));
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toMatch(/hash-object|commit/i);
  });

  it("ALLOW: git hash-object -t blob -w → allowed (not a commit type)", () => {
    const result = check(bash('git hash-object -t blob -w /tmp/file'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: git hash-object -t commit (no -w) → allowed (read-only)", () => {
    const result = check(bash('git hash-object -t commit /tmp/obj'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: update-ref refs/tags/v1 abc → allowed (allowlist)", () => {
    const result = check(bash('git update-ref refs/tags/v1 abc123'));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("ALLOW: commit-tree with valid literal message in handbook temp repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-ct-hb-"));
    try {
      const result = check(bash(`git commit-tree abc123^{tree} -p def456 -m "Fix typo in readme"`, dir));
      expect(result.stdout).toBe("");
      expect(result.exit).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
