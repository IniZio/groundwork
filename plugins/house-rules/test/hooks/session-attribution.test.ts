import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, makeRepo, tempDir, runPluginHook } from "./commit-sandbox.js";

const LINK = "https://claude.ai/code/session_01AbCdEf";

describe("the commit-msg hook strips session attribution before linting", () => {
  function commit(message: string) {
    const repo = makeRepo();
    const installed = runPluginHook("SessionStart", "install-commit-msg.ts", repo, { source: "startup" });
    expect(installed.stdout).toContain("installed the commit-msg hook");
    const file = join(repo, "MSG");
    writeFileSync(file, message);
    const r = git(repo, ["commit", "--allow-empty", "-F", file]);
    return { status: r.status, stderr: r.stderr, logged: git(repo, ["log", "-1", "--format=%B"]).stdout };
  }

  test("a subject followed only by a Claude-Session trailer commits as the bare subject", () => {
    const r = commit(`fix: tidy\n\nClaude-Session: ${LINK}\n`);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.logged).toBe("fix: tidy\n\n");
  });

  test("a lowercase trailer key and a labelled markdown link are both removed", () => {
    const r = commit(`fix: tidy\n\nclaude-session: ${LINK}\nSession: [link](${LINK})\n`);
    expect(r.status).toBe(0);
    expect(r.logged).toBe("fix: tidy\n\n");
  });
});

describe("lint-commit-msg rewrites the message file in place", () => {
  function lintFile(message: string, config?: Parameters<typeof makeRepo>[0]) {
    const repo = makeRepo(config);
    const file = join(repo, "MSG");
    writeFileSync(file, message);
    const r = Bun.spawnSync([join(import.meta.dir, "../../bin/house-rules"), "lint-commit-msg", file], { cwd: repo });
    return { status: r.exitCode, after: readFileSync(file, "utf8") };
  }

  test("a real paragraph is kept and the trailer is removed", () => {
    const r = lintFile(`fix: tidy\n\nExplain the change.\n\nClaude-Session: ${LINK}\n`);
    expect(r.after).toBe("fix: tidy\n\nExplain the change.\n");
  });

  test("a bare session URL line is removed and git's comment block survives", () => {
    const r = lintFile(`fix: tidy\n\n${LINK}\n\n# Please enter the commit message\n#\n`);
    expect(r.after).toBe("fix: tidy\n\n# Please enter the commit message\n#\n");
  });

  test("a message without attribution keeps its exact bytes", () => {
    const message = "fix: tidy\n\n\nSee https://claude.ai/docs and Session: notes.\n\n\n";
    expect(lintFile(message).after).toBe(message);
  });

  test("a repo without .house-rules.json still has the attribution removed", () => {
    expect(lintFile(`fix: tidy\n\nClaude-Session: ${LINK}\n`, null).after).toBe("fix: tidy\n");
  });
});

describe("the PreToolUse Bash hook strips session attribution from gh pr bodies", () => {
  const SCRIPT = "session-link-strip.ts";
  const run = (cwd: string, command: string) =>
    runPluginHook("PreToolUse", SCRIPT, cwd, { tool_name: "Bash", tool_input: { command, description: "open PR" } });
  const updated = (stdout: string) => JSON.parse(stdout).hookSpecificOutput;

  test("an inline --body loses its trailing session link and keeps every other field", () => {
    const cwd = tempDir("hr-pr-");
    const r = run(cwd, `gh pr create --title "fix: x" --body "Summary é\n\n${LINK}" --draft`);
    expect(r.exit).toBe(0);
    const out = updated(r.stdout);
    expect(out.hookEventName).toBe("PreToolUse");
    expect(out.permissionDecision).toBeUndefined();
    expect(out.updatedInput).toEqual({ command: `gh pr create --title "fix: x" --body "Summary é" --draft`, description: "open PR" });
  });

  test("a heredoc body inside -b loses its Claude-Session trailer", () => {
    const cwd = tempDir("hr-pr-");
    const command = `gh pr edit 12 -b "$(cat <<'EOF'\n## Why\n\nBecause.\n\nClaude-Session: ${LINK}\nEOF\n)"`;
    const out = updated(run(cwd, command).stdout);
    expect(out.updatedInput.command).toBe(`gh pr edit 12 -b "$(cat <<'EOF'\n## Why\n\nBecause.\nEOF\n)"`);
  });

  test("--body= with a single-quoted value is stripped", () => {
    const cwd = tempDir("hr-pr-");
    const out = updated(run(cwd, `cd . && gh pr create --body='Text\n\nSession: ${LINK}'`).stdout);
    expect(out.updatedInput.command).toBe(`cd . && gh pr create --body='Text'`);
  });

  test("--body-file has its file stripped in place and the command is left alone", () => {
    const cwd = tempDir("hr-pr-");
    writeFileSync(join(cwd, "body.md"), `## Why\n\nBecause.\n\n${LINK}\n`);
    const r = run(cwd, "gh pr create --title t --body-file body.md");
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
    expect(readFileSync(join(cwd, "body.md"), "utf8")).toBe("## Why\n\nBecause.\n");
  });

  test("-F with a stdin heredoc rewrites the heredoc in the command", () => {
    const cwd = tempDir("hr-pr-");
    const out = updated(run(cwd, `gh pr create -F - <<'EOF'\nBody.\n\nClaude-Session: ${LINK}\nEOF`).stdout);
    expect(out.updatedInput.command).toBe(`gh pr create -F - <<'EOF'\nBody.\nEOF`);
  });

  test("a gh pr body without attribution produces no output", () => {
    const cwd = tempDir("hr-pr-");
    writeFileSync(join(cwd, "body.md"), "Body.\n\n\n");
    expect(run(cwd, `gh pr create --body "Plain\n\nhttps://claude.ai/docs"`).stdout).toBe("");
    expect(run(cwd, "gh pr edit --body-file body.md").stdout).toBe("");
    expect(readFileSync(join(cwd, "body.md"), "utf8")).toBe("Body.\n\n\n");
  });

  test("an unrelated gh pr list produces no output", () => {
    const r = run(tempDir("hr-pr-"), `gh pr list --search "${LINK}"`);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("the commit guard lints the message as the commit-msg hook will leave it", () => {
  test("a subject-only commit with a -m session trailer is not denied", () => {
    const repo = makeRepo();
    const command = `git commit --allow-empty -m "fix: tidy" -m "Claude-Session: ${LINK}"`;
    const r = runPluginHook("PreToolUse", "commit-guard.ts", repo, { tool_name: "Bash", tool_input: { command } });
    expect(r.stdout).toBe("");
  });
});
