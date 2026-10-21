import { describe, test, expect, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check } from "../../src/hooks/commit-guard.js";
import { makeRepo, tempDir, runPluginHook } from "./commit-sandbox.js";

const BAD = "bad message";
const GOOD = "fix: good message";

let repo: string;
let outside: string;

async function decide(command: string, cwd = repo): Promise<{ decision: "allow" | "deny"; reason: string }> {
  const r = await check({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });
  if (r.stdout.trim() === "") return { decision: "allow", reason: "" };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason };
}

beforeAll(() => {
  repo = makeRepo();
  outside = tempDir("hr-commit-outside-");
  writeFileSync(join(repo, "bad.txt"), `${BAD}\n`);
  writeFileSync(join(repo, "good.txt"), `${GOOD}\n`);
  writeFileSync(join(repo, "comment.txt"), `${GOOD}\n\n# a comment git keeps without an editor\n`);
});

describe("commit guard denies a failing message and allows a passing one", () => {
  const cases: Array<[string, string, string]> = [
    ["-m", `git commit -m "${BAD}"`, `git commit -m "${GOOD}"`],
    ["-m with single quotes", `git commit -m '${BAD}'`, `git commit -m '${GOOD}'`],
    ["--message=", `git commit --message="${BAD}"`, `git commit --message="${GOOD}"`],
    ["-am cluster", `git commit -am "${BAD}"`, `git commit -am "${GOOD}"`],
    ["repeated -m joins paragraphs", `git commit -m "${GOOD}" -m "a body paragraph"`, `git commit -m "${GOOD}"`],
    ["-F <file>", "git commit -F bad.txt", "git commit -F good.txt"],
    ["--file=<file>", "git commit --file=bad.txt", "git commit --file=good.txt"],
    ["-F - heredoc", `git commit -F - <<'EOF'\n${BAD}\nEOF`, `git commit -F - <<'EOF'\n${GOOD}\nEOF`],
    ["-F - unquoted heredoc", `git commit -F - <<EOF\n${BAD}\nEOF`, `git commit -F - <<EOF\n${GOOD}\nEOF`],
    ["-F - herestring", `git commit -F - <<< "${BAD}"`, `git commit -F - <<< "${GOOD}"`],
    ["-F - from a file redirect", "git commit -F - < bad.txt", "git commit -F - < good.txt"],
    ["--amend -m", `git commit --amend -m "${BAD}"`, `git commit --amend -m "${GOOD}"`],
    ["chained after &&", `git add x && git commit -m "${BAD}"`, `git add x && git commit -m "${GOOD}"`],
    ["chained after ;", `git status; git commit -m "${BAD}" && git push`, `git status; git commit -m "${GOOD}" && git push`],
    ["env prefix", `GIT_TRACE=0 git commit -m "${BAD}"`, `GIT_TRACE=0 git commit -m "${GOOD}"`],
    ["comment lines count without an editor", "git commit -F comment.txt", "git commit -F good.txt"],
  ];
  for (const [name, bad, good] of cases) {
    test(name, async () => {
      const denied = await decide(bad);
      expect(denied.decision).toBe("deny");
      expect(denied.reason).toContain("line ");
      expect((await decide(good)).decision).toBe("allow");
    });
  }

  test("deny names the lint reason and the config pointer", async () => {
    const { reason } = await decide(`git commit -m "${BAD}"`);
    expect(reason).toContain("subject does not match type(scope)?: description");
    expect(reason).toContain('rules["commit-message"]');
  });

  test("git -C <dir> lints against the target repo, not the session cwd", async () => {
    expect((await decide(`git -C ${repo} commit -m "${BAD}"`, outside)).decision).toBe("deny");
    expect((await decide(`git -C ${repo} commit -m "${GOOD}"`, outside)).decision).toBe("allow");
    const unconfigured = makeRepo(null);
    expect((await decide(`git -C ${unconfigured} commit -m "${BAD}"`)).decision).toBe("allow");
  });

  test("git -C <dir> resolves -F relative to the target repo", async () => {
    expect((await decide(`git -C ${repo} commit -F bad.txt`, outside)).decision).toBe("deny");
  });

  test("cd <dir> && git commit lints against the cd target", async () => {
    expect((await decide(`cd ${repo} && git commit -m "${BAD}"`, outside)).decision).toBe("deny");
    expect((await decide(`cd ${repo} && git commit -m "${GOOD}"`, outside)).decision).toBe("allow");
  });

  test("a subdirectory of the repo uses the repo's config", async () => {
    const sub = join(repo, "nested/dir");
    mkdirSync(sub, { recursive: true });
    expect((await decide(`git commit -m "${BAD}"`, sub)).decision).toBe("deny");
  });
});

describe("commit guard allows what it cannot or should not lint", () => {
  test("no message source opens the editor, which the git hook covers", async () => {
    expect((await decide("git commit")).decision).toBe("allow");
    expect((await decide("git commit --amend --no-edit")).decision).toBe("allow");
    expect((await decide("git add -A && git commit -v")).decision).toBe("allow");
  });

  test("a shell-expanded message is left to the git hook", async () => {
    expect((await decide('git commit -m "$MSG"')).decision).toBe("allow");
    expect((await decide("git commit -m \"$(cat msg)\"")).decision).toBe("allow");
    expect((await decide("printf 'bad\\n' | git commit -F -")).decision).toBe("allow");
  });

  test("a missing -F file is left to git", async () => {
    expect((await decide("git commit -F nowhere.txt")).decision).toBe("allow");
  });

  test("git commit text inside another command's argument is not a commit", async () => {
    expect((await decide(`echo "git commit -m '${BAD}'"`)).decision).toBe("allow");
    expect((await decide(`grep -r "git commit -m ${BAD}" .`)).decision).toBe("allow");
  });

  test("an invalid .house-rules.json fails open", async () => {
    const invalid = makeRepo({ rules: { "commit-message": "off" } });
    expect((await decide(`git commit -m "${BAD}"`, invalid)).decision).toBe("allow");
  });

  test("no .house-rules.json allows a failing message", async () => {
    const bare = makeRepo(null);
    expect((await decide(`git commit -m "${BAD}"`, bare)).decision).toBe("allow");
  });

  test("outside a git repo allows", async () => {
    expect((await decide(`git commit -m "${BAD}"`, outside)).decision).toBe("allow");
  });

  test("non-Bash tools and malformed payloads allow", async () => {
    expect((await check({ tool_name: "Write", tool_input: { file_path: "x" }, cwd: repo })).stdout).toBe("");
    expect((await check(null)).stdout).toBe("");
    expect((await check({ tool_name: "Bash", tool_input: {}, cwd: repo })).stdout).toBe("");
  });

  test("a syntax error elsewhere in the command does not hide a failing commit", async () => {
    expect((await decide(`git commit -m "${BAD}" && echo "unterminated`)).decision).toBe("deny");
  });
});

describe("commit guard is wired as a PreToolUse Bash hook", () => {
  test("plugin.json runs the guard, which denies bad and allows good", () => {
    const run = (command: string) =>
      runPluginHook("PreToolUse", "commit-guard.ts", repo, { tool_name: "Bash", tool_input: { command } });
    const bad = run(`git commit -m "${BAD}"`);
    expect(bad.exit).toBe(0);
    expect(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    const good = run(`git commit -m "${GOOD}"`);
    expect(good.exit).toBe(0);
    expect(good.stdout.trim()).toBe("");
  });
});
