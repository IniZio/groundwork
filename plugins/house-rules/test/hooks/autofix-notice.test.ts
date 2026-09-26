import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFix } from "../../src/hooks/lib/autofix-ledger.js";
import { run } from "../../src/hooks/autofix-notice.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "autofix-notice-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function opts() {
  return { dir: tmpDir };
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    tool_name: "Read",
    tool_input: { file_path: "/tmp/foo.ts" },
    cwd: "/tmp",
    ...overrides,
  };
}

function seedFix(file: string, content = "content here") {
  appendFix(
    {
      file,
      fixedContent: content,
      removed: ["// old comment"],
      reason: "over-budget",
      source: "housekeep",
    },
    opts()
  );
}

describe("autofix-notice run()", () => {
  it("(1) main session Read → notice once; second call same key → empty", () => {
    const file = "/tmp/foo.ts";
    seedFix(file);

    const payload = makePayload({ tool_input: { file_path: file } });

    const out1 = run(payload, opts());
    expect(out1).not.toBe("");
    const parsed1 = JSON.parse(out1);
    expect(parsed1.hookSpecificOutput.additionalContext).toContain(file);
    expect(parsed1.hookSpecificOutput.additionalContext).toContain("automatic");
    expect(parsed1.hookSpecificOutput.additionalContext).toContain("not another agent");
    // outer object must not carry a blocking decision
    expect(parsed1).not.toHaveProperty("permissionDecision");
    expect(parsed1).not.toHaveProperty("decision");
    // hookSpecificOutput itself must not carry a blocking decision — only the two informational keys
    expect(Object.keys(parsed1.hookSpecificOutput).sort()).toEqual(
      ["additionalContext", "hookEventName"]
    );
    // raw JSON must not encode any form of blocking
    expect(out1).not.toContain("permissionDecision");
    expect(out1).not.toContain('"decision"');
    expect(out1).not.toContain('"continue":false');

    // second call same key → empty
    const out2 = run(payload, opts());
    expect(out2).toBe("");
  });

  it("(2) different agent_id gets its own notice once", () => {
    const file = "/tmp/bar.ts";
    seedFix(file);

    // first agent
    const payload1 = makePayload({
      agent_id: "agent-A",
      tool_input: { file_path: file },
    });
    const out1 = run(payload1, opts());
    expect(out1).not.toBe("");
    expect(JSON.parse(out1).hookSpecificOutput.additionalContext).toContain(file);

    // second agent with different id sees it once
    const payload2 = makePayload({
      agent_id: "agent-B",
      tool_input: { file_path: file },
    });
    const out2 = run(payload2, opts());
    expect(out2).not.toBe("");

    // first agent second call → empty
    const out3 = run(payload1, opts());
    expect(out3).toBe("");

    // second agent second call → empty
    const out4 = run(payload2, opts());
    expect(out4).toBe("");
  });

  it("(3) Edit/Write/MultiEdit tools also deliver notice", () => {
    const file = "/tmp/baz.ts";
    seedFix(file);

    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      const out = run(
        makePayload({ session_id: `sess-${tool}`, tool_name: tool, tool_input: { file_path: file } }),
        opts()
      );
      expect(out).not.toBe("");
      expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain(file);
    }
  });

  it("(4) no record for file → empty; other file record → empty for queried file", () => {
    seedFix("/tmp/other.ts");

    const out = run(makePayload({ tool_input: { file_path: "/tmp/foo.ts" } }), opts());
    expect(out).toBe("");
  });

  it("(5) malformed input → empty string, no throw", () => {
    expect(run(null, opts())).toBe("");
    expect(run(undefined, opts())).toBe("");
    expect(run({}, opts())).toBe("");
    expect(run("not an object", opts())).toBe("");
    expect(run({ tool_input: null }, opts())).toBe("");
  });

  it("(6) deployed-path: bun spawn exits 0, emits hookSpecificOutput, no permissionDecision", async () => {
    const file = "/tmp/deployed-test.ts";
    seedFix(file);

    const hookPath = path.join(
      import.meta.dir,
      "../../src/hooks/autofix-notice.ts"
    );
    const payload = JSON.stringify(
      makePayload({ tool_input: { file_path: file } })
    );

    const result = Bun.spawnSync(["bun", hookPath], {
      stdin: Buffer.from(payload),
      env: { ...process.env, HOUSE_RULES_AUTOFIX_LEDGER_DIR: tmpDir },
    });

    expect(result.exitCode).toBe(0);
    const stdout = result.stdout.toString();
    expect(stdout.trim()).not.toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(file);
    expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual(
      ["additionalContext", "hookEventName"]
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(stdout).not.toContain('"decision"');
    expect(stdout).not.toContain('"continue":false');
  });
});
