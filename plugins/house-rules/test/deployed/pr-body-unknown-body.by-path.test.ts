import { describe, it, expect, beforeAll } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeRepo } from "../hooks/commit-sandbox.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GOOD = "## Why\n\nOne fact.\n\n## Scope\n\nOne file.";
const BAD = "## Why\n\nOne fact; another fact.\n\n## Scope\n\nOne file.";
const BAD_REASON = "a semicolon joins clauses";

async function spawnGuard(command: string, cwd: string) {
  const { CLAUDE_PROJECT_DIR: _dir, CLAUDE_PLUGIN_ROOT: _root, ...env } = process.env;
  const proc = Bun.spawn(["bun", path.join(REPO, "src/hooks/pr-body-guard.ts")], { stdin: "pipe", stdout: "pipe", stderr: "pipe", cwd, env });
  proc.stdin.write(JSON.stringify({ session_id: "test", hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command } }));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  const output = stdout.trim() === "" ? null : (JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;
  return { stdout, exit, output };
}

const PREFIXES: Array<[string, string]> = [["direct", ""], ["timeout", "timeout 60 "]];
const HEREDOCS: Array<[string, (body: string) => string]> = [
  ["--body-file - quoted heredoc", (b) => `gh pr create --title t --body-file - <<'EOF'\n${b}\nEOF`],
  ["-F - quoted heredoc", (b) => `gh pr edit 1 -F - <<'EOF'\n${b}\nEOF`],
  ["--body-file - unquoted heredoc", (b) => `gh pr create --body-file - <<EOF\n${b}\nEOF`],
  ["--body-file - double-quoted delimiter", (b) => `gh pr create --body-file - <<"EOF"\n${b}\nEOF`],
  ["--body-file - tab-stripped heredoc", (b) => `gh pr create --body-file - <<-EOF\n\t${b.replaceAll("\n", "\n\t")}\n\tEOF`],
  ["inline $(cat <<EOF)", (b) => `gh pr create --title t --body "$(cat <<'EOF'\n${b}\nEOF\n)"`],
  ["gh api -F body=@-", (b) => `gh api -X PATCH repos/o/r/pulls/1 -F body=@- <<'EOF'\n${b}\nEOF`],
];
const UNKNOWN: Array<[string, string]> = [
  ['--body "$F"', 'gh pr create --title t --body "$F"'],
  ["--body $B", "gh pr create --title t --body $B"],
  ['--body "$(cat f)"', 'gh pr create --title t --body "$(cat f)"'],
  ['--body="$F"', 'gh pr create --title t --body="$F"'],
  ['-b "`cat f`"', 'gh pr edit 1 -b "`cat f`"'],
  ['--body "text; $F"', 'gh pr create --body "One fact; $F"'],
  ['gh api -f body="$F"', 'gh api -X PATCH repos/o/r/pulls/1 -f body="$F"'],
  ["an unquoted heredoc with an expansion", 'gh pr create --body-file - <<EOF\n$(cat f)\nEOF'],
  ['an inline unquoted heredoc with an expansion', 'gh pr create --body "$(cat <<EOF\n$F\nEOF\n)"'],
];

describe("pr-body guard reads what it can know, by path", () => {
  let repo: string;

  beforeAll(() => {
    repo = makeRepo({ rules: { "pr-body": "error" } });
    writeFileSync(path.join(repo, "f"), `${BAD}\n`);
  });

  for (const [prefix, launcher] of PREFIXES) {
    for (const [name, build] of HEREDOCS) {
      it(`${prefix}: ${name} allows a good body and denies a bad one`, async () => {
        const good = await spawnGuard(launcher + build(GOOD), repo);
        expect(good.exit).toBe(0);
        expect(good.stdout).toBe("");
        const bad = await spawnGuard(launcher + build(BAD), repo);
        expect(bad.exit).toBe(0);
        expect(bad.output?.permissionDecision).toBe("deny");
        expect(bad.output?.permissionDecisionReason).toContain(BAD_REASON);
      });
    }

    for (const [name, command] of UNKNOWN) {
      it(`${prefix}: ${name} is skipped because the body is unknown`, async () => {
        const r = await spawnGuard(launcher + command, repo);
        expect(r.exit).toBe(0);
        expect(r.stdout).toBe("");
      });
    }
  }

  it("a quoted heredoc keeps $ as text, so its bad prose is still denied", async () => {
    const r = await spawnGuard(`gh pr create --body-file - <<'EOF'\n${BAD}\n\nThe cost is $F.\nEOF`, repo);
    expect(r.output?.permissionDecisionReason).toContain(BAD_REASON);
  });

  it("an escaped dollar in a quoted body is text, so its bad prose is still denied", async () => {
    const r = await spawnGuard('gh pr create --body "One fact costs \\$5; another fact."', repo);
    expect(r.output?.permissionDecisionReason).toContain(BAD_REASON);
  });

  it("a literal inline body stays checked, quoted or not", async () => {
    expect((await spawnGuard(`gh pr create --body "${BAD}"`, repo)).output?.permissionDecisionReason).toContain(BAD_REASON);
    expect((await spawnGuard(`gh pr create --body '${BAD}'`, repo)).output?.permissionDecisionReason).toContain(BAD_REASON);
    expect((await spawnGuard(`gh pr create --body "${GOOD}"`, repo)).stdout).toBe("");
  });

  it("a heredoc inside bash -c is read too", async () => {
    expect((await spawnGuard(`bash -c 'gh pr create -F - <<EOF\n${GOOD}\nEOF'`, repo)).stdout).toBe("");
    expect((await spawnGuard(`bash -c 'gh pr create -F - <<EOF\n${BAD}\nEOF'`, repo)).output?.permissionDecisionReason).toContain(BAD_REASON);
  });

  it("an --input heredoc with a good payload is allowed", async () => {
    expect((await spawnGuard(`gh api -X PATCH repos/o/r/pulls/1 --input - <<'EOF'\n${JSON.stringify({ body: GOOD })}\nEOF`, repo)).stdout).toBe("");
  });
});
