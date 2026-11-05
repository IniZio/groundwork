import { describe, it, expect, beforeAll } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../hooks/commit-sandbox.js";

const REPO = path.resolve(import.meta.dir, "../..");
const BAD_BODY = "## Why\n\nOne fact; another fact.\n\n## Scope\n\nOne file.\n";
const GOOD_BODY = "## Why\n\nOne fact.\n\n## Scope\n\nOne file.\n";
const BAD_REASON = "a semicolon joins clauses";

async function spawnHook(script: string, command: string, cwd: string) {
  const { CLAUDE_PROJECT_DIR: _dir, CLAUDE_PLUGIN_ROOT: _root, ...env } = process.env;
  const proc = Bun.spawn(["bun", path.join(REPO, "src/hooks", script)], { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd, env });
  proc.stdin.write(JSON.stringify({ session_id: "test", hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command } }));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  const output = stdout.trim() === "" ? null : (JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;
  return { stdout, exit, output };
}

/** Each wrapper with `%` standing for the wrapped command. */
const WRAPPERS: Array<[string, string]> = [
  ["bare", "%"],
  ["GH_TOKEN prefix", "GH_TOKEN=x %"],
  ["piped to tail", "% 2>&1 | tail -2"],
  ["command", "command %"],
  ["exec", "exec %"],
  ["nohup", "nohup %"],
  ["env", "env A=/opt/bin/gh %"],
  ["sudo", "sudo -n %"],
  ["timeout with duration", "timeout 60 %"],
  ["timeout with flags", "timeout -k 5 --preserve-status 60s %"],
  ["nice", "nice -n 5 %"],
  ["ionice", "ionice -c 3 %"],
  ["stdbuf", "stdbuf -oL %"],
  ["setsid", "setsid %"],
  ["flock", "flock /tmp/hr.lock %"],
  ["time", "time %"],
  ["xargs", "printf 1 | xargs %"],
  ["find -exec", "find . -maxdepth 0 -exec % \;"],
  ["a wrapper no list names", "some-new-wrapper --opt %"],
  ["stacked wrappers", "timeout 60 nice -n 5 %"],
  ["bash -c", "bash -c '%'"],
  ["sh -c", "sh -c '%'"],
  ["bash -lc", "bash -lc '%'"],
  ["bash -c double quoted", 'bash -c "%"'],
  ["timeout then bash -c", "timeout 60 bash -c 'cd . && %'"],
  ["flock -c", "flock /tmp/hr.lock -c '%'"],
  ["eval unquoted", "eval %"],
  ["eval quoted", "eval '%'"],
];

const wrap = (wrapper: string, command: string) => wrapper.replace("%", command);

