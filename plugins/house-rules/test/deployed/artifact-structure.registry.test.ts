import { describe, it, expect, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");

const pluginJson = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
};

const GUARD_CMD = pluginJson.hooks.PreToolUse.find((g) => g.matcher === "Edit|Write|MultiEdit")!.hooks[0].command;
const STOP_CMD = pluginJson.hooks.Stop[0].hooks[0].command;

const ENV_BASE = (() => {
  const e = { ...process.env } as Record<string, string>;
  delete e.CLAUDE_PROJECT_DIR;
  return e;
})();

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function git(cwd: string, cmd: string, env: Record<string, string> = {}): void {
  execSync(`git ${cmd}`, { cwd, stdio: "ignore", env: { ...ENV_BASE, GIT_CONFIG_GLOBAL: "/dev/null", ...env } });
}

function makeRepo(opts: { groundwork: boolean }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hr-artifact-registry-"));
  roots.push(dir);
  git(dir, "init -q");
  git(dir, "config user.email t@example.com");
  git(dir, "config user.name t");
  writeFileSync(path.join(dir, "README.txt"), "x\n");
  if (opts.groundwork) {
    mkdirSync(path.join(dir, ".groundwork"), { recursive: true });
    writeFileSync(path.join(dir, ".groundwork/.keep"), "");
  }
  git(dir, "add -A");
  const past = new Date(Date.now() - 3600_000).toISOString();
  git(dir, "commit -q -m init", { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
  return dir;
}

async function spawnArgv(argv: string[], stdin: unknown, cwd: string) {
  const proc = Bun.spawn(argv, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...ENV_BASE, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, GIT_CONFIG_GLOBAL: "/dev/null" },
    cwd,
  });
  if (stdin !== undefined) proc.stdin.write(JSON.stringify(stdin));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exit: await proc.exited };
}

const spawnByCommand = (rawCmd: string, payload: unknown, cwd: string) =>
  spawnArgv(["sh", "-c", rawCmd.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)], payload, cwd);

/** Writes the `gw recipe` output (artifact-structure at "error") as .house-rules.json. */
async function addRecipeConfig(dir: string): Promise<void> {
  const res = await spawnArgv(["bun", path.join(REPO_ROOT, "src/cli/main.ts"), "recipe"], undefined, dir);
  expect(res.exit).toBe(0);
  const cfg = JSON.parse(res.stdout) as { rules: Record<string, unknown[]> };
  expect(cfg.rules["artifact-structure"][0]).toBe("error");
  writeFileSync(path.join(dir, ".house-rules.json"), res.stdout);
}

let n = 0;
const SESSION_START_MS = Date.now() - 30_000;

