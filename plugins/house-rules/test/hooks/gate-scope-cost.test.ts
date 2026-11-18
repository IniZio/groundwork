import { describe, it, expect, afterEach } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const BASE = "export function add(a: number, b: number): number {\n  return a + b;\n}\n";
const OVER_BUDGET = Array.from({ length: 20 }, (_, i) =>
  i % 5 === 0 ? `// reason ${i}` : `export const x${i} = ${i};`,
).join("\n") + "\n";

type Block =
  | { type: "tool_use"; id: string; name: string; input: object }
  | { type: "tool_result"; tool_use_id: string; content: string };
interface Entry { type: "assistant" | "user"; cwd: string; timestamp: string; message: { content: Block[] } }

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
}

/** A repo at dir holding src/a.ts, committed. */
function initRepo(dir: string): void {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "src/a.ts"), BASE);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
}

class Session {
  readonly root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hr-gate-cost-")));
  readonly repo = path.join(this.root, "repo");
  private entries: Entry[] = [];
  private seq = 0;

  constructor() {
    roots.push(this.root);
    initRepo(this.repo);
  }

  /** The agent edits file to an over-budget version through the Edit tool. */
  edit(file: string, cwd = this.repo): void {
    writeFileSync(file, BASE + OVER_BUDGET);
    const input = { file_path: file, old_string: BASE, new_string: BASE + OVER_BUDGET };
    this.entries.push({ type: "assistant", cwd, timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id: `e${this.seq++}`, name: "Edit", input }] } });
  }

  /** The agent runs a Bash command in cwd; the command really runs. */
  bash(command: string, cwd = this.repo): void {
    const id = `b${this.seq++}`;
    const start = new Date().toISOString();
    const r = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const end = new Date().toISOString();
    this.entries.push(
      { type: "assistant", cwd, timestamp: start, message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
      { type: "user", cwd, timestamp: end, message: { content: [{ type: "tool_result", tool_use_id: id, content: "" }] } },
    );
  }

  /** Runs the Stop gate with every git call logged; returns the autofix context and the logged git argument lines. */
  stop(): { context: string; gitCalls: string[] } {
    const tp = path.join(this.root, "s1.jsonl");
    writeFileSync(tp, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const shimDir = path.join(this.root, "shim");
    const log = path.join(this.root, "git-calls.log");
    mkdirSync(shimDir);
    writeFileSync(path.join(shimDir, "git"), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$HR_GIT_LOG"\nexec "$HR_REAL_GIT" "$@"\n');
    chmodSync(path.join(shimDir, "git"), 0o755);
    writeFileSync(log, "");
    const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: path.join(this.root, "tmp"),
      PATH: `${shimDir}:${process.env.PATH}`,
      HR_GIT_LOG: log,
      HR_REAL_GIT: realGit,
    };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    mkdirSync(env.TMPDIR!, { recursive: true });
    const payload = { hook_event_name: "Stop", session_id: "s1", transcript_path: tp, cwd: this.repo };
    const r = spawnSync("bun", [GATE], { cwd: this.repo, env, encoding: "utf8", input: JSON.stringify(payload) });
    expect(r.status, r.stderr).toBe(0);
    const out: { hookSpecificOutput?: { additionalContext?: string } } = r.stdout.trim() ? JSON.parse(r.stdout) : {};
    return { context: out.hookSpecificOutput?.additionalContext ?? "", gitCalls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
  }
}

describe("gate: a Stop with nested roots scans the work scope once", () => {
  it("fixes the outer repo and every nested repo while listing the outer repo's untracked files once", () => {
    const s = new Session();
    const nested = [1, 2, 3].map((i) => path.join(s.repo, "pkg", `n${i}`));
    for (const dir of nested) initRepo(dir);
    s.bash("ls");
    const targets = [path.join(s.repo, "src/a.ts"), ...nested.map((d) => path.join(d, "src/a.ts"))];
    for (const t of targets) s.edit(t);

    const { context, gitCalls } = s.stop();

    for (const t of targets) expect(context).toContain(`${t}: removed`);
    const outerScans = gitCalls.filter((l) => l.startsWith(`-C ${s.repo} ls-files --others`));
    expect(outerScans.length).toBe(1);
  });
});
