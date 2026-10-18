import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { run, budgetGate, escalateStateFile } from "../../src/hooks/stop-gate.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOOK_PATH = path.resolve(import.meta.dir, "../../src/hooks/stop-gate.ts");
const MIN = 60_000;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * MIN).toISOString();
const userEntry = (minAgo: number, text: string) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: text } });
const assistantEntry = (minAgo: number) => ({ type: "assistant", timestamp: iso(minAgo), message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });
const budgetBash = (action: string, minutes: number, task: string) => ({
  type: "assistant", timestamp: iso(1),
  message: { role: "assistant", content: [{ type: "tool_use", id: `b-${action}-${minutes}`, name: "Bash", input: {
    command: `$GW event append --type BUDGET --data '${JSON.stringify({ task, action, minutes })}'`,
  } }] },
});

describe("stop-gate — budget block", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) {
      try { rmSync(tmpDirs.pop()!, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  interface Opts { agentType?: string; event?: string; mainLines?: unknown[]; withDb?: boolean }

  /** Real hook-input shape with a main transcript and one subagent transcript whose first user entry is the dispatch prompt. */
  function setup(sessionId: string, taskId: string, childLines: unknown[], opts: Opts = {}) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gw-budget-"));
    tmpDirs.push(tmp);
    const transcript = path.join(tmp, `${sessionId}.jsonl`);
    writeFileSync(transcript, (opts.mainLines ?? []).map(l => JSON.stringify(l)).join("\n") + (opts.mainLines?.length ? "\n" : ""));
    const dir = path.join(tmp, sessionId, "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `agent-${taskId}.jsonl`), childLines.map(l => JSON.stringify(l)).join("\n") + "\n");
    let dbPath: string | null = null;
    if (opts.withDb) {
      dbPath = path.join(tmp, "work.db");
      const db = new Database(dbPath);
      runMigrations(db, MIGRATIONS);
      db.close();
    }
    const inp = {
      session_id: sessionId, transcript_path: transcript, cwd: tmp, hook_event_name: opts.event ?? "Stop",
      background_tasks: [{ id: taskId, type: "local_agent", status: "running", description: "child work", agent_type: opts.agentType ?? "groundwork:implementer" }],
    };
    const env: Record<string, string | undefined> = { CLAUDE_PROJECT_DIR: tmp, ...(dbPath ? { GROUNDWORK_DB: dbPath } : {}) };
    const addDecision = (action: string, minutes: number) => {
      const db = new Database(dbPath!);
      db.run("INSERT INTO events (event_type, payload, created_at) VALUES ('BUDGET', ?, ?)",
        [JSON.stringify({ task: taskId, action, minutes }), new Date().toISOString()]);
      db.close();
    };
    const stop = () => {
      const out = JSON.parse(run(inp, env).stdout) as Record<string, unknown>;
      return out.decision === "block" ? String(out.reason) : null;
    };
    return { tmp, inp, env, dbPath, transcript, addDecision, stop };
  }

  it("blocks a 20 min child with no budget line, naming id, elapsed, budget and the append command", () => {
    const { stop } = setup("s1", "tk1", [userEntry(20, "implement the thing"), assistantEntry(1)]);
    const reason = stop()!;
    expect(reason).not.toBeNull();
    expect(reason).toContain("tk1");
    expect(reason).toContain("20m");
    expect(reason).toContain("15m");
    expect(reason).toContain("event append --type BUDGET");
  });

  it("budget: 40m on the first line lets a 20 min child run", () => {
    const { stop } = setup("s2", "tk2", [userEntry(20, "budget: 40m\nimplement the thing"), assistantEntry(1)]);
    expect(stop()).toBeNull();
  });

  it("a budget line on line 2 is ignored and the default applies", () => {
    const { stop } = setup("s3", "tk3", [userEntry(20, "implement the thing\nbudget: 40m"), assistantEntry(1)]);
    expect(stop()).toContain("15m");
  });

  it("a child under budget is not blocked", () => {
    const { stop } = setup("s4", "tk4", [userEntry(5, "go"), assistantEntry(1)]);
    expect(stop()).toBeNull();
  });

  it("budgets non-implementer agents too", () => {
    const { stop } = setup("s5", "tk5", [userEntry(20, "go"), assistantEntry(1)], { agentType: "groundwork:researcher" });
    expect(stop()).toContain("tk5");
  });

  it("does not block SubagentStop", () => {
    const { inp, env } = setup("s6", "tk6", [userEntry(20, "go"), assistantEntry(1)], { event: "SubagentStop" });
    expect(budgetGate(inp, env, null)).toBeNull();
    const out = JSON.parse(run(inp, env).stdout) as Record<string, unknown>;
    expect(out.decision).toBeUndefined();
  });

  it("ignores tasks that are not running", () => {
    const { inp, env } = setup("s7", "tk7", [userEntry(20, "go")]);
    (inp.background_tasks[0] as Record<string, unknown>).status = "complete";
    expect(budgetGate(inp, env, null)).toBeNull();
  });

  it("db extend 10 raises a 15 min budget to 25: 20 min passes, 30 min blocks as already extended", () => {
    const young = setup("s8a", "tk8a", [userEntry(20, "go"), assistantEntry(1)], { withDb: true });
    young.addDecision("extend", 10);
    expect(young.stop()).toBeNull();
    const old = setup("s8b", "tk8b", [userEntry(30, "go"), assistantEntry(1)], { withDb: true });
    old.addDecision("extend", 10);
    const reason = old.stop()!;
    expect(reason).toContain("already extended");
    expect(reason).toContain("25m");
  });

  it("transcript extend 10 (Bash tool_use in the main transcript) behaves the same", () => {
    const young = setup("s9a", "tk9a", [userEntry(20, "go"), assistantEntry(1)], { mainLines: [budgetBash("extend", 10, "tk9a")] });
    expect(young.stop()).toBeNull();
    const old = setup("s9b", "tk9b", [userEntry(30, "go"), assistantEntry(1)], { mainLines: [budgetBash("extend", 10, "tk9b")] });
    expect(old.stop()).toContain("already extended");
  });

  it("a second extend does not move the budget", () => {
    const { stop, addDecision } = setup("s10", "tk10", [userEntry(30, "go"), assistantEntry(1)], { withDb: true });
    addDecision("extend", 10);
    addDecision("extend", 30);
    expect(stop()).toContain("25m");
  });

  it("stop clears the breach", () => {
    const { stop, addDecision } = setup("s11", "tk11", [userEntry(30, "go"), assistantEntry(1)], { withDb: true });
    expect(stop()).not.toBeNull();
    addDecision("stop", 0);
    expect(stop()).toBeNull();
  });

  it("five consecutive Stop runs over budget all block and leave no counter files", () => {
    const { stop, tmp } = setup("s12", "tk12", [userEntry(30, "go"), assistantEntry(1)], { withDb: true });
    for (let i = 0; i < 5; i++) expect(stop()).toContain("tk12");
    expect(readdirSync(tmp).filter(f => f.endsWith(".count") || f.endsWith(".sig"))).toEqual([]);
  });

  it("CLI spawn: hook prints a block decision for an over-budget child", () => {
    const { inp, env } = setup("s13", "tk13", [userEntry(30, "go"), assistantEntry(1)]);
    const r = spawnSync("bun", ["run", HOOK_PATH], { input: JSON.stringify(inp), env: { ...process.env, ...env }, encoding: "utf8" });
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(String(out.reason)).toContain("tk13");
  });

  it("no work store: an over-budget child blocks on every run while unledgered edits also block", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "gw-budget-nostore-"));
    tmpDirs.push(tmp);
    const repo = path.join(tmp, "repo");
    mkdirSync(repo);
    const git = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" } });
    git(["init", "-q"]);
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    const transcript = path.join(tmp, "snost.jsonl");
    writeFileSync(transcript, [
      { type: "user", timestamp: "2021-01-01T00:00:00Z" },
      { type: "assistant", timestamp: "2021-01-02T00:00:00Z", cwd: repo, isSidechain: false, message: { role: "assistant", content: [
        { type: "tool_use", id: "tu0", name: "Edit", input: { file_path: path.join(repo, "a.ts"), old_string: "1", new_string: "2" } }] } },
    ].map(l => JSON.stringify(l)).join("\n") + "\n");
    const dir = path.join(tmp, "snost", "subagents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agent-tkns.jsonl"), [userEntry(30, "go"), assistantEntry(1)].map(l => JSON.stringify(l)).join("\n") + "\n");
    const home = path.join(tmp, "home");
    mkdirSync(home);
    const inp = { session_id: "snost", transcript_path: transcript, cwd: repo, hook_event_name: "Stop", stop_hook_active: false,
      background_tasks: [{ id: "tkns", type: "local_agent", status: "running", description: "child work", agent_type: "groundwork:implementer" }] };
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo } as Record<string, string | undefined>;
    delete env.GROUNDWORK_DB;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    for (let i = 0; i < 5; i++) {
      const r = spawnSync("bun", [HOOK_PATH], { input: JSON.stringify(inp), encoding: "utf8", env: env as Record<string, string> });
      const out = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
      expect(out.decision).toBe("block");
      expect(String(out.reason)).toContain("event append --type BUDGET");
    }
  });

  it("an old escalate state file carrying a nudged list does not break the clock", () => {
    const { inp, env } = setup("s14", "tk14", [userEntry(30, "go"), assistantEntry(1)]);
    const f = escalateStateFile(inp, env, null);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ firstSeen: { tk14: iso(30) }, nudged: ["tk14"] }));
    expect(budgetGate(inp, env, null)).toContain("tk14");
  });
});


