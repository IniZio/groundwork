import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";
import { isBashSearch } from "../../src/hooks/search-nudge.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/search-nudge.ts");

function scratchDir(): string {
  const d = path.join(os.tmpdir(), `search-nudge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function run(
  payload: unknown,
  env: Record<string, string> = {},
): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    cwd: ROOT,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

function makeInput(
  toolName: string,
  cmd: string | null,
  scratchpad: string,
  sessionId = "sess1",
  promptId = "prompt1",
  agentType?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    tool_name: toolName,
    session_id: sessionId,
    prompt_id: promptId,
    scratchpad_dir: scratchpad,
  };
  if (agentType !== undefined) base.agent_type = agentType;
  if (cmd !== null) base.tool_input = { command: cmd };
  return base;
}

function parseNudge(stdout: string): string | null {
  if (!stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    return parsed.hookSpecificOutput.additionalContext;
  } catch {
    return null;
  }
}

describe("isBashSearch — unit", () => {
  it("grep as primary → true", () => {
    expect(isBashSearch("grep foo src/")).toBe(true);
  });
  it("rg as primary → true", () => {
    expect(isBashSearch("rg foo src/")).toBe(true);
  });
  it("find as primary → true", () => {
    expect(isBashSearch("find . -name '*.ts'")).toBe(true);
  });
  it("ag as primary → true", () => {
    expect(isBashSearch("ag foo src/")).toBe(true);
  });
  it("git grep as primary → true", () => {
    expect(isBashSearch("git grep pattern")).toBe(true);
  });
  it("ls | grep foo (pipeline filter) → false", () => {
    expect(isBashSearch("ls | grep foo")).toBe(false);
  });
  it("cmd | rg filter → false", () => {
    expect(isBashSearch("cat file.txt | rg pattern")).toBe(false);
  });
  it("echo 'grep foo' (in single quotes) → false", () => {
    expect(isBashSearch("echo 'grep foo'")).toBe(false);
  });
  it("echo \"grep foo\" (in double quotes) → false", () => {
    expect(isBashSearch('echo "grep foo"')).toBe(false);
  });
  it("ls then grep (semicolon) → true", () => {
    expect(isBashSearch("ls; grep foo src/")).toBe(true);
  });
});

describe("search-nudge hook — main thread counter", () => {
  it("first search: silent", () => {
    const dir = scratchDir();
    const { stdout } = run(makeInput("Grep", null, dir));
    expect(stdout).toBe("");
  });

  it("second search: silent", () => {
    const dir = scratchDir();
    run(makeInput("Grep", null, dir));
    const { stdout } = run(makeInput("Grep", null, dir));
    expect(stdout).toBe("");
  });

  it("third search: emits nudge line + allows (exit 0)", () => {
    const dir = scratchDir();
    run(makeInput("Grep", null, dir));
    run(makeInput("Grep", null, dir));
    const { stdout, exit } = run(makeInput("Grep", null, dir));
    expect(exit).toBe(0);
    const nudge = parseNudge(stdout);
    expect(nudge).not.toBeNull();
    expect(nudge).toContain("3 code searches");
    expect(nudge).toContain("groundwork:explore");
  });

  it("nudge token length ≤20 tokens (~80 chars)", () => {
    const dir = scratchDir();
    run(makeInput("Grep", null, dir));
    run(makeInput("Grep", null, dir));
    const { stdout } = run(makeInput("Grep", null, dir));
    const nudge = parseNudge(stdout);
    expect(nudge).not.toBeNull();
    expect((nudge ?? "").length).toBeLessThanOrEqual(80);
  });

  it("fourth search: silent (nudge fires exactly once)", () => {
    const dir = scratchDir();
    for (let i = 0; i < 3; i++) run(makeInput("Grep", null, dir));
    const { stdout } = run(makeInput("Grep", null, dir));
    expect(stdout).toBe("");
  });

  it("new prompt_id resets counter", () => {
    const dir = scratchDir();
    run(makeInput("Grep", null, dir, "sess1", "p1"));
    run(makeInput("Grep", null, dir, "sess1", "p1"));
    run(makeInput("Grep", null, dir, "sess1", "p1"));
    const { stdout } = run(makeInput("Grep", null, dir, "sess1", "p2"));
    expect(stdout).toBe("");
  });

  it("Glob tool counted as code search", () => {
    const dir = scratchDir();
    run(makeInput("Glob", null, dir));
    run(makeInput("Glob", null, dir));
    const { stdout } = run(makeInput("Glob", null, dir));
    const nudge = parseNudge(stdout);
    expect(nudge).not.toBeNull();
  });

  it("Bash rg command counted as code search", () => {
    const dir = scratchDir();
    run(makeInput("Bash", "rg foo src/", dir));
    run(makeInput("Bash", "rg foo src/", dir));
    const { stdout } = run(makeInput("Bash", "rg foo src/", dir));
    expect(parseNudge(stdout)).not.toBeNull();
  });

  it("Bash pipeline filter not counted", () => {
    const dir = scratchDir();
    for (let i = 0; i < 5; i++) {
      const { stdout } = run(makeInput("Bash", "ls | grep foo", dir));
      expect(stdout).toBe("");
    }
  });

  it("non-search Bash not counted", () => {
    const dir = scratchDir();
    for (let i = 0; i < 5; i++) {
      const { stdout } = run(makeInput("Bash", "bun test", dir));
      expect(stdout).toBe("");
    }
  });
});

describe("search-nudge hook — subagent silent", () => {
  it("agent_type set → silent even on 3rd search", () => {
    const dir = scratchDir();
    for (let i = 0; i < 3; i++) {
      const { stdout } = run(makeInput("Grep", null, dir, "sess2", "p1", "groundwork:implementer"));
      expect(stdout, `expected silence on call ${i + 1} for subagent`).toBe("");
    }
  });
});

describe("search-nudge hook — kill switch", () => {
  it("GW_SEARCH_NUDGE_DISABLE=1 suppresses all output", () => {
    const dir = scratchDir();
    for (let i = 0; i < 3; i++) {
      const { stdout } = run(makeInput("Grep", null, dir), { GW_SEARCH_NUDGE_DISABLE: "1" });
      expect(stdout).toBe("");
    }
  });
});

describe("search-nudge hook — embedded agent silent", () => {
  it("sdk-py embedded → silent", () => {
    const dir = scratchDir();
    for (let i = 0; i < 3; i++) {
      const { stdout } = run(makeInput("Grep", null, dir), { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
      expect(stdout).toBe("");
    }
  });
});
