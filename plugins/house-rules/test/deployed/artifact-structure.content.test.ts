import { describe, it, expect, afterAll } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import rule from "../../rules/artifact-structure/index.js";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");

const pluginJson = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
};

const GUARD_CMD = pluginJson.hooks.PreToolUse.find((g) => g.matcher === "Edit|Write|MultiEdit")!.hooks[0].command;
const STOP_CMD = pluginJson.hooks.Stop[0].hooks[0].command;

const TEMPLATE = '---\ncreated: "{{created}}"\nstatus: active\n---\n\n# {{title}}\n\n## Overview\n';

const TYPED_CONFIG = {
  rules: {
    "artifact-structure": [
      "error",
      {
        govern: ["**/*.md"],
        types: {
          spec: {
            tier: "product",
            description: "Spec per area",
            generates: "doc/spec/{area:kebab}.md",
            template: TEMPLATE,
            frontmatter: {
              type: "object",
              required: ["created", "status"],
              properties: {
                created: { type: "string", format: "date" },
                status: { enum: ["active", "complete"] },
              },
            },
            headings: ["## Overview"],
          },
        },
      },
    ],
  },
};

const LEGACY_CONFIG = { rules: { "artifact-structure": ["error", { govern: ["**/*.md"] }] } };

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

function makeRepo(config: unknown = TYPED_CONFIG): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hr-artifact-content-"));
  roots.push(dir);
  git(dir, "init -q");
  git(dir, "config user.email t@example.com");
  git(dir, "config user.name t");
  writeFileSync(path.join(dir, ".house-rules.json"), JSON.stringify(config));
  writeFileSync(path.join(dir, "README.txt"), "x\n");
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
      session_id: `as-content-${process.pid}-${Date.now()}-${n++}`,
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
  if (!stdout.trim()) return undefined;
  const hso = (JSON.parse(stdout.trim()) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  return hso.permissionDecision as string | undefined;
}

function put(dir: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

const GOOD = '---\ncreated: "2026-09-29"\nstatus: active\n---\n\n# X\n\n## Overview\n\ntext\n';
const NO_STATUS = '---\ncreated: "2026-09-29"\n---\n\n# X\n\n## Overview\n';
const NO_OVERVIEW = '---\ncreated: "2026-09-29"\nstatus: active\n---\n\n# X\n\n## Other\n';

describe("artifact-structure content checks (deployed)", () => {
  it("AC4a: Stop blocks a new spec missing frontmatter key status, naming file and key", async () => {
    const control = makeRepo();
    put(control, "doc/spec/x.md", GOOD);
    expect((await stop(control)).decision).toBeUndefined();

    const dir = makeRepo();
    put(dir, "doc/spec/x.md", NO_STATUS);
    const out = await stop(dir);
    expect(out.decision).toBe("block");
    expect(out.full).toContain("doc/spec/x.md");
    expect(out.full).toContain("status");
  });

  it("AC4b: Stop blocks a new spec with valid frontmatter but missing heading ## Overview", async () => {
    const dir = makeRepo();
    put(dir, "doc/spec/x.md", NO_OVERVIEW);
    const out = await stop(dir);
    expect(out.decision).toBe("block");
    expect(out.full).toContain("doc/spec/x.md");
    expect(out.full).toContain("## Overview");
  });

  it("AC4c: a file scaffolded by `house-rules new` passes Stop", async () => {
    const dir = makeRepo();
    const res = await spawnArgv([path.join(PLUGIN_ROOT, "bin/house-rules"), "new", "spec", "area=foo-bar", "title=Foo Bar", "--repo", dir], undefined, dir);
    expect(res.stderr).toBe("");
    expect(res.exit).toBe(0);
    const rel = res.stdout.trim();
    expect(rel).toMatch(/^doc\/spec\/.+\.md$/);
    expect(readFileSync(path.join(dir, rel), "utf8")).toContain("## Overview");
    const out = await stop(dir);
    expect(out.decision).toBeUndefined();
  });

  it("AC5: a Bash-created spec with bad frontmatter is blocked at Stop", async () => {
    const dir = makeRepo();
    // Bash writes bypass the edit hook; the file only appears on disk.
    const cmd = `mkdir -p doc/spec && printf -- '---\\ncreated: nope\\nstatus: bogus\\n---\\n\\n## Overview\\n' > doc/spec/x.md`;
    await spawnArgv(["sh", "-c", cmd], undefined, dir);
    const out = await stop(dir, cmd);
    expect(out.decision).toBe("block");
    expect(out.full).toContain("doc/spec/x.md");
    expect(out.full).toMatch(/status|created/);
  });

  it("AC6: edit-time Write of incomplete frontmatter is allowed, same file on disk is blocked at Stop", async () => {
    const dir = makeRepo();
    // Positive control: the guard does deny a path outside every type.
    expect(await guardWrite(dir, "notes/stray.md", "# x\n")).toBe("deny");
    expect(await guardWrite(dir, "doc/spec/x.md", NO_STATUS)).toBeUndefined();
    put(dir, "doc/spec/x.md", NO_STATUS);
    const out = await stop(dir);
    expect(out.decision).toBe("block");
    expect(out.full).toContain("status");
  });

  it("Legacy: config without types does not content-check md files", async () => {
    const dir = makeRepo(LEGACY_CONFIG);
    put(dir, "doc/spec/x.md", "---\n: [junk\n---\n\nno headings\n");
    const out = await stop(dir);
    expect(out.decision).toBeUndefined();
  });

  it("AC7: Bun.YAML missing yields a visible finding, not a silent pass (in-process)", async () => {
    const dir = makeRepo();
    put(dir, "doc/spec/x.md", GOOD);
    const ctx = {
      repoRoot: dir,
      mode: "gate" as const,
      files: [{ path: "doc/spec/x.md", tracked: false, sessionCreated: true }],
    };
    // Positive control: with YAML present the same file is clean.
    expect(await rule.check(ctx)).toEqual([]);

    const bun = Bun as unknown as { YAML?: unknown };
    const saved = bun.YAML;
    try {
      bun.YAML = undefined;
      const findings = await rule.check(ctx);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].message).toContain("doc/spec/x.md");
      expect(findings[0].message).toContain("Bun.YAML");
    } finally {
      bun.YAML = saved;
    }
  });
});
