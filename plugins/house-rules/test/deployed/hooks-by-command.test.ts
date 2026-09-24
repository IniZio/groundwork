import { describe, it, expect, afterAll } from "bun:test";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

// PLUGIN_ROOT = plugins/house-rules/
const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
// REPO_ROOT = groundwork repo root (for fixtures)
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");

const pluginJson = JSON.parse(
  readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8")
) as {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
};

function resolveCommand(cmd: string): string {
  return cmd.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT);
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
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env } as Record<string, string>,
    cwd: PLUGIN_ROOT,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  return { stdout, exit };
}

function allCommands(): Array<{ cmd: string; event: string }> {
  const result: Array<{ cmd: string; event: string }> = [];
  for (const [event, groups] of Object.entries(pluginJson.hooks ?? {})) {
    for (const group of groups) {
      for (const entry of group.hooks) result.push({ cmd: entry.command, event });
    }
  }
  return result;
}

const tmpDir = `/tmp/hr-deployed-test-${Date.now()}`;
mkdirSync(tmpDir, { recursive: true });

function makeParityDensityRepo(label: string): { transcriptPath: string } {
  const dir = path.join(tmpDir, `repo-cdg-${label}`);
  mkdirSync(dir, { recursive: true });
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync("git commit --allow-empty -m base", { cwd: dir });
  const FIXTURES = path.join(REPO_ROOT, "plugins/house-rules/test/fixtures/comment-density/nexus-probe");
  for (const name of ["Dockerfile", "probe.sh"]) {
    writeFileSync(path.join(dir, name), readFileSync(path.join(FIXTURES, name), "utf8"));
  }
  execSync("git add . && git commit -m fixtures", { cwd: dir });
  const transcriptPath = path.join(tmpDir, `parity-cdg-${label}.jsonl`);
  const entries = ["Dockerfile", "probe.sh"].map(name =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: path.join(dir, name), content: "x" } }] },
      timestamp: "2020-01-01T00:00:00.000Z",
      cwd: dir,
    })
  );
  writeFileSync(transcriptPath, entries.join("\n") + "\n");
  return { transcriptPath };
}

const { transcriptPath: parityDensityTranscript } = makeParityDensityRepo("stop");
const { transcriptPath: paritySubagentTranscript } = makeParityDensityRepo("sub");

afterAll(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ } });

const STOP_EVENTS = new Set(["Stop", "SubagentStop"]);

describe("event-output contract — house-rules hooks", () => {
  const triggeringPayloads: Record<string, [unknown, Record<string, string>]> = {
    "src/hooks/comment-density-gate.ts@Stop": [
      { hook_event_name: "Stop", session_id: "parity-cdg", transcript_path: parityDensityTranscript },
      {}
    ],
    "src/hooks/comment-density-gate.ts@SubagentStop": [
      {
        hook_event_name: "SubagentStop",
        session_id: "parity-cdg-sub",
        agent_id: "parity-subagent-001",
        transcript_path: paritySubagentTranscript,
        agent_transcript_path: paritySubagentTranscript,
      },
      {}
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

describe("deployed — comment-density-gate (Stop/SubagentStop)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/comment-density-gate.ts";

  it("Stop: produces valid decision or autoFixed output", async () => {
    const { stdout } = await spawnHook(CMD, {
      hook_event_name: "Stop",
      session_id: "gate-stop-test",
      transcript_path: parityDensityTranscript,
    });
    expect(stdout.trim()).not.toBe("");
    const out = JSON.parse(stdout) as Record<string, unknown> & { hookSpecificOutput?: { hookEventName?: string } };
    const blocked = out.decision === "block";
    const autoFixed = out.hookSpecificOutput?.hookEventName === "Stop";
    expect(blocked || autoFixed).toBe(true);
  });

  it("SubagentStop: produces valid decision or autoFixed output", async () => {
    const { stdout } = await spawnHook(CMD, {
      hook_event_name: "SubagentStop",
      session_id: "gate-sub-test",
      agent_id: "sub-001",
      transcript_path: paritySubagentTranscript,
      agent_transcript_path: paritySubagentTranscript,
    });
    expect(stdout.trim()).not.toBe("");
    const out = JSON.parse(stdout) as Record<string, unknown> & { hookSpecificOutput?: { hookEventName?: string } };
    const blocked = out.decision === "block";
    const autoFixed = out.hookSpecificOutput?.hookEventName === "SubagentStop";
    expect(blocked || autoFixed).toBe(true);
  });
});

describe("deployed — comment-density-guard (PreToolUse Edit|Write|MultiEdit)", () => {
  const CMD = "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/guard.ts";

  it("benign Write payload: exits 0 with empty or valid JSON output", async () => {
    const { stdout, exit } = await spawnHook(CMD, {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/foo.ts", content: "export const x = 1;\n" },
    });
    expect(exit).toBe(0);
    if (stdout.trim() !== "") {
      const out = JSON.parse(stdout) as Record<string, unknown>;
      expect(out).toBeDefined();
    }
  });
});
