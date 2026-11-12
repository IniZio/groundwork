import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const AUTOFIX_LINE = "house-rules comment-density: auto-removed";
const BASE = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const OVER_BUDGET = Array.from({ length: 20 }, (_, i) =>
  i % 5 === 0 ? `// reason ${i}` : `export const x${i} = ${i};`,
).join("\n") + "\n";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "protocol.file.allow=always", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
}

function setup(kind: "plain" | "submodule") {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hr-gate-submodule-")));
  roots.push(root);
  const upstream = path.join(root, "upstream");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  writeFileSync(path.join(upstream, "a.ts"), BASE);
  git(upstream, "add", "-A");
  git(upstream, "commit", "-qm", "init");
  if (kind === "plain") return { root, project: upstream, fileDir: upstream, entries: [] as Record<string, unknown>[] };
  const project = path.join(root, "super");
  mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  writeFileSync(path.join(project, "README.md"), "x\n");
  git(project, "submodule", "add", "-q", upstream, "repo/sub");
  git(project, "commit", "-qm", "init");
  return { root, project, fileDir: path.join(project, "repo/sub"), entries: [] as Record<string, unknown>[] };
}

type Fixture = ReturnType<typeof setup>;

function edit(fx: Fixture, file: string): void {
  const input = { file_path: file, old_string: BASE, new_string: BASE + OVER_BUDGET };
  writeFileSync(file, BASE + OVER_BUDGET);
  fx.entries.push({ type: "assistant", cwd: fx.project, timestamp: new Date().toISOString(),
    message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input }] } });
}

function bash(fx: Fixture, command: string): void {
  const start = new Date().toISOString();
  const r = spawnSync("bash", ["-c", command], { cwd: fx.project, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const end = new Date().toISOString();
  fx.entries.push(
    { type: "assistant", cwd: fx.project, timestamp: start,
      message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command } }] } },
    { type: "user", cwd: fx.project, timestamp: end,
      message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "" }] } },
  );
}

function stopGate(fx: Fixture) {
  const tp = path.join(fx.root, "s1.jsonl");
  writeFileSync(tp, fx.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const env = { ...process.env, TMPDIR: path.join(fx.root, "tmp") } as Record<string, string>;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  mkdirSync(env.TMPDIR, { recursive: true });
  const payload = { hook_event_name: "Stop", session_id: "s1", transcript_path: tp, cwd: fx.project };
  const r = spawnSync("bun", [GATE], { cwd: fx.project, env, encoding: "utf8", input: JSON.stringify(payload) });
  const out: { hookSpecificOutput?: { additionalContext?: string } } = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  return { r, context: out.hookSpecificOutput?.additionalContext ?? "" };
}

function commentCount(file: string): number {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim().startsWith("//")).length;
}

describe("gate: comment density holds for files inside a git submodule", () => {
  it("plain repo: an over-budget Edit to a tracked file is autofixed", () => {
    const fx = setup("plain");
    const target = path.join(fx.fileDir, "a.ts");
    edit(fx, target);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(`${target}: removed`);
    expect(commentCount(target)).toBeLessThan(4);
  });

  it("superproject cwd: an over-budget Edit to a tracked submodule file is autofixed", () => {
    const fx = setup("submodule");
    const target = path.join(fx.fileDir, "a.ts");
    edit(fx, target);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(AUTOFIX_LINE);
    expect(context).toContain(`${target}: removed`);
    expect(commentCount(target)).toBeLessThan(4);
  });

  it("superproject cwd: a Bash write to a tracked submodule file is autofixed", () => {
    const fx = setup("submodule");
    const target = path.join(fx.fileDir, "a.ts");
    bash(fx, `python3 -c 'import sys; open("repo/sub/a.ts", "a").write(sys.stdin.read())' <<'E'\n${OVER_BUDGET}E`);
    expect(commentCount(target)).toBe(4);

    const { r, context } = stopGate(fx);

    expect(r.status).toBe(0);
    expect(context).toContain(`${target}: removed`);
    expect(commentCount(target)).toBeLessThan(4);
  });
});