describe("guards see through wrappers, by path", () => {
  let on: string;
  let off: string;

  beforeAll(() => {
    on = makeRepo({ rules: { "pr-body": "error", "commit-message": ["error", { preset: "conventional" }] } });
    off = makeRepo({ rules: { "pr-body": "off" } });
    for (const repo of [on, off]) {
      writeFileSync(path.join(repo, "bad.md"), BAD_BODY);
      writeFileSync(path.join(repo, "good.md"), GOOD_BODY);
      writeFileSync(path.join(repo, "good.txt"), "fix: good message\n");
    }
  });

  for (const [name, wrapper] of WRAPPERS) {
    it(`${name}: gh pr create follows the body`, async () => {
      const bad = await spawnHook("pr-body-guard.ts", wrap(wrapper, "gh pr create --body-file bad.md"), on);
      expect(bad.exit).toBe(0);
      expect(bad.output?.permissionDecision).toBe("deny");
      expect(bad.output?.permissionDecisionReason).toContain(BAD_REASON);
      const good = await spawnHook("pr-body-guard.ts", wrap(wrapper, "gh pr edit 1 --body-file good.md"), on);
      expect(good.exit).toBe(0);
      expect(good.stdout).toBe("");
    });

    it(`${name}: gh pr comment is denied and gh pr view is not`, async () => {
      const comment = await spawnHook("pr-body-guard.ts", wrap(wrapper, "gh pr comment 1 --body-file good.md"), on);
      expect(comment.exit).toBe(0);
      expect(comment.output?.permissionDecisionReason).toContain("proof and updates belong in the PR body");
      const view = await spawnHook("pr-body-guard.ts", wrap(wrapper, "gh pr view 1"), on);
      expect(view.stdout).toBe("");
    });

    it(`${name}: git commit follows the message`, async () => {
      const bad = await spawnHook("commit-guard.ts", wrap(wrapper, "git commit -m badmessage"), on);
      expect(bad.exit).toBe(0);
      expect(bad.output?.permissionDecision).toBe("deny");
      expect(bad.output?.permissionDecisionReason).toContain("fails the repo's commit-message rule");
      const good = await spawnHook("commit-guard.ts", wrap(wrapper, "git commit -F good.txt"), on);
      expect(good.exit).toBe(0);
      expect(good.stdout).toBe("");
    });
  }

  it("a repo that sets pr-body to off allows the bad body through a wrapper", async () => {
    const r = await spawnHook("pr-body-guard.ts", "timeout 60 gh pr create --body-file bad.md", off);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a wrapper keeps the cd target of a re-parsed string", async () => {
    const r = await spawnHook("pr-body-guard.ts", `bash -c 'cd ${on} && gh pr create --body-file bad.md'`, off);
    expect(r.output?.permissionDecision).toBe("deny");
  });

  it("cd inside bash -c does not leak to the next command, and cd inside eval does", async () => {
    const leak = await spawnHook("pr-body-guard.ts", `bash -c 'cd ${on}' && gh pr create --body-file bad.md`, off);
    expect(leak.stdout).toBe("");
    const evald = await spawnHook("pr-body-guard.ts", `eval 'cd ${on}' && gh pr create --body-file bad.md`, off);
    expect(evald.output?.permissionDecision).toBe("deny");
  });

  const notCalls: Array<[string, string]> = [
    ["echo", "echo gh pr create --body-file bad.md"],
    ["timeout echo", "timeout 5 echo gh pr create --body-file bad.md"],
    ["xargs echo", "printf 1 | xargs echo gh pr create --body-file bad.md"],
    ["printf", "printf '%s' gh pr create --body-file bad.md"],
    ["grep quoted", 'grep "gh pr create --body-file bad.md" good.md'],
    ["grep unquoted", "grep gh pr create --body-file bad.md"],
    ["bash -c echo", "bash -c 'echo gh pr create --body-file bad.md'"],
    ["git log grep", "git log --grep gh pr create --body-file bad.md"],
    ["a quoted string to a wrapper", "timeout 5 some-tool 'gh pr create --body-file bad.md'"],
  ];
  for (const [name, command] of notCalls) {
    it(`${name} names gh without running it`, async () => {
      const r = await spawnHook("pr-body-guard.ts", command, on);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    });
  }

  it("echo and gh naming git commit are not commits", async () => {
    for (const command of ["echo git commit -m badmessage", "gh pr view git commit -m badmessage", 'grep "git commit -m badmessage" f']) {
      expect((await spawnHook("commit-guard.ts", command, on)).stdout).toBe("");
    }
  });

  it("env before git commit -S keeps checking the message", async () => {
    const r = await spawnHook("commit-guard.ts", "env A=1 git commit -S -m badmessage", on);
    expect(r.output?.permissionDecision).toBe("deny");
  });

  const API_DENIED: Array<[string, string]> = [
    ["PATCH -F body=@file", "gh api -X PATCH repos/o/r/pulls/1 -F body=@bad.md"],
    ["PATCH -f inline", `gh api -X PATCH repos/o/r/pulls/1 -f body="One fact; another fact."`],
    ["PATCH -f quoted whole", `gh api --method PATCH repos/o/r/pulls/1 -f "body=One fact; another fact."`],
    ["PATCH --raw-field=", `gh api --method=patch repos/o/r/pulls/1 --raw-field="body=One fact; another."`],
    ["attached -f", `gh api -X PATCH repos/o/r/pulls/1 "-fbody=One fact; another."`],
    ["placeholders in the endpoint", "gh api -X PATCH repos/{owner}/{repo}/pulls/1 -F body=@bad.md"],
    ["POST to pulls", "gh api repos/o/r/pulls -f title=t -F body=@bad.md"],
    ["--input file", "gh api -X PATCH repos/o/r/pulls/1 --input bad.json"],
    ["--input=file", "gh api -X PATCH repos/o/r/pulls/1 --input=bad.json"],
    ["--input heredoc", `gh api -X PATCH repos/o/r/pulls/1 --input - <<'EOF'\n{"body":"One fact; another fact."}\nEOF`],
    ["through timeout", "timeout 60 gh api -X PATCH repos/o/r/pulls/1 -F body=@bad.md"],
    ["through bash -c", "bash -c 'gh api -X PATCH repos/o/r/pulls/1 -F body=@bad.md'"],
  ];
  for (const [name, command] of API_DENIED) {
    it(`gh api ${name} is denied`, async () => {
      writeFileSync(path.join(on, "bad.json"), JSON.stringify({ body: BAD_BODY }));
      const r = await spawnHook("pr-body-guard.ts", command, on);
      expect(r.exit).toBe(0);
      expect(r.output?.permissionDecision).toBe("deny");
      expect(r.output?.permissionDecisionReason).toContain(BAD_REASON);
    });
  }

  const API_ALLOWED: Array<[string, string]> = [
    ["a passing body", "gh api -X PATCH repos/o/r/pulls/1 -F body=@good.md"],
    ["a passing --input", "gh api -X PATCH repos/o/r/pulls/1 --input good.json"],
    ["a title only", "gh api -X PATCH repos/o/r/pulls/1 -f title=t"],
    ["--input with no body key", "gh api -X PATCH repos/o/r/pulls/1 --input nobody.json"],
    ["a read", "gh api repos/o/r/pulls/1"],
    ["GET with a query field", "gh api -X GET repos/o/r/pulls -f body=@bad.md"],
    ["a review thread reply", "gh api repos/o/r/pulls/1/comments/5/replies -F body=@bad.md"],
    ["an issue's body", "gh api -X PATCH repos/o/r/issues/1 -F body=@bad.md"],
    ["-f body=@ is literal text", "gh api -X PATCH repos/o/r/pulls/1 -f 'body=## Why\n\nOne fact.\n\n## Scope\n\nOne file.'"],
  ];
  for (const [name, command] of API_ALLOWED) {
    it(`gh api ${name} is allowed`, async () => {
      writeFileSync(path.join(on, "good.json"), JSON.stringify({ body: GOOD_BODY }));
      writeFileSync(path.join(on, "nobody.json"), JSON.stringify({ title: "t" }));
      const r = await spawnHook("pr-body-guard.ts", command, on);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    });
  }

  it("gh api -F body=@- reads the heredoc as the body", async () => {
    const r = await spawnHook("pr-body-guard.ts", "gh api -X PATCH repos/o/r/pulls/1 -F body=@- <<'EOF'\nOne fact; another fact.\nEOF", on);
    expect(r.output?.permissionDecision).toBe("deny");
  });

  it("gh api posting a comment is denied through a wrapper", async () => {
    const r = await spawnHook("pr-body-guard.ts", "timeout 60 gh api repos/o/r/issues/1/comments -f body=x", on);
    expect(r.output?.permissionDecisionReason).toContain("proof and updates belong in the PR body");
    const attached = await spawnHook("pr-body-guard.ts", "gh api repos/o/r/issues/1/comments -fbody=x", on);
    expect(attached.output?.permissionDecision).toBe("deny");
  });
});

