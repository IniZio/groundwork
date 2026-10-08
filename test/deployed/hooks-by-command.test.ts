import { describe, it, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { MIGRATIONS } from "../../src/store/schema.js";
import { runMigrations } from "../../src/store/migrations.js";
import { artifactHash } from "../../src/cli/gate-status.js";

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

const parityStopGateDb = makeTempDb("parity-sg");
const parityNewCodeRepo = makeTempRepo("parity-ncg");

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
  };

  function findPayloadKey(cmd: string, event: string): string | undefined {
    const specific = Object.keys(triggeringPayloads).find(k => {
      const at = k.lastIndexOf("@");
      if (at < 0) return false;
      return cmd.includes(k.slice(0, at)) && k.slice(at + 1) === event;
    });
    if (specific) return specific;
    return Object.keys(triggeringPayloads).find(k => !k.includes("@") && cmd.includes(k));
  }

  for (const { cmd, event } of allCommands()) {
    const key = findPayloadKey(cmd, event);
    if (!key) continue;
    const [payload, env] = triggeringPayloads[key];
    const displayKey = key.includes("@") ? key.slice(0, key.lastIndexOf("@")) : key;
    it(`${path.basename(displayKey, ".ts")} [${event}] must produce non-empty output with correct shape`, async () => {
      const { stdout } = await spawnHook(cmd, payload, env);
      expect(stdout.trim()).not.toBe("");
      const out = JSON.parse(stdout) as Record<string, unknown> & { hookSpecificOutput?: { hookEventName?: string } };
      if (STOP_EVENTS.has(event)) {
        const blocked = out.decision === "block";
        const autoFixed = out.hookSpecificOutput?.hookEventName === event;
        expect(blocked || autoFixed).toBe(true);
      } else {
        expect(out.hookSpecificOutput?.hookEventName).toBe(event);
      }
    });
  }

  it("every Stop/SubagentStop hook has a triggering payload", () => {
    for (const { cmd, event } of allCommands()) {
      if (!STOP_EVENTS.has(event)) continue;
      const key = findPayloadKey(cmd, event);
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

describe("deployed — spawn-model-guard intent gate (PreToolUse)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/spawn-model-guard.ts";
  const SLUG = "intent-demo";
  const payload = { tool_name: "Agent", hook_event_name: "PreToolUse",
    tool_input: { subagent_type: "groundwork:implementer", prompt: "do x", description: "x" } };

  function scrubbedEnv(proj: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const k of ["CLAUDE_PROJECT_DIR", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_SUBAGENT_TYPE"]) delete env[k];
    env.CLAUDE_PROJECT_DIR = proj;
    return env;
  }

  async function run(proj: string) {
    const parts = resolveCommand(CMD).split(" ");
    const proc = Bun.spawn(parts, { stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { ...scrubbedEnv(proj), CLAUDE_PLUGIN_ROOT: ROOT }, cwd: ROOT });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exit: await proc.exited };
  }

  function makeProject(label: string, withDocs: boolean): string {
    const proj = path.join(tmpDir, `intent-${label}`);
    mkdirSync(path.join(proj, ".groundwork"), { recursive: true });
    const db = new Database(path.join(proj, ".groundwork", "work.db"));
    runMigrations(db, MIGRATIONS);
    db.run("INSERT OR REPLACE INTO meta (key,value) VALUES ('active_motive', ?)", [SLUG]);
    db.close();
    if (withDocs) {
      mkdirSync(path.join(proj, "doc", SLUG), { recursive: true });
      writeFileSync(path.join(proj, "doc", SLUG, "motive.md"), "# charter\n");
      writeFileSync(path.join(proj, "doc", SLUG, "spec.md"), "# spec\n");
    }
    return proj;
  }

  function approve(proj: string, type: "APPROVE_CHARTER" | "APPROVE_SPEC", kind: "charter" | "spec") {
    const hash = artifactHash(proj, SLUG, kind);
    const db = new Database(path.join(proj, ".groundwork", "work.db"));
    db.run("INSERT INTO events (event_type,payload,created_at,motive_id) VALUES (?,?,?,?)",
      [type, JSON.stringify({ hash, files: [], by: "human", created_at: new Date().toISOString() }), new Date().toISOString(), SLUG]);
    db.close();
  }

  const reasonOf = (stdout: string): string =>
    stdout ? (JSON.parse(stdout).hookSpecificOutput?.permissionDecisionReason ?? "") : "";

  it("deny: charter present, no approvals → H1 charter approval missing", async () => {
    const { stdout, exit } = await run(makeProject("noappr", true));
    const out = JSON.parse(stdout);
    expect(exit).toBe(0);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("H1 charter approval missing");
  });

  it("allow: correct approvals → no intent-gate deny", async () => {
    const proj = makeProject("approved", true);
    approve(proj, "APPROVE_CHARTER", "charter");
    approve(proj, "APPROVE_SPEC", "spec");
    const { stdout, exit } = await run(proj);
    expect(exit).toBe(0);
    expect(reasonOf(stdout)).not.toContain("intent gate");
  });

  it("deny: spec edited after approval → H2 spec approval void", async () => {
    const proj = makeProject("edited", true);
    approve(proj, "APPROVE_CHARTER", "charter");
    approve(proj, "APPROVE_SPEC", "spec");
    writeFileSync(path.join(proj, "doc", SLUG, "spec.md"), "# spec edited\n");
    const { stdout, exit } = await run(proj);
    expect(exit).toBe(0);
    expect(reasonOf(stdout)).toContain("H2 spec approval void");
  });

  it("allow: no doc/<slug>/ → no intent-gate deny (backward compat)", async () => {
    const { stdout, exit } = await run(makeProject("nodocs", false));
    expect(exit).toBe(0);
    expect(reasonOf(stdout)).not.toContain("intent gate");
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
