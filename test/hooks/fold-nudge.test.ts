import { describe, it, expect, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, message } from "../../src/hooks/fold-nudge.js";

const HOOK = new URL("../../src/hooks/fold-nudge.ts", import.meta.url).pathname;

function call(agent_type?: string, agent_id = "a1") {
  return { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, ...(agent_type ? { agent_type, agent_id } : {}) };
}

function context(result: { stdout: string }): string | null {
  const s = result.stdout.trim();
  if (!s) return null;
  const h = (JSON.parse(s) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput;
  expect(h.hookEventName).toBe("PostToolUse");
  return h.additionalContext;
}

/** Runs `n` calls and returns the 1-based call numbers that got a nudge. */
function nudgedAt(agent_type: string | undefined, n: number, dir: string, agent_id = "a1"): number[] {
  const hits: number[] = [];
  for (let i = 1; i <= n; i++) if (context(check(call(agent_type, agent_id), dir)) !== null) hits.push(i);
  return hits;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fold-nudge-test-")); });

describe("fold-nudge", () => {
  it("nudges groundwork:worker at 40 calls, then every 10", () => {
    expect(nudgedAt("groundwork:worker", 61, dir)).toEqual([40, 50, 60]);
  });

  it("nudges groundwork:junior at 30 calls, then every 10", () => {
    expect(nudgedAt("groundwork:junior", 41, dir)).toEqual([30, 40]);
  });

  it("the nudge names the call count and asks for the receipt", () => {
    const text = message(40);
    expect(text).toContain("40 tool calls");
    expect(text).toContain("Stop now and hand back");
    expect(text).toContain("pass/fail line quoted exactly");
  });

  it("counts each agent separately", () => {
    for (let i = 0; i < 39; i++) check(call("groundwork:worker", "first"), dir);
    expect(nudgedAt("groundwork:worker", 1, dir, "second")).toEqual([]);
    expect(nudgedAt("groundwork:worker", 1, dir, "first")).toEqual([1]);
  });

  it("leaves the main thread and other agent types alone", () => {
    expect(nudgedAt(undefined, 50, dir)).toEqual([]);
    expect(nudgedAt("pstack:poteto-agent", 50, dir)).toEqual([]);
    expect(nudgedAt("general-purpose", 50, dir)).toEqual([]);
  });

  it("deployed command path: the 40th worker call prints the nudge", () => {
    const env = { ...process.env, TMPDIR: dir };
    const id = `deployed-${Date.now()}`;
    let last = "";
    for (let i = 0; i < 40; i++) {
      const r = spawnSync("bun", [HOOK], { input: JSON.stringify(call("groundwork:worker", id)), encoding: "utf8", env });
      expect(r.status).toBe(0);
      last = r.stdout;
    }
    expect(context({ stdout: last })).toBe(message(40));
  });
});
