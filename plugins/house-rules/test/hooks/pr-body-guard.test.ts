import { describe, test, expect, beforeAll } from "bun:test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeRepo, runPluginHook } from "./commit-sandbox.js";

const FIXTURES = resolve(import.meta.dir, "../fixtures/pr-body");
const ENABLED = { rules: { "pr-body": "error" } };

let enabled: string;
let disabled: string;

beforeAll(() => {
  for (const repo of [(enabled = makeRepo(ENABLED)), (disabled = makeRepo({ rules: {} }))]) {
    for (const f of ["moor-956-dense.md", "moor-421-reheaded.md"]) copyFileSync(join(FIXTURES, f), join(repo, f));
  }
});

function decide(repo: string, command: string) {
  const r = runPluginHook("PreToolUse", "pr-body-guard.ts", repo, { tool_name: "Bash", tool_input: { command } });
  if (r.stdout.trim() === "") return { decision: "allow", reason: "" };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: out.permissionDecision as string, reason: out.permissionDecisionReason as string };
}

describe("pr-body guard", () => {
  test("denies a dense --body-file in a repo that enables pr-body, listing each finding", () => {
    const r = decide(enabled, "gh pr create --title t --body-file moor-956-dense.md");
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("sentence has 69 words");
    expect(r.reason).toContain('- "## Scope" — PR body has no "## Scope" heading');
    expect(r.reason).toContain("split each long sentence");
  });

  test("allows the re-headed plain body in the same repo", () => {
    expect(decide(enabled, "gh pr create --title t --body-file moor-421-reheaded.md").decision).toBe("allow");
  });

  test("allows the dense body when the repo does not enable pr-body", () => {
    expect(decide(disabled, "gh pr create --title t --body-file moor-956-dense.md").decision).toBe("allow");
  });

  test("allows a repo with no .house-rules.json", () => {
    expect(decide(makeRepo(null), "gh pr create --body-file moor-956-dense.md").decision).toBe("allow");
  });

  const dense = "One fact; another fact.";
  const cases: Array<[string, string]> = [
    ["--body", `gh pr create --body "${dense}"`],
    ["-b with single quotes", `gh pr edit 3 -b '${dense}'`],
    ["--body=", `gh pr create --body="${dense}"`],
    ["heredoc inside a command substitution", `gh pr create --body "$(cat <<'EOF'\n${dense}\nEOF\n)"`],
    ["-F - heredoc stdin", `gh pr create -F - <<'EOF'\n${dense}\nEOF`],
    ["chained after cd", `cd ${"/"} && gh pr create --body "${dense}"`],
  ];
  for (const [name, command] of cases) {
    test(`reads the body from ${name}`, () => {
      expect(decide(enabled, command.replace("cd / &&", `cd ${enabled} &&`)).decision).toBe("deny");
      expect(decide(disabled, command.replace("cd / &&", `cd ${disabled} &&`)).decision).toBe("allow");
    });
  }

  test("a passing inline body is allowed", () => {
    const body = "## Why\n\nOne fact.\n\n## Scope\n\nAnother fact.";
    expect(decide(enabled, `gh pr create --body "${body}"`).decision).toBe("allow");
  });

  test("a command that is not gh pr create or edit is allowed", () => {
    expect(decide(enabled, `echo "${dense}"`).decision).toBe("allow");
    expect(decide(enabled, `gh pr view 3 --body-file moor-956-dense.md`).decision).toBe("allow");
  });

  test("an unreadable body file fails open", () => {
    writeFileSync(join(enabled, "ok.txt"), "x");
    expect(decide(enabled, "gh pr create --body-file missing.md").decision).toBe("allow");
  });
});
