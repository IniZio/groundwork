import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { check, DEPTH_ALLOWLIST } from "../../src/hooks/spawn-model-guard.js";

const HOOK = new URL("../../src/hooks/spawn-model-guard.ts", import.meta.url).pathname;

function spawnHook(payload: unknown): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_SUBAGENT_TYPE: undefined as unknown as string },
  });
  return { stdout: r.stdout ?? "", exit: r.status ?? 1 };
}

function spawnDecision(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch { return `parse-error(${s.slice(0, 60)})`; }
}

function spawnReason(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason ?? "";
  } catch { return ""; }
}

function agent(subagent_type: string, caller?: string, model?: string) {
  return {
    tool_name: "Agent",
    tool_input: { subagent_type, ...(model ? { model } : {}) },
    ...(caller ? { agent_type: caller, agent_id: "abc123" } : {}),
  };
}

function decision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

function reason(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason ?? "";
  } catch { return ""; }
}

describe("depth-guard (T20)", () => {
  it("DENY: implementer → implementer", () => {
    const r = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(r)).toBe("deny");
    const msg = reason(r);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("ALLOW: implementer → explore", () => {
    const r = check(agent("groundwork:explore", "groundwork:implementer"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: implementer → junior-orchestrator", () => {
    const r = check(agent("groundwork:junior-orchestrator", "groundwork:implementer"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: junior → orchestrator", () => {
    const r = check(agent("groundwork:orchestrator", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: junior → junior-orchestrator", () => {
    const r = check(agent("groundwork:junior-orchestrator", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("ALLOW: junior → implementer", () => {
    const r = check(agent("groundwork:implementer", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: junior → explore", () => {
    const r = check(agent("groundwork:explore", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: junior → advisor", () => {
    const r = check(agent("groundwork:advisor", "groundwork:junior-orchestrator"));
    expect(decision(r)).toBe("deny");
  });

  it("ALLOW: main thread → any agent (no agent_type)", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:implementer" } });
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: main thread → junior-orchestrator", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:junior-orchestrator" } });
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: foreign plugin caller → any agent", () => {
    const r = check(agent("groundwork:implementer", "other-plugin:worker"));
    expect(decision(r)).toBe("allow");
  });

  it("ALLOW: foreign plugin caller → orchestrator", () => {
    const r = check(agent("groundwork:orchestrator", "acme:planner"));
    expect(decision(r)).toBe("allow");
  });

  it("DENY: explore → anything", () => {
    const r = check(agent("groundwork:explore", "groundwork:explore"));
    expect(decision(r)).toBe("deny");
  });

  it("DENY: git-master → anything", () => {
    const r = check(agent("groundwork:explore", "groundwork:git-master"));
    expect(decision(r)).toBe("deny");
  });

  it("deny reason names caller, target, allowed list", () => {
    const r = check(agent("groundwork:implementer", "groundwork:implementer"));
    const msg = reason(r);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("deny reason for explore names 'none' allowed", () => {
    const r = check(agent("groundwork:implementer", "groundwork:explore"));
    const msg = reason(r);
    expect(msg).toContain("none");
  });
});

describe("by-path (entrypoint) — spawn bun src/hooks/spawn-model-guard.ts", () => {
  it("DENY by-path: implementer → implementer (exit 0, JSON deny, reason names both)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
      agent_type: "groundwork:implementer",
      agent_id: "abc123",
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("deny");
    const msg = spawnReason(r.stdout);
    expect(msg).toContain("groundwork:implementer");
    expect(msg).toContain("groundwork:explore");
  });

  it("ALLOW by-path: junior → implementer (exit 0, empty stdout)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
      agent_type: "groundwork:junior-orchestrator",
      agent_id: "abc123",
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("allow");
  });

  it("ALLOW by-path: main thread (no agent_type) → implementer (exit 0, empty or inject)", () => {
    const payload = {
      tool_name: "Agent",
      tool_input: { subagent_type: "groundwork:implementer" },
    };
    const r = spawnHook(payload);
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("allow");
  });
});

describe("F2 — omitted subagent_type normalises to general-purpose", () => {
  it("DENY by-path: main thread, subagent_type omitted → deny naming groundwork:implementer (exit 0)", () => {
    const r = spawnHook({ tool_name: "Agent", tool_input: {} });
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("deny");
    expect(spawnReason(r.stdout)).toContain("groundwork:implementer");
  });

  it("DENY by-path: implementer, subagent_type omitted → deny (exit 0)", () => {
    const r = spawnHook({ tool_name: "Agent", tool_input: {}, agent_type: "groundwork:implementer", agent_id: "x" });
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("deny");
  });

  it("DENY by-path: subagent_type empty string → deny (exit 0)", () => {
    const r = spawnHook({ tool_name: "Agent", tool_input: { subagent_type: "" } });
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("deny");
  });

  it("ALLOW by-path: implementer, explicit groundwork:explore → still allowed (exit 0)", () => {
    const r = spawnHook({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:explore" }, agent_type: "groundwork:implementer", agent_id: "x" });
    expect(r.exit).toBe(0);
    expect(spawnDecision(r.stdout)).toBe("allow");
  });
});

describe("F2 — bite proof: omitted-field sensitivity", () => {
  it("omitted subagent_type → deny (unit)", () => {
    const r = check({ tool_name: "Agent", tool_input: {} });
    expect(decision(r)).toBe("deny");
    expect(reason(r)).toContain("groundwork:implementer");
  });

  it("empty string subagent_type → deny (unit)", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "" } });
    expect(decision(r)).toBe("deny");
  });

  it("implementer + omitted subagent_type → deny (unit)", () => {
    const r = check({ tool_name: "Agent", tool_input: {}, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("deny");
  });

  it("implementer + explicit groundwork:explore → allow (unit)", () => {
    const r = check({ tool_name: "Agent", tool_input: { subagent_type: "groundwork:explore" }, agent_type: "groundwork:implementer" });
    expect(decision(r)).toBe("allow");
  });
});

describe("bite proof — depth-guard sensitivity", () => {
  it("widening implementer allowlist defeats the deny", () => {
    const beforeWiden = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(beforeWiden)).toBe("deny");

    const implementerSet = DEPTH_ALLOWLIST.get("groundwork:implementer") as Set<string>;
    implementerSet.add("groundwork:implementer");

    const afterWiden = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(afterWiden)).toBe("allow");

    implementerSet.delete("groundwork:implementer");

    const afterRestore = check(agent("groundwork:implementer", "groundwork:implementer"));
    expect(decision(afterRestore)).toBe("deny");
  });
});

const CLI = new URL("../../src/cli/main.ts", import.meta.url).pathname;

function makeDb(files: string[]): { dir: string } {
  const d = mkdtempSync(path.join(tmpdir(), "gw-guard-"));
  const r = spawnSync("bun", [CLI, "init"], { cwd: d, encoding: "utf8", env: process.env as Record<string, string> });
  const m = r.stdout.match(/token: (\S+)/);
  if (!m) throw new Error(`init no token: ${r.stdout} ${r.stderr}`);
  const tok = m[1];
  const filesFlag = files.join(",");
  spawnSync("bun", [CLI, "slice", "add", "S-guard-1", "--files", filesFlag, "--token", tok],
    { cwd: d, encoding: "utf8", env: process.env as Record<string, string> });
  return { dir: d };
}

describe("S1 file-count routing guard", () => {
  it("DENY: orchestrator spawns implementer with SLICE pointing to ≥3-file slice", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("deny");
      expect(reason(r)).toContain("size-guard");
      expect(reason(r)).toContain("S-guard-1");
      expect(reason(r)).toContain("groundwork:junior-orchestrator");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW: junior-orchestrator spawns implementer with ≥3-file SLICE (legitimate fan-out)", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:junior-orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:junior-orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW: SLICE id mid-prompt (first line not SLICE) — no size-guard trigger", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "Do the work.\nSLICE: S-guard-1\nMore context.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW: implementer with SLICE pointing to ≤2-file slice", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW (fail-open): no SLICE line in prompt", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "No slice header here.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW (fail-open): no CLAUDE_PROJECT_DIR", () => {
    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: {
        subagent_type: "groundwork:implementer",
        prompt: "SLICE: S-guard-1\nDo the work.",
      },
      agent_type: "groundwork:orchestrator",
      agent_id: "abc",
    };
    const saved = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      const r = check(payload, "groundwork:orchestrator", undefined);
      expect(decision(r)).toBe("allow");
    } finally {
      if (saved !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = saved;
      }
    }
  });

  it("DENY via CLAUDE_PROJECT_DIR env when projectDir arg is absent", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    const saved = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = d;
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      // projectDir arg omitted — guard must fall back to CLAUDE_PROJECT_DIR
      const r = check(payload, "groundwork:orchestrator", undefined);
      expect(decision(r)).toBe("deny");
      expect(reason(r)).toContain("size-guard");
    } finally {
      if (saved !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = saved;
      } else {
        delete process.env.CLAUDE_PROJECT_DIR;
      }
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("T1 ALLOW: orchestrator → junior-orchestrator with SLICE (size-guard skips non-implementer)", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:junior-orchestrator",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("T2 DENY main-thread: no agent_type, implementer, 3-file SLICE → deny", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
      };
      const r = check(payload, undefined, d);
      expect(decision(r)).toBe("deny");
      expect(reason(r)).toContain("size-guard");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("T3 ALLOW (fail-open): projDir empty string does not open relative .groundwork/work.db", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    const origCwd = process.cwd();
    const savedEnv = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    try {
      process.chdir(d);
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", "");
      expect(decision(r)).toBe("allow");
    } finally {
      process.chdir(origCwd);
      if (savedEnv !== undefined) {
        process.env.CLAUDE_PROJECT_DIR = savedEnv;
      }
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("T4 deployed path: main-thread implementer 3-file SLICE → deny via CLAUDE_PROJECT_DIR", () => {
    const { dir: d } = makeDb(["a.ts", "b.ts", "c.ts"]);
    try {
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: S-guard-1\nDo the work.",
        },
      };
      const env: Record<string, string> = { ...process.env as Record<string, string>, CLAUDE_PROJECT_DIR: d };
      delete env.CLAUDE_SUBAGENT_TYPE;
      const r = Bun.spawnSync(["bun", HOOK], {
        stdin: Buffer.from(JSON.stringify(payload)),
        env,
      });
      const stdout = Buffer.from(r.stdout).toString("utf8");
      expect(spawnDecision(stdout)).toBe("deny");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("ALLOW (fail-open): pre-v7 DB without files column", () => {
    const { Database } = require("bun:sqlite");
    const d = mkdtempSync(path.join(tmpdir(), "gw-guard-v6-"));
    try {
      const gwDir = path.join(d, ".groundwork");
      require("node:fs").mkdirSync(gwDir, { recursive: true });
      const db = new Database(path.join(gwDir, "work.db"));
      db.exec("CREATE TABLE slices (id TEXT PRIMARY KEY, status TEXT)");
      db.exec("INSERT INTO slices VALUES ('big', 'ready')");
      db.close();
      const payload = {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: {
          subagent_type: "groundwork:implementer",
          prompt: "SLICE: big\nDo the work.",
        },
        agent_type: "groundwork:orchestrator",
        agent_id: "abc",
      };
      const r = check(payload, "groundwork:orchestrator", d);
      expect(decision(r)).toBe("allow");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
