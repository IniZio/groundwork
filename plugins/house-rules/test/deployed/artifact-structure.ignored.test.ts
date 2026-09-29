import { describe, it, expect, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");

const pluginJson = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
};

const GUARD_CMD = pluginJson.hooks.PreToolUse.find((g) => g.matcher === "Edit|Write|MultiEdit")!.hooks[0].command;
const STOP_CMD = pluginJson.hooks.Stop[0].hooks[0].command;

const SCRATCH_REDIRECT = "REDIRECT-SCRATCH put working notes under doc/notes";
const ADR_REDIRECT = "REDIRECT-ADR record decisions with gw event append";

const CONFIG = {
  rules: {
    "artifact-structure": [
      "error",
      {
        govern: ["**/*.md"],
        forbidden: [
          { pattern: ".scratch/**", redirect: SCRATCH_REDIRECT },
          { pattern: "**/adr/**", redirect: ADR_REDIRECT },
        ],
        types: {
          spec: {
            tier: "working",
            description: "Work unit spec",
            generates: ".groundwork/work/{name:kebab}/spec.md",
            template: "---\nfolds_into: x\n---\n",
            frontmatter: { type: "object", required: ["folds_into"] },
          },
          motive: {
            tier: "working",
            description: "Work unit motive",
            generates: ".groundwork/work/{name:kebab}/motive.md",
            template: '---\ncreated: "2026-09-29"\n---\n',
            frontmatter: { type: "object", required: ["created"] },
          },
        },
      },
    ],
  },
};

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

function makeRepo(config: unknown = CONFIG): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hr-artifact-ignored-"));
  roots.push(dir);
  git(dir, "init -q");
  git(dir, "config user.email t@example.com");
  git(dir, "config user.name t");
  writeFileSync(path.join(dir, ".house-rules.json"), JSON.stringify(config));
  writeFileSync(path.join(dir, "README.txt"), "x\n");
  writeFileSync(path.join(dir, ".gitignore"), ".scratch/\ninternal/\ndist/\n");
  appendFileSync(path.join(dir, ".git/info/exclude"), ".groundwork/\n");
  git(dir, "add -A");
  // Backdated so the commit predates the transcript's first timestamp (session base).
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

let n = 0;
const SESSION_START_MS = Date.now() - 30_000;

function transcript(dir: string, bashCommand: string): string {
  const lines = [
    { type: "user", timestamp: new Date(SESSION_START_MS).toISOString(), message: { role: "user", content: "make a file" } },
    {
      type: "assistant",
      timestamp: new Date(SESSION_START_MS + 1000).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: bashCommand } }],
      },
    },
  ];
  const p = path.join(dir, "..", `${path.basename(dir)}-transcript.jsonl`);
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

async function stop(dir: string, bashCommand = "echo x") {
  const { stdout, stderr } = await spawnByCommand(
    STOP_CMD,
    {
      hook_event_name: "Stop",
      session_id: `as-ignored-${process.pid}-${Date.now()}-${n++}`,
      transcript_path: transcript(dir, bashCommand),
      cwd: dir,
      stop_hook_active: false,
    },
    dir,
  );
  const out = stdout.trim() ? (JSON.parse(stdout.trim()) as { decision?: string; reason?: string }) : {};
  // The reason may only point at a stop-block file holding the full text.
  const blockFile = out.reason?.match(/\S+stop-block\.txt/)?.[0];
  const full = `${out.reason ?? ""}\n${blockFile ? readFileSync(blockFile, "utf8") : ""}\n${stderr}`;
  return { ...out, full };
}

async function guardWrite(dir: string, rel: string, content: string) {
  const { stdout, exit } = await spawnByCommand(
    GUARD_CMD,
    { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(dir, rel), content } },
    dir,
  );
  expect(exit).toBe(0);
  if (!stdout.trim()) return { decision: undefined, reason: "" };
  const hso = (JSON.parse(stdout.trim()) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  return { decision: hso.permissionDecision as string | undefined, reason: String(hso.additionalContext ?? "") };
}

function put(dir: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

describe("artifact-structure ignored paths (deployed)", () => {
  it("AC1: guard denies Write to gitignored .scratch/ and internal/adr/ with the matching redirect", async () => {
    const dir = makeRepo();
    const a = await guardWrite(dir, ".scratch/f/spec.md", "# x\n");
    expect(a.decision).toBe("deny");
    expect(a.reason).toContain("REDIRECT-SCRATCH");
    const b = await guardWrite(dir, "internal/adr/0001-x.md", "# x\n");
    expect(b.decision).toBe("deny");
    expect(b.reason).toContain("REDIRECT-ADR");
  });

  it("AC2: Stop blocks a new ignored .groundwork spec lacking folds_into, and passes once valid", async () => {
    const dir = makeRepo();
    put(dir, ".groundwork/work/foo/spec.md", "---\ntitle: x\n---\n\n# x\n");
    const out = await stop(dir);
    expect(out.decision).toBe("block");
    expect(out.full).toContain("folds_into");

    const ok = makeRepo();
    put(ok, ".groundwork/work/foo/spec.md", "---\nfolds_into: doc/spec/x.md\n---\n\n# x\n");
    expect((await stop(ok)).decision).toBeUndefined();
  });

  it("AC3: Stop blocks a Bash-created ignored motive.md missing created", async () => {
    const dir = makeRepo();
    const cmd = `mkdir -p .groundwork/work/foo && printf -- '---\\ntitle: x\\n---\\n' > .groundwork/work/foo/motive.md`;
    await spawnArgv(["sh", "-c", cmd], undefined, dir);
    const out = await stop(dir, cmd);
    expect(out.decision).toBe("block");
    expect(out.full).toContain(".groundwork/work/foo/motive.md");
    expect(out.full).toContain("created");
  });

  it("AC4: ignored unmatched governed file and ignored non-governed file are not flagged by guard or Stop", async () => {
    const dir = makeRepo();
    // Positive control: a non-ignored stray governed md is flagged, so the checks can see a finding.
    expect((await guardWrite(dir, "notes/stray.md", "# x\n")).decision).toBe("deny");

    expect((await guardWrite(dir, "dist/notes.md", "# x\n")).decision).toBeUndefined();
    expect((await guardWrite(dir, "dist/x.txt", "x\n")).decision).toBeUndefined();
    put(dir, "dist/notes.md", "# x\n");
    put(dir, "dist/x.txt", "x\n");
    const out = await stop(dir);
    expect(out.decision).toBeUndefined();
  });

  it("AC5: a file tracked in HEAD then modified stays exempt from content checks at Stop", async () => {
    const dir = makeRepo();
    put(dir, "doc/spec/keep.md", "# tracked\n");
    put(dir, ".groundwork/work/foo/spec.md", "---\nfolds_into: y\n---\n");
    git(dir, "add -f doc/spec/keep.md .groundwork/work/foo/spec.md");
    const past = new Date(Date.now() - 3600_000).toISOString();
    git(dir, "commit -q -m add", { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
    put(dir, ".groundwork/work/foo/spec.md", "---\ntitle: no fold\n---\n");
    expect((await stop(dir)).decision).toBeUndefined();
  });
});