describe("stop-gate — budget clock across resume", () => {
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
      return out.decision === "block" ? String(out.reason) : null;
    };
    return { tmp, stop };
  }

  const userStr = (minAgo: number) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: "go" } });
  const toolResult = (minAgo: number) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
  const assistant = (minAgo: number) => ({ type: "assistant", timestamp: iso(minAgo), message: { role: "assistant", content: [{ type: "text", text: "hi" }] } });

  const meta = (minAgo: number, text: string) => ({ type: "user", isMeta: true, timestamp: iso(minAgo), message: { role: "user", content: [{ type: "text", text }] } });
  const toolUse = (minAgo: number, id: string, name: string) => ({ type: "assistant", timestamp: iso(minAgo), message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] } });
  const resultFor = (minAgo: number, id: string) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
  const COORD = "The coordinator sent a message while you were working: continue";

  it("(a) resumed run 2m old does not block despite 24m since spawn", () => {
    const { tmp, stop } = setup("sa", "ta", [userStr(24), assistant(23), toolUse(22.5, "h1", "SubagentHandback"), resultFor(22, "h1"), meta(2, COORD)]);
    const stateFile = path.join(tmp, ".groundwork", "stop-gate.sa.escalate.json");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ firstSeen: { ta: iso(24) }, nudged: [] }));
    expect(stop(true)).toBeNull();
  });

  it("(b) single user entry 16m old with continuous activity blocks", () => {
    const { stop } = setup("sb", "tb", [userStr(16), assistant(10), toolResult(5), assistant(1)]);
    const out = stop(true);
    expect(out).toContain("stop-gate: budget");
    expect(out).toContain("event append --type BUDGET");
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
    expect(stop(true)).toContain("stop-gate: budget");
  });

  for (const [name, text] of [["skill-load", "Base directory for this skill: /x"], ["notification", "[SYSTEM NOTIFICATION - NOT USER INPUT] bg done"], ["stop-hook", "Stop hook feedback: keep going"]]) {
    it(`(e) mid-run meta entry (${name}) 8m ago does not reset the clock`, () => {
      const { stop } = setup(`se-${name}`, `te-${name}`, [userStr(20), assistant(19.9), toolUse(15, "b1", "Bash"), resultFor(14.9, "b1"), meta(8, text), assistant(7), toolResult(1)]);
      expect(stop(true)).toContain("stop-gate: budget");
    });
  }

  it("(f) long Bash gap (tool_use T-10m, tool_result T-6m) in 16m run blocks", () => {
    const { stop } = setup("sf", "tf", [userStr(16), assistant(15), toolUse(10, "b2", "Bash"), resultFor(6, "b2"), assistant(1)]);
    expect(stop(true)).toContain("stop-gate: budget");
  });

  it("(g) resumed run blocked before the resume is blocked again", () => {
    const { tmp, stop } = setup("sg", "tg", [userStr(40), assistant(38), toolUse(37.5, "h3", "SubagentHandback"), resultFor(37, "h3"), meta(17, COORD), assistant(10), toolResult(1)]);
    const stateFile = path.join(tmp, ".groundwork", "stop-gate.sg.escalate.json");
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ firstSeen: { tg: iso(40) }, nudged: ["tg"] }));
    expect(stop(true)).toContain("stop-gate: budget");
  });

  // Pad lines push the transcript past the 1 MiB tail cap.
  const pad = (minAgo: number) => ({ type: "user", isMeta: true, timestamp: iso(minAgo), message: { role: "user", content: [{ type: "text", text: "x".repeat(200_000) }] } });

  it("(h) head-line fallback: no boundary in small transcript uses first entry", () => {
    const { stop } = setup("sh", "th", [userStr(16), assistant(10), assistant(1)]);
    expect(stop(true)).toContain("stop-gate: budget");
  });

  it("(i) boundary within the tail cap is found in a large transcript", () => {
    const lines = [userStr(40), pad(39), pad(38), pad(37), pad(36), pad(35), pad(34), assistant(33), toolUse(32.5, "h9", "SubagentHandback"), resultFor(32, "h9"), meta(2, COORD), assistant(1)];
    const { stop } = setup("si", "ti", lines);
    expect(stop(true)).toBeNull();
  });

  it("(j) boundary 5m ago beyond the cap falls back to head line (40m): blocks only because of the cap", () => {
    const lines = [userStr(40), assistant(39), toolUse(7, "h8", "SubagentHandback"), resultFor(6.5, "h8"), meta(5, COORD),
      ...[4.9, 4.8, 4.7, 4.6, 4.5, 4.4, 4.3].map(pad), assistant(1)];
    const { stop } = setup("sj", "tj", lines);
    expect(stop(true)).toContain("stop-gate: budget");
  });
});