describe("PR body word cap, by path", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `W${i}${(i + 1) % 20 === 0 ? "." : ""}`).join(" ");
  const withWords = (total: number) => `## Why\n\nOne.\n\n## Scope\n\n${filler(total - 3)}.\n`;
  let repo: string;

  beforeAll(() => {
    repo = makeRepo({ rules: { "pr-body": "error" } });
    writeFileSync(path.join(repo, "at-cap.md"), withWords(200));
    writeFileSync(path.join(repo, "over-cap.md"), withWords(201));
  });

  for (const command of ["gh pr create --body-file over-cap.md", "gh pr edit 1 --body-file over-cap.md", "timeout 60 gh pr edit 1 --body-file over-cap.md"]) {
    it(`denies 201 words: ${command}`, async () => {
      const r = await spawnHook("pr-body-guard.ts", command, repo);
      expect(r.exit).toBe(0);
      expect(r.output?.permissionDecision).toBe("deny");
      expect(r.output?.permissionDecisionReason).toContain('- "PR body" — body has 201 words; the limit is 200');
    });
  }

  for (const command of ["gh pr create --body-file at-cap.md", "gh pr edit 1 --body-file at-cap.md"]) {
    it(`allows 200 words: ${command}`, async () => {
      const r = await spawnHook("pr-body-guard.ts", command, repo);
      expect(r.exit).toBe(0);
      expect(r.stdout).toBe("");
    });
  }
});

describe("session link strip through wrappers, by path", () => {
  const TRAILER = "Claude-Session: https://claude.ai/code/session_abc";
  const updated = (stdout: string) => (stdout.trim() === "" ? null : (JSON.parse(stdout) as { hookSpecificOutput: { updatedInput: { command: string } } }).hookSpecificOutput.updatedInput.command);

  it("rewrites an inline body behind a wrapper at the right offset", async () => {
    const repo = makeRepo();
    const r = await spawnHook("session-link-strip.ts", `timeout 60 gh pr create --title t --body "One fact.\n\n${TRAILER}" --draft`, repo);
    const command = updated(r.stdout);
    expect(command).not.toContain("Claude-Session");
    expect(command).toStartWith(`timeout 60 gh pr create --title t --body "One fact.`);
    expect(command).toEndWith(`" --draft`);
  });

  it("leaves a body inside a re-parsed string untouched, because its offsets are not the command's", async () => {
    const repo = makeRepo();
    const r = await spawnHook("session-link-strip.ts", `bash -c 'gh pr create --body "One fact.\n\n${TRAILER}"'`, repo);
    expect(r.exit).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("does not rewrite an --input payload as text", async () => {
    const repo = makeRepo();
    const payload = JSON.stringify({ body: `One fact.\n\n${TRAILER}` });
    writeFileSync(path.join(repo, "p.json"), payload);
    const r = await spawnHook("session-link-strip.ts", "gh api -X PATCH repos/o/r/pulls/1 --input p.json", repo);
    expect(r.stdout).toBe("");
    expect(await Bun.file(path.join(repo, "p.json")).text()).toBe(payload);
  });
});
