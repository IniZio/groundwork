import { describe, it, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

const pluginJson = JSON.parse(readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
};

function resolveCommand(cmd: string): string {
  return cmd.replace("${CLAUDE_PLUGIN_ROOT}", ROOT);
}

function eventForCommand(cmd: string): string {
  for (const [event, groups] of Object.entries(pluginJson.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks) {
        if (entry.command === cmd) return event;
      }
    }
  }
  return "Unknown";
}

async function spawnHook(
  rawCmd: string,
  payload: unknown,
  env: Record<string, string> = {}
): Promise<{ stdout: string; exit: number }> {
  const parts = resolveCommand(rawCmd).split(" ");
  const proc = Bun.spawn(parts, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...env } as Record<string, string>,
    cwd: ROOT,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

const tmpDir = `/tmp/gw-deployed-test-${Date.now()}`;
mkdirSync(tmpDir, { recursive: true });

function makeTempDb(label: string): string {
  const dbPath = path.join(tmpDir, `${label}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE slices (id TEXT PRIMARY KEY, wave INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
      acceptance TEXT, blocked_by TEXT, covers_ac TEXT, decisions TEXT, created_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE decisions (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'proposed',
      kind TEXT NOT NULL DEFAULT 'DECISION', decision TEXT NOT NULL, rationale TEXT,
      alternatives TEXT, supersedes TEXT, resolves TEXT, created_at TEXT NOT NULL);
    CREATE TABLE charter (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      objective TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  db.run("INSERT INTO slices (id,wave,status,created_at) VALUES ('S1',1,'pending',?)", [new Date().toISOString()]);
  db.close();
  return dbPath;
}

function makeTempRepo(label: string): string {
  const dir = path.join(tmpDir, `repo-${label}`);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  execSync("git init -q", { cwd: dir });
  writeFileSync(path.join(dir, "Makefile"), "# groundwork-rule: no-console-log\n");
  writeFileSync(path.join(dir, "src", "new.ts"), "console.log('oops');\n");
  return dir;
}

function makeParityDensitySetup(): { parityDensityTranscript: string } {
  const dir = path.join(tmpDir, "repo-cdg");
  mkdirSync(dir, { recursive: true });
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync("git commit --allow-empty -m base", { cwd: dir });
  const FIXTURES = path.join(ROOT, "test/fixtures/comment-density/nexus-probe");
  for (const name of ["Dockerfile", "probe.sh"]) {
    writeFileSync(path.join(dir, name), readFileSync(path.join(FIXTURES, name), "utf8"));
  }
  execSync("git add . && git commit -m 'add fixtures'", { cwd: dir });
  const transcriptPath = path.join(tmpDir, "parity-cdg.jsonl");
  const entries = ["Dockerfile", "probe.sh"].map(name =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: path.join(dir, name), content: "x" } }] },
      timestamp: "2020-01-01T00:00:00.000Z",
      cwd: dir,
    })
  );
  writeFileSync(transcriptPath, entries.join("\n") + "\n");
  return { parityDensityTranscript: transcriptPath };
}

const parityStopGateDb = makeTempDb("parity-sg");
const parityNewCodeRepo = makeTempRepo("parity-ncg");
const { parityDensityTranscript } = makeParityDensitySetup();

afterAll(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ } });

function allCommands(): Array<{ cmd: string; event: string }> {
  const result: Array<{ cmd: string; event: string }> = [];
  for (const [event, groups] of Object.entries(pluginJson.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks) result.push({ cmd: entry.command, event });
    }
  }
  return result;
}

const STOP_EVENTS = new Set(["Stop", "SubagentStop"]);

describe("event-output contract — every (event, command) pair must produce the documented shape", () => {
  const triggeringPayloads: Record<string, [unknown, Record<string, string>]> = {
    "src/hooks/session-start.ts": [
      { session_id: "deployed-test" }, {}
    ],
    "src/hooks/piped-exit-code-guard.ts": [
      { tool_name: "Bash", tool_input: { command: "make build | tail -5\nif [ $? -ne 0 ]; then exit 1; fi" } }, {}
    ],
    "src/hooks/spawn-model-guard.ts": [
      { tool_name: "Agent", tool_input: { subagent_type: "groundwork:orchestrator", model: "haiku" }, agent_type: "groundwork:junior-orchestrator" }, {}
    ],
    "src/hooks/store-write-guard.ts": [
      { tool_name: "Write", tool_input: { file_path: ".groundwork/work.db", content: "" } }, {}
    ],
    "src/hooks/prose-quality-guard.ts": [
      { tool_name: "Edit", tool_input: { file_path: "agents/foo.md",
        old_string: "The orchestrator must not delegate this task to itself.",
        new_string: "The orchestrator must delegate this task to itself." } }, {}
    ],
    "src/hooks/stop-gate.ts": [
      { session_id: "parity-sg" },
      { GROUNDWORK_DB: parityStopGateDb }
    ],
    "src/hooks/new-code-gate.ts": [
      { cwd: parityNewCodeRepo }, {}
    ],
    "src/hooks/comment-density-gate.ts": [
      { event: "Stop", session_id: "parity-cdg", transcript_path: parityDensityTranscript },
      {}
    ],
  };

  for (const { cmd, event } of allCommands()) {
    const key = Object.keys(triggeringPayloads).find(k => cmd.includes(k));
    if (!key) continue;
    const [payload, env] = triggeringPayloads[key];
    it(`${path.basename(key, ".ts")} [${event}] must produce non-empty output with correct shape`, async () => {
      const { stdout } = await spawnHook(cmd, payload, env);
      expect(stdout.trim()).not.toBe("");
      const out = JSON.parse(stdout) as Record<string, unknown> & { hookSpecificOutput?: { hookEventName?: string } };
      if (STOP_EVENTS.has(event)) {
        expect(out.decision).toBe("block");
      } else {
        expect(out.hookSpecificOutput?.hookEventName).toBe(event);
      }
    });
  }

  it("every Stop/SubagentStop hook has a triggering payload", () => {
    for (const { cmd, event } of allCommands()) {
      if (!STOP_EVENTS.has(event)) continue;
      const key = Object.keys(triggeringPayloads).find(k => cmd.includes(k));
      expect(key, `${cmd} [${event}] has no triggering payload`).toBeDefined();
    }
  });
});

describe("deployed — piped-exit-code-guard (PreToolUse/Bash)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/piped-exit-code-guard.ts";

  it("deny: piped $? check", async () => {
    const { stdout } = await spawnHook(CMD,
      { tool_name: "Bash", tool_input: { command: "make build | tail -5\nif [ $? -ne 0 ]; then exit 1; fi" } });
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allow: clean bash command → empty stdout exit 0", async () => {
    const { stdout, exit } = await spawnHook(CMD,
      { tool_name: "Bash", tool_input: { command: "git status" } });
    expect(stdout).toBe("");
    expect(exit).toBe(0);
  });

  it("registered under PreToolUse only", () => {
    const event = eventForCommand(CMD);
    expect(event).toBe("PreToolUse");
  });
});

describe("deployed — spawn-model-guard (PreToolUse)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/spawn-model-guard.ts";

  it("deny: junior-orchestrator spawning orchestrator", async () => {
    const { stdout } = await spawnHook(CMD,
      { tool_name: "Agent", tool_input: { subagent_type: "groundwork:orchestrator", model: "haiku" }, agent_type: "groundwork:junior-orchestrator" });
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allow: non-agent tool → empty stdout exit 0", async () => {
    const { stdout, exit } = await spawnHook(CMD,
      { tool_name: "Write", tool_input: { file_path: "src/foo.ts", content: "" } });
    expect(stdout).toBe("");
    expect(exit).toBe(0);
  });
});

describe("deployed — store-write-guard (PreToolUse)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/store-write-guard.ts";

  it("deny: Write to .groundwork/*.db", async () => {
    const { stdout } = await spawnHook(CMD,
      { tool_name: "Write", tool_input: { file_path: ".groundwork/work.db", content: "" } });
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allow: Write to src file → empty stdout exit 0", async () => {
    const { stdout, exit } = await spawnHook(CMD,
      { tool_name: "Write", tool_input: { file_path: "src/foo.ts", content: "" } });
    expect(stdout).toBe("");
    expect(exit).toBe(0);
  });
});

describe("deployed — prose-quality-guard (PostToolUse)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/prose-quality-guard.ts";

  it("advisory: negation-loss in prose → PostToolUse additionalContext", async () => {
    const { stdout } = await spawnHook(CMD,
      { tool_name: "Edit", tool_input: { file_path: "agents/foo.md",
        old_string: "The orchestrator must not delegate this task to itself.",
        new_string: "The orchestrator must delegate this task to itself." } });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("prose-quality-guard [advisory]");
  });

  it("allow: clean prose edit → empty stdout exit 0", async () => {
    const { stdout, exit } = await spawnHook(CMD,
      { tool_name: "Edit", tool_input: { file_path: "agents/foo.md", old_string: "x", new_string: "x plus more" } });
    expect(stdout).toBe("");
    expect(exit).toBe(0);
  });
});

describe("deployed — stop-gate (Stop)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/stop-gate.ts";

  it("deny: incomplete slices in db", async () => {
    const dbPath = makeTempDb("sg-deny");
    const { stdout } = await spawnHook(CMD, { session_id: "dep-1" }, { GROUNDWORK_DB: dbPath });
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("incomplete");
  });

  it("allow: no db file → allow", async () => {
    const { stdout } = await spawnHook(CMD, { session_id: "dep-2" }, { GROUNDWORK_DB: "/tmp/nonexistent-deployed.db" });
    const out = JSON.parse(stdout);
    expect(out.continue).toBe(true);
  });
});

// CMD matches plugin.json SessionStart entry; assertion below verifies plugin.json contains it.
// If the other agent has not landed plugin.json yet, the plugin.json assertion may be red.
describe("deployed — session-start (SessionStart)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/session-start.ts";

  it("plugin.json registers session-start under SessionStart", () => {
    const hooks = pluginJson.hooks?.["SessionStart"] ?? [];
    const found = hooks.some(g => g.hooks.some(h => h.command === CMD));
    expect(found).toBe(true);
  });

  it("emits SessionStart hookEventName with gw command text", async () => {
    const { stdout, exit } = await spawnHook(CMD, { session_id: "deployed-test-ss" });
    expect(exit).toBe(0);
    expect(stdout.trim()).not.toBe("");
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput?.additionalContext).toContain("$GW init");
  });

  it("exits 0 silently for sdk-js embedded context", async () => {
    const { stdout, exit } = await spawnHook(CMD, {}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });
});

describe("deployed — new-code-gate (Stop/SubagentStop)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/new-code-gate.ts";

  it("allow: sdk-js bypass → allow", async () => {
    const { stdout } = await spawnHook(CMD, {}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    const out = JSON.parse(stdout);
    expect(out.continue).toBe(true);
  });

  it("deny: untracked console.log in repo with active rule", async () => {
    const repoDir = makeTempRepo("ncg");
    const { stdout } = await spawnHook(CMD, { cwd: repoDir }, {});
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("no-console-log");
  });
});
