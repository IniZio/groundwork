import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { run, escalationNudge, escalateStateFile } from "../../src/hooks/stop-gate.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOOK_PATH = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");

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
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  function preWriteState(stateFile: string, taskId: string, minutesAgo: number, alreadyNudged = false) {
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      firstSeen: { [taskId]: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString() },
      nudged: alreadyNudged ? [taskId] : [],
    }));
  }

  it("no nudge for empty background_tasks", () => {
    const tmpDir = makeTmp();
    const inp = { hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s1", background_tasks: [] };
    expect(escalationNudge(inp, { CLAUDE_PROJECT_DIR: tmpDir }, null)).toBeNull();
  });

  it("no nudge for non-implementer agent type", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s2",
      background_tasks: [{ id: "t2", type: "subagent", status: "running", description: "adv", agent_type: "groundwork:advisor" }],
    };
    expect(escalationNudge(inp, { CLAUDE_PROJECT_DIR: tmpDir }, null)).toBeNull();
  });

  it("no nudge for completed implementer", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s3",
      background_tasks: [{ id: "t3", type: "subagent", status: "complete", description: "done", agent_type: "groundwork:implementer" }],
    };
    expect(escalationNudge(inp, { CLAUDE_PROJECT_DIR: tmpDir }, null)).toBeNull();
  });

  it("no nudge for implementer below threshold", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s4",
      background_tasks: [{ id: "t4", type: "subagent", status: "running", description: "short", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    preWriteState(escalateStateFile(inp, env, null), "t4", 5);
    expect(escalationNudge(inp, env, null)).toBeNull();
  });

  it("nudge fires for implementer over threshold", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s5",
      background_tasks: [{ id: "task-1", type: "subagent", status: "running", description: "My task", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    preWriteState(escalateStateFile(inp, env, null), "task-1", 16);
    const result = escalationNudge(inp, env, null);
    expect(result).not.toBeNull();
    expect(result).toContain("implementer-escalation");
    expect(result!.includes("task-1") || result!.includes("My task")).toBe(true);
    expect(result).toContain("min");
    expect(result).toContain("groundwork:junior-orchestrator");
  });

  it("nudge records first-seen on first call (below threshold)", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s6",
      background_tasks: [{ id: "new-task", type: "subagent", status: "running", description: "fresh", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    expect(escalationNudge(inp, env, null)).toBeNull();
    const state = JSON.parse(readFileSync(escalateStateFile(inp, env, null), "utf8")) as { firstSeen: Record<string, string> };
    expect(state.firstSeen["new-task"]).toBeDefined();
  });

  it("no repeat nudge for same task", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s7",
      background_tasks: [{ id: "task-1", type: "subagent", status: "running", description: "repeat", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    preWriteState(escalateStateFile(inp, env, null), "task-1", 16, true);
    expect(escalationNudge(inp, env, null)).toBeNull();
  });

  it("run() includes hookSpecificOutput.additionalContext when nudge fires (no-db path)", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "s8",
      background_tasks: [{ id: "imp-1", type: "subagent", status: "running", description: "Impl", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    preWriteState(escalateStateFile(inp, env, null), "imp-1", 16);
    const result = run(inp, env);
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    const hs = out.hookSpecificOutput as Record<string, unknown> | undefined;
    expect(hs?.hookEventName).toBe("Stop");
    expect(String(hs?.additionalContext)).toContain("implementer-escalation");
  });

  // M2-PROOF: nudge fires once; second call suppressed; state.nudged updated.
  // Under M2 (nudged.push removed): second call re-fires → expect(out2.hookSpecificOutput).toBeUndefined() FAILS.
  it("M2-PROOF: nudge fires on first CLI call, suppressed on second; state.nudged contains id", () => {
    const tmpDir = makeTmp();
    mkdirSync(path.join(tmpDir, ".groundwork"), { recursive: true });
    const sessionId = "m2-sess";
    const taskId = "m2-task";
    const stateFile = path.join(tmpDir, ".groundwork", `stop-gate.${sessionId}.escalate.json`);
    preWriteState(stateFile, taskId, 16);

    const inpJson = JSON.stringify({
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: sessionId,
      background_tasks: [{ id: taskId, type: "subagent", status: "running", description: "M2 impl", agent_type: "groundwork:implementer" }],
    });

    const r1 = spawnSync("bun", ["run", HOOK_PATH], {
      input: inpJson, env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }, encoding: "utf8",
    });
    const out1 = JSON.parse(r1.stdout) as Record<string, unknown>;
    expect(String((out1.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext))
      .toContain("implementer-escalation");

    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { nudged: string[] };
    expect(state.nudged).toContain(taskId);

    const r2 = spawnSync("bun", ["run", HOOK_PATH], {
      input: inpJson, env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }, encoding: "utf8",
    });
    const out2 = JSON.parse(r2.stdout) as Record<string, unknown>;
    expect(out2.hookSpecificOutput).toBeUndefined();
  });

  // M7-PROOF: nudge fires through the store-present (GROUNDWORK_DB) path.
  // Under M7 (escalationNudge at line 633 disabled): hookSpecificOutput absent → test FAILS.
  it("M7-PROOF: nudge fires through store-present path with real GROUNDWORK_DB", () => {
    const tmpDir = makeTmp();
    const dbPath = path.join(tmpDir, "work.db");
    const db = new Database(dbPath);
    runMigrations(db, MIGRATIONS);
    db.close();

    const sessionId = "m7-sess";
    const taskId = "m7-task";
    const stateFile = path.join(tmpDir, `stop-gate.${sessionId}.escalate.json`);
    preWriteState(stateFile, taskId, 16);

    const inpJson = JSON.stringify({
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: sessionId,
      background_tasks: [{ id: taskId, type: "subagent", status: "running", description: "M7 impl", agent_type: "groundwork:implementer" }],
    });

    const r = spawnSync("bun", ["run", HOOK_PATH], {
      input: inpJson, env: { ...process.env, GROUNDWORK_DB: dbPath }, encoding: "utf8",
    });
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    const hs = out.hookSpecificOutput as Record<string, unknown> | undefined;
    expect(hs).toBeDefined();
    expect(String(hs?.additionalContext)).toContain("implementer-escalation");
  });

  // Fail-open: nudge appended even when store read errors (catch path).
  it("fail-open: nudge appended when store read errors", () => {
    const tmpDir = makeTmp();
    const corruptDb = path.join(tmpDir, "corrupt.db");
    writeFileSync(corruptDb, "not valid sqlite");

    const sessionId = "fo-sess";
    const taskId = "fo-task";
    // inp.cwd = tmpDir → escalationNudge(inp, env, null) looks in tmpDir/.groundwork/
    const stateFile = path.join(tmpDir, ".groundwork", `stop-gate.${sessionId}.escalate.json`);
    preWriteState(stateFile, taskId, 16);

    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: sessionId,
      background_tasks: [{ id: taskId, type: "subagent", status: "running", description: "Fail-open", agent_type: "groundwork:implementer" }],
    };
    const result = run(inp, { GROUNDWORK_DB: corruptDb });
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    const hs = out.hookSpecificOutput as Record<string, unknown> | undefined;
    expect(hs).toBeDefined();
    expect(String(hs?.additionalContext)).toContain("implementer-escalation");
  });

  it("CLI spawn: hook adds nudge to stdout when implementer over threshold", () => {
    const tmpDir = makeTmp();
    mkdirSync(path.join(tmpDir, ".groundwork"), { recursive: true });
    const sessionId = "s9";
    const stateFile = path.join(tmpDir, ".groundwork", `stop-gate.${sessionId}.escalate.json`);
    preWriteState(stateFile, "cli-imp-1", 16);

    const r = spawnSync("bun", ["run", HOOK_PATH], {
      input: JSON.stringify({
        hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: sessionId,
        background_tasks: [{ id: "cli-imp-1", type: "subagent", status: "running", description: "CLI impl", agent_type: "groundwork:implementer" }],
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }, encoding: "utf8",
    });
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(String((out.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext))
      .toContain("implementer-escalation");
  });

  it("BITE-PROOF: over-threshold implementer result is not null", () => {
    const tmpDir = makeTmp();
    const inp = {
      hook_event_name: "Stop", cwd: tmpDir, stop_hook_active: false, session_id: "bite",
      background_tasks: [{ id: "bite-task", type: "subagent", status: "running", description: "bite", agent_type: "groundwork:implementer" }],
    };
    const env = { CLAUDE_PROJECT_DIR: tmpDir };
    preWriteState(escalateStateFile(inp, env, null), "bite-task", 16);
    const result = escalationNudge(inp, env, null);
    expect(result).not.toBeNull();
    expect(result).toContain("implementer-escalation");
  });
});

const MIN = 60_000;

describe("stop-gate — escalation clock across resume", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) {
      try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  function setup(sessionId: string, taskId: string, lines: unknown[] | null) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gw-esc-resume-"));
    tmpDirs.push(tmp);
    const transcript = path.join(tmp, `${sessionId}.jsonl`);
    writeFileSync(transcript, "");
    if (lines) {
      const dir = path.join(tmp, sessionId, "subagents");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `agent-${taskId}.jsonl`), lines.map(l => JSON.stringify(l)).join("\n") + "\n");
    }
    const stop = (running: boolean) => {
      const r = spawnSync("bun", ["run", HOOK_PATH], {
        input: JSON.stringify({
          hook_event_name: "Stop", cwd: tmp, stop_hook_active: false, session_id: sessionId, transcript_path: transcript,
          background_tasks: running
            ? [{ id: taskId, type: "subagent", status: "running", description: "impl", agent_type: "groundwork:implementer" }]
            : [],
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp }, encoding: "utf8",
      });
      const out = JSON.parse(r.stdout) as Record<string, unknown>;
      const hs = out.hookSpecificOutput as Record<string, unknown> | undefined;
      return hs ? String(hs.additionalContext) : null;
    };
    return { tmp, stop };
  }

  const iso = (minAgo: number) => new Date(Date.now() - minAgo * MIN).toISOString();
  const userStr = (minAgo: number) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: "go" } });
  const toolResult = (minAgo: number) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
  const assistant = (minAgo: number) => ({ type: "assistant", timestamp: iso(minAgo), message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });

  const meta = (minAgo: number, text: string) => ({ type: "user", isMeta: true, timestamp: iso(minAgo), message: { role: "user", content: [{ type: "text", text }] } });
  const toolUse = (minAgo: number, id: string, name: string) => ({ type: "assistant", timestamp: iso(minAgo), message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] } });
  const resultFor = (minAgo: number, id: string) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
  const COORD = "The coordinator sent a message while you were working: continue";

  it("(a) resumed run 2m old does not nudge despite 24m since spawn", () => {
    const { tmp, stop } = setup("sa", "ta", [userStr(24), assistant(23), toolUse(22.5, "h1", "SubagentHandback"), resultFor(22, "h1"), meta(2, COORD)]);
    const stateFile = path.join(tmp, ".groundwork", "stop-gate.sa.escalate.json");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ firstSeen: { ta: iso(24) }, nudged: [] }));
    expect(stop(true)).toBeNull();
  });

  it("(b) single user entry 16m old with continuous activity nudges", () => {
    const { stop } = setup("sb", "tb", [userStr(16), assistant(10), toolResult(5), assistant(1)]);
    const out = stop(true);
    expect(out).toContain("implementer-escalation");
    expect(out).toContain("groundwork:junior-orchestrator");
  });

  it("(c) transcript absent: stale firstSeen dropped once id stops running", () => {
    const { tmp, stop } = setup("sc", "tc", null);
    const stateFile = path.join(tmp, ".groundwork", "stop-gate.sc.escalate.json");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ firstSeen: { tc: iso(30) }, nudged: [] }));
    expect(stop(false)).toBeNull();
    expect(stop(true)).toBeNull();
  });

  it("(d) tool_result-only user entries do not reset the clock", () => {
    const { stop } = setup("sd", "td", [userStr(16), assistant(10), toolResult(1)]);
    expect(stop(true)).toContain("implementer-escalation");
  });

  for (const [name, text] of [["skill-load", "Base directory for this skill: /x"], ["notification", "[SYSTEM NOTIFICATION - NOT USER INPUT] bg done"], ["stop-hook", "Stop hook feedback: keep going"]]) {
    it(`(e) mid-run meta entry (${name}) 8m ago does not reset the clock`, () => {
      const { stop } = setup(`se-${name}`, `te-${name}`, [userStr(20), assistant(19.9), toolUse(15, "b1", "Bash"), resultFor(14.9, "b1"), meta(8, text), assistant(7), toolResult(1)]);
      expect(stop(true)).toContain("implementer-escalation");
    });
  }

  it("(f) long Bash gap (tool_use T-10m, tool_result T-6m) in 16m run nudges", () => {
    const { stop } = setup("sf", "tf", [userStr(16), assistant(15), toolUse(10, "b2", "Bash"), resultFor(6, "b2"), assistant(1)]);
    expect(stop(true)).toContain("implementer-escalation");
  });

  it("(g) resumed run nudged before the resume is nudged again", () => {
    const { tmp, stop } = setup("sg", "tg", [userStr(40), assistant(38), toolUse(37.5, "h3", "SubagentHandback"), resultFor(37, "h3"), meta(17, COORD), assistant(10), toolResult(1)]);
    const stateFile = path.join(tmp, ".groundwork", "stop-gate.sg.escalate.json");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ firstSeen: { tg: iso(40) }, nudged: ["tg"] }));
    expect(stop(true)).toContain("implementer-escalation");
  });

  // Pad lines push the transcript past the 1 MiB tail cap.
  const pad = (minAgo: number) => ({ type: "user", isMeta: true, timestamp: iso(minAgo), message: { role: "user", content: [{ type: "text", text: "x".repeat(200_000) }] } });

  it("(h) head-line fallback: no boundary in small transcript uses first entry", () => {
    const { stop } = setup("sh", "th", [userStr(16), assistant(10), assistant(1)]);
    expect(stop(true)).toContain("implementer-escalation");
  });

  it("(i) boundary within the tail cap is found in a large transcript", () => {
    const lines = [userStr(40), pad(39), pad(38), pad(37), pad(36), pad(35), pad(34), assistant(33), toolUse(32.5, "h9", "SubagentHandback"), resultFor(32, "h9"), meta(2, COORD), assistant(1)];
    const { stop } = setup("si", "ti", lines);
    expect(stop(true)).toBeNull();
  });

  it("(j) boundary 5m ago beyond the cap falls back to head line (40m): nudges only because of the cap", () => {
    const lines = [userStr(40), assistant(39), toolUse(7, "h8", "SubagentHandback"), resultFor(6.5, "h8"), meta(5, COORD),
      ...[4.9, 4.8, 4.7, 4.6, 4.5, 4.4, 4.3].map(pad), assistant(1)];
    const { stop } = setup("sj", "tj", lines);
    expect(stop(true)).toContain("implementer-escalation");
  });
});
