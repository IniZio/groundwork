import { describe, it, expect, afterEach } from "bun:test";
import { run, escalationNudge, escalateStateFile } from "../../src/hooks/stop-gate.js";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

describe("stop-gate — escalation nudge", () => {
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const d = mkdtempSync(path.join(os.tmpdir(), "gw-escalate-"));
    tmpDirs.push(d);
    return d;
  }

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop()!;
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("no nudge for empty background_tasks", () => {
    const tmpDir = makeTmp();
    const result = escalationNudge(
      { session_id: "s1", background_tasks: [] },
      { CLAUDE_PROJECT_DIR: tmpDir },
      null
    );
    expect(result).toBeNull();
  });

  it("no nudge for non-implementer agent type", () => {
    const tmpDir = makeTmp();
    const result = escalationNudge(
      {
        session_id: "s2",
        background_tasks: [
          { id: "task-2", type: "subagent", status: "running", description: "advisor task", agent_type: "groundwork:advisor" },
        ],
      },
      { CLAUDE_PROJECT_DIR: tmpDir },
      null
    );
    expect(result).toBeNull();
  });

  it("no nudge for completed implementer", () => {
    const tmpDir = makeTmp();
    const result = escalationNudge(
      {
        session_id: "s3",
        background_tasks: [
          { id: "task-3", type: "subagent", status: "complete", description: "done task", agent_type: "groundwork:implementer" },
        ],
      },
      { CLAUDE_PROJECT_DIR: tmpDir },
      null
    );
    expect(result).toBeNull();
  });

  it("no nudge for implementer below threshold", () => {
    const tmpDir = makeTmp();
    const inp = {
      session_id: "s4",
      background_tasks: [
        { id: "task-4", type: "subagent", status: "running", description: "short task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const stateFilePath = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "task-4": new Date(Date.now() - 5 * 60 * 1000).toISOString() },
        nudged: [],
      })
    );
    const result = escalationNudge(inp, env, null);
    expect(result).toBeNull();
  });

  it("nudge fires for implementer over threshold", () => {
    const tmpDir = makeTmp();
    const inp = {
      session_id: "s5",
      background_tasks: [
        { id: "task-1", type: "subagent", status: "running", description: "My task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const stateFilePath = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "task-1": new Date(Date.now() - 16 * 60 * 1000).toISOString() },
        nudged: [],
      })
    );
    const result = escalationNudge(inp, env, null);
    expect(result).not.toBeNull();
    expect(result).toContain("implementer-escalation");
    const containsId = result!.includes("task-1") || result!.includes("My task");
    expect(containsId).toBe(true);
    expect(result).toContain("min");
    expect(result).toContain("groundwork:junior-orchestrator");
  });

  it("nudge records first-seen on first call (below threshold)", () => {
    const tmpDir = makeTmp();
    const inp = {
      session_id: "s6",
      background_tasks: [
        { id: "new-task", type: "subagent", status: "running", description: "brand new task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const result = escalationNudge(inp, env, null);
    expect(result).toBeNull();
    const stateFilePath = escalateStateFile(inp, env, null);
    const state = JSON.parse(readFileSync(stateFilePath, "utf8"));
    expect(state.firstSeen["new-task"]).toBeDefined();
  });

  it("no repeat nudge for same task", () => {
    const tmpDir = makeTmp();
    const inp = {
      session_id: "s7",
      background_tasks: [
        { id: "task-1", type: "subagent", status: "running", description: "repeat task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const stateFilePath = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "task-1": new Date(Date.now() - 16 * 60 * 1000).toISOString() },
        nudged: ["task-1"],
      })
    );
    const result = escalationNudge(inp, env, null);
    expect(result).toBeNull();
  });

  it("run() includes hookSpecificOutput.additionalContext when nudge fires", async () => {
    const tmpDir = makeTmp();
    mkdirSync(path.join(tmpDir, ".groundwork"), { recursive: true });
    const inp = {
      session_id: "s8",
      background_tasks: [
        { id: "imp-1", type: "subagent", status: "running", description: "Impl task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const stateFilePath = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "imp-1": new Date(Date.now() - 16 * 60 * 1000).toISOString() },
        nudged: [],
      })
    );
    const result = await run(inp, env);
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput?.additionalContext).toContain("implementer-escalation");
    expect(out.hookSpecificOutput?.hookEventName).toBe("Stop");
  });

  it("CLI spawn: hook adds nudge to stdout when implementer over threshold", () => {
    const tmpDir = makeTmp();
    mkdirSync(path.join(tmpDir, ".groundwork"), { recursive: true });
    const stateFilePath = path.join(tmpDir, ".groundwork", "stop-gate.s9.escalate.json");
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "cli-imp-1": new Date(Date.now() - 16 * 60 * 1000).toISOString() },
        nudged: [],
      })
    );
    const hookPath = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");
    const inp = JSON.stringify({
      session_id: "s9",
      background_tasks: [
        { id: "cli-imp-1", type: "subagent", status: "running", description: "CLI impl", agent_type: "groundwork:implementer" },
      ],
    });
    const spawnResult = spawnSync("bun", ["run", hookPath], {
      input: inp,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
      encoding: "utf8",
    });
    const out = JSON.parse(spawnResult.stdout);
    expect(out.hookSpecificOutput?.additionalContext).toContain("implementer-escalation");
  });

  it("BITE-PROOF: without escalation nudge logic, over-threshold implementer test goes red", () => {
    const tmpDir = makeTmp();
    const inp = {
      session_id: "s10",
      background_tasks: [
        { id: "bite-task", type: "subagent", status: "running", description: "bite proof task", agent_type: "groundwork:implementer" },
      ],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    const stateFilePath = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(
      stateFilePath,
      JSON.stringify({
        firstSeen: { "bite-task": new Date(Date.now() - 16 * 60 * 1000).toISOString() },
        nudged: [],
      })
    );
    const result = escalationNudge(inp, env, null);
    expect(result).not.toBeNull();
  });
});
