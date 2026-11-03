import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const SLACK_GAP_MS = 1500;
const AUTOFIX_LINE = "house-rules comment-density: auto-removed";

const OVER_BUDGET = Array.from({ length: 20 }, (_, i) =>
  i % 5 === 0 ? `// reason ${i}` : `export const x${i} = ${i};`,
).join("\n") + "\n";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" });
}

function setup() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hr-bash-interp-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "src/mcp.ts"), "export const a = 1;\n");
  writeFileSync(path.join(repo, "src/other.ts"), "export const o = 1;\n");
  writeFileSync(path.join(repo, "src/late.ts"), "export const l = 1;\n");
  writeFileSync(path.join(repo, "src/heredoc.ts"), "export const h = 1;\n");
  writeFileSync(path.join(repo, "src/sed.ts"), "export const s = 1;\n");
  writeFileSync(path.join(repo, "src/redir.ts"), "export const r = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  return { root, repo, entries: [] as Record<string, unknown>[] };
}

type Fixture = ReturnType<typeof setup>;

function bash(fx: Fixture, cwd: string, command: string): void {
  const id = `tu${fx.entries.length}`;
  const start = new Date().toISOString();
  const r = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const end = new Date().toISOString();
  fx.entries.push(
    { type: "assistant", cwd, timestamp: start,
      message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
    { type: "user", cwd, timestamp: end,
      message: { content: [{ type: "tool_result", tool_use_id: id, content: "" }] } },
  );
}

function writeTranscript(file: string, entries: Record<string, unknown>[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function runGate(fx: Fixture, payload: Record<string, unknown>) {
  const env = { ...process.env, TMPDIR: path.join(fx.root, "tmp") } as Record<string, string>;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(env.TMPDIR, { recursive: true });
  const r = spawnSync("bun", [GATE], { cwd: fx.repo, env, encoding: "utf8", input: JSON.stringify(payload) });
  const out: { hookSpecificOutput?: { additionalContext?: string } } = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  return { r, context: out.hookSpecificOutput?.additionalContext ?? "" };
}

function stopGate(fx: Fixture) {
  const tp = path.join(fx.root, "s1.jsonl");
  writeTranscript(tp, fx.entries);
  return runGate(fx, { hook_event_name: "Stop", session_id: "s1", transcript_path: tp, cwd: fx.repo });
}

function pythonWrite(rel: string, mode: "append" | "create"): string {
  const body = mode === "append" ? "s = open(p).read()\ns += C\n" : "s = C\n";
  return [
    `python3 - <<'E'`,
    `p = ${JSON.stringify(rel)}`,
    `C = ${JSON.stringify(OVER_BUDGET)}`,
    body.trimEnd(),
    `open(p, 'w').write(s)`,
    `E`,
  ].join("\n");
}

function commentCount(text: string): number {
  return text.split("\n").filter((l) => l.trim().startsWith("//")).length;
}

describe("gate: Bash interpreter writes are attributed from git, not command text", () => {
  it("python heredoc edit of a tracked file over budget is autofixed (#935 shape)", () => {
    const fx = setup();
    bash(fx, fx.root, `cd ${fx.repo}/src && ${pythonWrite("mcp.ts", "append")}`);
    const target = path.join(fx.repo, "src/mcp.ts");
    expect(commentCount(readFileSync(target, "utf8"))).toBe(4);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(AUTOFIX_LINE);
    expect(context).toContain(`${target}: removed`);
    expect(commentCount(readFileSync(target, "utf8"))).toBeLessThan(4);
  });

  it("python-created untracked file over budget is gated with every line added", () => {
    const fx = setup();
    bash(fx, fx.repo, pythonWrite("src/fresh.ts", "create"));
    const target = path.join(fx.repo, "src/fresh.ts");
    expect(git(fx.repo, "ls-files", "--error-unmatch", "src/fresh.ts").status).not.toBe(0);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(AUTOFIX_LINE);
    expect(context).toContain(`${target}: removed`);
    expect(context).toContain("20 added lines");
  });

  it("a file changed in the same repo outside every Bash window is not attributed", () => {
    const fx = setup();
    const other = path.join(fx.repo, "src/other.ts");
    const late = path.join(fx.repo, "src/late.ts");
    writeFileSync(other, OVER_BUDGET);
    Bun.sleepSync(SLACK_GAP_MS);
    bash(fx, fx.repo, pythonWrite("src/mcp.ts", "append"));
    Bun.sleepSync(SLACK_GAP_MS);
    writeFileSync(late, OVER_BUDGET);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(`${path.join(fx.repo, "src/mcp.ts")}: removed`);
    expect(context).not.toContain(other);
    expect(context).not.toContain(late);
    expect(readFileSync(other, "utf8")).toBe(OVER_BUDGET);
    expect(readFileSync(late, "utf8")).toBe(OVER_BUDGET);
  }, 20000);

  it("cat >, sed -i and >> redirect writes to tracked files are still gated", () => {
    const fx = setup();
    const lines = OVER_BUDGET.trimEnd().split("\n");
    bash(fx, fx.repo, `cat > src/heredoc.ts <<'EOF'\n${OVER_BUDGET}EOF`);
    const sedText = Array.from({ length: 20 }, (_, i) => (i % 5 === 0 ? `//r${i}` : `x${i}=${i};`)).join("\\n");
    bash(fx, fx.repo, `sed -i '1i${sedText}' src/sed.ts`);
    bash(fx, fx.repo, lines.map((l) => `echo ${JSON.stringify(l)} >> src/redir.ts`).join("\n"));

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(AUTOFIX_LINE);
    for (const f of ["heredoc.ts", "sed.ts", "redir.ts"]) {
      expect(context).toContain(`${path.join(fx.repo, "src", f)}: removed`);
    }
  });

  it("SubagentStop does not take a sibling agent's in-window Edit as its own", () => {
    const fx = setup();
    const sibling = path.join(fx.repo, "src/other.ts");
    const subDir = path.join(fx.root, "s1", "subagents");
    bash(fx, fx.repo, `${pythonWrite("src/mcp.ts", "append")}\nsleep 0.3`);
    writeFileSync(sibling, OVER_BUDGET);
    const last = fx.entries[fx.entries.length - 1];
    last.timestamp = new Date().toISOString();
    const agentTp = path.join(subDir, "agent-aaa.jsonl");
    writeTranscript(agentTp, fx.entries);
    writeTranscript(path.join(subDir, "agent-bbb.jsonl"), [
      { type: "assistant", cwd: fx.repo, timestamp: new Date().toISOString(),
        message: { content: [{ type: "tool_use", id: "e1", name: "Edit",
          input: { file_path: sibling, old_string: "x", new_string: "y" } }] } },
    ]);
    const mainTp = path.join(fx.root, "s1.jsonl");
    writeTranscript(mainTp, []);

    const { r, context } = runGate(fx, {
      hook_event_name: "SubagentStop", session_id: "s1", agent_id: "aaa",
      transcript_path: mainTp, agent_transcript_path: agentTp, cwd: fx.repo,
    });

    expect(r.status).toBe(0);
    expect(context).toContain(`${path.join(fx.repo, "src/mcp.ts")}: removed`);
    expect(context).not.toContain(sibling);
    expect(readFileSync(sibling, "utf8")).toBe(OVER_BUDGET);
  });
});