function transcript(dir: string): string {
  const lines = [
    { type: "user", timestamp: new Date(SESSION_START_MS).toISOString(), message: { role: "user", content: "make a file" } },
    {
      type: "assistant",
      timestamp: new Date(SESSION_START_MS + 1000).toISOString(),
      message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo x" } }] },
    },
  ];
  const p = path.join(dir, "..", `${path.basename(dir)}-transcript.jsonl`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

async function stop(dir: string) {
  const { stdout, stderr, exit } = await spawnByCommand(
    STOP_CMD,
    {
      hook_event_name: "Stop",
      session_id: `as-registry-${process.pid}-${Date.now()}-${n++}`,
      transcript_path: transcript(dir),
      cwd: dir,
      stop_hook_active: false,
    },
    dir,
  );
  const out = stdout.trim()
    ? (JSON.parse(stdout.trim()) as { decision?: string; reason?: string; systemMessage?: string })
    : {};
  const blockFile = out.reason?.match(/\S+stop-block\.txt/)?.[0];
  const full = [out.reason ?? "", blockFile ? readFileSync(blockFile, "utf8") : "", out.systemMessage ?? "", stderr].join("\n");
  return { ...out, exit, full, lines: full.split("\n") };
}

async function guardWrite(dir: string, rel: string, content: string) {
  const { stdout, stderr, exit } = await spawnByCommand(
    GUARD_CMD,
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(dir, rel), content } },
    dir,
  );
  const hso = stdout.trim()
    ? ((JSON.parse(stdout.trim()) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {})
    : {};
  const full = `${String(hso.additionalContext ?? "")}\n${stderr}`;
  return { exit, decision: hso.permissionDecision as string | undefined, full };
}

function put(dir: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

const ISSUE = ".groundwork/work/x/tickets/01-y.md";
const TODO_NO_AC = "---\ntitle: Y\nstatus: todo\n---\n\n# Y\n\n## Notes\n";
const TRIAGE_NO_AC = "---\ntitle: Y\nstatus: triage\n---\n\n# Y\n\n## Notes\n";
const MISSING_AC = 'missing required heading "Acceptance criteria"';

describe("artifact-structure registry fallback (deployed)", () => {
  it("warns about a todo issue missing Acceptance criteria without blocking", async () => {
    const dir = makeRepo({ groundwork: true });
    put(dir, ISSUE, TODO_NO_AC);
    const out = await stop(dir);
    expect(out.exit).toBe(0);
    expect(out.decision).not.toBe("block");
    const line = out.lines.find((l) => l.includes("issue") && l.includes("Acceptance criteria"));
    expect(line).toBeDefined();
    expect(line).toContain(ISSUE);
    expect(line).toContain(MISSING_AC);
  });

  it("raises no artifact-structure finding for a triage issue", async () => {
    const dir = makeRepo({ groundwork: true });
    put(dir, ISSUE, TRIAGE_NO_AC);
    const out = await stop(dir);
    expect(out.exit).toBe(0);
    expect(out.decision).not.toBe("block");
    expect(out.full).not.toContain("artifact-structure");
    // Positive twin: the todo variant of the same repo shape does produce the finding.
    const twin = makeRepo({ groundwork: true });
    put(twin, ISSUE, TODO_NO_AC);
    expect((await stop(twin)).full).toContain("artifact-structure");
  });

  it("blocks the same todo issue when gw recipe sets artifact-structure to error", async () => {
    const dir = makeRepo({ groundwork: true });
    await addRecipeConfig(dir);
    git(dir, "add -A");
    const past = new Date(Date.now() - 3500_000).toISOString();
    git(dir, "commit -q -m cfg", { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
    put(dir, ISSUE, TODO_NO_AC);
    const out = await stop(dir);
    expect(out.decision).toBe("block");
    expect(out.full).toContain(ISSUE);
    expect(out.full).toContain(MISSING_AC);
  });

  it("ignores lessons/x.md without .groundwork, flags it with .groundwork", async () => {
    const plain = makeRepo({ groundwork: false });
    put(plain, "lessons/x.md", "# lesson\n");
    const none = await stop(plain);
    expect(none.exit).toBe(0);
    expect(none.full).not.toContain("artifact-structure");
    expect(none.full).not.toContain("lessons/x.md");

    const gw = makeRepo({ groundwork: true });
    put(gw, "lessons/x.md", "# lesson\n");
    const out = await stop(gw);
    expect(out.exit).toBe(0);
    expect(out.decision).not.toBe("block");
    expect(out.full).toContain("artifact-structure");
    expect(out.full).toContain("lessons/x.md");
  });

  it("lets a Write to .scratch/foo.md through with a warning, denies it under gw recipe config", async () => {
    const dir = makeRepo({ groundwork: true });
    const res = await guardWrite(dir, ".scratch/foo.md", "# s\n");
    expect(res.exit).toBe(0);
    expect(res.decision).not.toBe("deny");
    expect(res.full).toContain(".scratch");

    const strict = makeRepo({ groundwork: true });
    await addRecipeConfig(strict);
    const denied = await guardWrite(strict, ".scratch/foo.md", "# s\n");
    expect(denied.exit).toBe(0);
    expect(denied.decision).toBe("deny");
    expect(denied.full).toContain(".scratch");
  });
});
