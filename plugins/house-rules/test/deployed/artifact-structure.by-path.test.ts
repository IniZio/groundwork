import { describe, it, expect, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");

const pluginJson = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
};

const GUARD_CMD = pluginJson.hooks.PreToolUse.find((g) => g.matcher === "Edit|Write|MultiEdit")!.hooks[0].command;
const STOP_CMD = pluginJson.hooks.Stop[0].hooks[0].command;

const CONFIG = {
  rules: {
    "artifact-structure": [
      "error",
      {
        govern: ["**/*.md"],
        types: {
          research: {
            tier: "working",
            description: "Research notes for a motive",
            generates: ".groundwork/work/{slug}/research/{name:kebab}.md",
          },
          "living-spec": {
            tier: "product",
            description: "Living spec per area",
            generates: "doc/spec/{area:kebab}.md",
          },
        },
        forbidden: [{ pattern: "**/adr/**", redirect: "Record decisions with $GW event append --type DECISION" }],
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

function makeRepo(gitignore?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hr-artifact-structure-"));
  roots.push(dir);
  git(dir, "init -q");
  git(dir, "config user.email t@example.com");
  git(dir, "config user.name t");
  writeFileSync(path.join(dir, ".house-rules.json"), JSON.stringify(CONFIG));
  if (gitignore) writeFileSync(path.join(dir, ".gitignore"), gitignore);
  writeFileSync(path.join(dir, "README.txt"), "x\n");
  git(dir, "add -A");
  // Backdated so the commit predates the transcript's first timestamp (session base).
  const past = new Date(Date.now() - 3600_000).toISOString();
  git(dir, 'commit -q -m init', { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
  return dir;
}

async function spawnByCommand(
  rawCmd: string,
  payload: unknown,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(["sh", "-c", rawCmd.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...ENV_BASE, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, GIT_CONFIG_GLOBAL: "/dev/null" },
    cwd,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exit: await proc.exited };
}

interface GuardOut { permissionDecision?: string; reason: string }

async function guard(dir: string, tool: "Write" | "Edit", input: Record<string, unknown>): Promise<GuardOut> {
  const { stdout, exit } = await spawnByCommand(GUARD_CMD, { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }, dir);
  expect(exit).toBe(0);
  if (!stdout.trim()) return { reason: "" };
  const hso = (JSON.parse(stdout.trim()) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  return {
    permissionDecision: hso.permissionDecision as string | undefined,
    reason: `${hso.additionalContext ?? ""}${hso.permissionDecisionReason ?? ""}`,
  };
}

const writeNew = (dir: string, rel: string) =>
  guard(dir, "Write", { file_path: path.join(dir, rel), content: "# note\n\nbody\n" });

describe("artifact-structure deployed by-path", () => {
  it("AC1: Write of new notes/research-notes.md is denied with nearest types and <slug> paths", async () => {
    const dir = makeRepo();
    const out = await writeNew(dir, "notes/research-notes.md");
    expect(out.permissionDecision).toBe("deny");
    expect(out.reason).toContain("artifact-structure");
    const typeLines = out.reason.split("\n").filter((l) => l.startsWith("- "));
    expect(typeLines.length).toBeGreaterThanOrEqual(1);
    expect(typeLines.length).toBeLessThanOrEqual(2);
    const research = typeLines.find((l) => l.includes("research"));
    expect(research).toBeDefined();
    expect(research).toContain("Research notes for a motive");
    expect(research).toContain(".groundwork/work/<slug>/research/research-notes.md");
    for (const l of typeLines) expect(l).toContain("->");
  });

  it("AC2: Write of docs/adr/0001-x.md is denied with the forbidden redirect verbatim", async () => {
    const dir = makeRepo();
    const out = await writeNew(dir, "docs/adr/0001-x.md");
    expect(out.permissionDecision).toBe("deny");
    expect(out.reason).toContain("Record decisions with $GW event append --type DECISION");
  });

  describe("AC3 controls (no deny)", () => {
    it("AC3: path matching a type is allowed (and the deny is observable in the same repo)", async () => {
      const dir = makeRepo();
      expect((await writeNew(dir, "notes/research-notes.md")).permissionDecision).toBe("deny");
      expect((await writeNew(dir, "doc/spec/foo-bar.md")).permissionDecision).toBeUndefined();
    });

    it("AC3: non-governed src/a.ts is allowed", async () => {
      const dir = makeRepo();
      expect((await writeNew(dir, "notes/research-notes.md")).permissionDecision).toBe("deny");
      expect((await writeNew(dir, "src/a.ts")).permissionDecision).toBeUndefined();
    });

    it("AC3: Edit of an existing tracked non-conforming .md is allowed", async () => {
      const dir = makeRepo();
      mkdirSync(path.join(dir, "notes"));
      writeFileSync(path.join(dir, "notes/old.md"), "# old\n\nline\n");
      git(dir, "add -A");
      git(dir, "commit -q -m add-old");
      expect((await writeNew(dir, "notes/fresh.md")).permissionDecision).toBe("deny");
      const out = await guard(dir, "Edit", {
        file_path: path.join(dir, "notes/old.md"),
        old_string: "line",
        new_string: "line two",
      });
      expect(out.permissionDecision).toBeUndefined();
    });

    it("AC3: gitignored path is allowed", async () => {
      const dir = makeRepo("ignored/\n");
      expect((await writeNew(dir, "notes/research-notes.md")).permissionDecision).toBe("deny");
      expect((await writeNew(dir, "ignored/x.md")).permissionDecision).toBeUndefined();
    });
  });

  describe("AC5 gate on Bash-created untracked docs", () => {
    // Session start = timestamp of the first transcript entry; files older than it are not session work.
    const SESSION_START_MS = Date.now() - 30_000;
    let n = 0;

    function transcript(dir: string): string {
      const first = new Date(SESSION_START_MS).toISOString();
      const lines = [
        { type: "user", timestamp: first, message: { role: "user", content: "make a file" } },
        {
          type: "assistant",
          timestamp: new Date(SESSION_START_MS + 1000).toISOString(),
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo x > stray.md" } }],
          },
        },
      ];
      const p = path.join(dir, "..", `${path.basename(dir)}-transcript.jsonl`);
      writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return p;
    }

    async function stop(dir: string) {
      const stdout = (
        await spawnByCommand(
          STOP_CMD,
          {
            hook_event_name: "Stop",
            session_id: `as-by-path-${process.pid}-${Date.now()}-${n++}`,
            transcript_path: transcript(dir),
            cwd: dir,
            stop_hook_active: false,
          },
          dir,
        )
      ).stdout.trim();
      return stdout ? (JSON.parse(stdout) as { decision?: string; reason?: string }) : {};
    }

    it("AC5: untracked stray.md created after session start blocks, naming file and nearest type", async () => {
      const dir = makeRepo();
      writeFileSync(path.join(dir, "stray.md"), "x\n");
      const out = await stop(dir);
      expect(out.decision).toBe("block");
      expect(out.reason).toContain("artifact-structure");
      expect(out.reason).toContain("stray.md");
      const blockFile = out.reason!.match(/\S+stop-block\.txt/)?.[0];
      expect(blockFile).toBeDefined();
      const full = readFileSync(blockFile!, "utf8");
      expect(full).toMatch(/research|living-spec/);
    });

    it("AC5: same stray.md gitignored passes (positive control blocks)", async () => {
      const blocked = makeRepo();
      writeFileSync(path.join(blocked, "stray.md"), "x\n");
      expect((await stop(blocked)).decision).toBe("block");

      const dir = makeRepo("stray.md\n");
      writeFileSync(path.join(dir, "stray.md"), "x\n");
      expect((await stop(dir)).decision).toBeUndefined();
    });

    it("AC5: untracked stray.md older than session start passes (positive control blocks)", async () => {
      const blocked = makeRepo();
      writeFileSync(path.join(blocked, "stray.md"), "x\n");
      expect((await stop(blocked)).decision).toBe("block");

      const dir = makeRepo();
      const f = path.join(dir, "stray.md");
      writeFileSync(f, "x\n");
      const old = new Date(SESSION_START_MS - 86_400_000);
      utimesSync(f, old, old);
      expect((await stop(dir)).decision).toBeUndefined();
    });
  });
});
