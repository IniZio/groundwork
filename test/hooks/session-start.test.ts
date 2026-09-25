import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/session-start.ts");

function run(payload: unknown, env: Record<string, string> = {}): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
    cwd: ROOT,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

describe("session-start hook", () => {
  it("emits SessionStart hookEventName", () => {
    const { stdout, exit } = run({ session_id: "test-123" });
    expect(exit).toBe(0);
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("additionalContext defines GW invocation and uses $GW commands", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/GW="bun .+\/src\/cli\/main\.ts"/);
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW init");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW slice complete");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW gate approve");
  });

  it("additionalContext contains stop-gate, new-code-gate, and house-rules enforcement info", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Stop-gate");
    expect(ctx).toContain("New-code-gate");
    expect(ctx).toContain("house-rules enforcement");
    expect(ctx).toContain("house-rules");
    expect(ctx).not.toContain("Comment-density-gate");
  });

  it("stray-artifacts description mentions sibling coexistence, not 'denies creation of synonym dirs'", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toMatch(/sibling|coexist/i);
    expect(ctx).not.toContain("denies creation of synonym dirs");
  });

  it("additionalContext contains mattpocock skills", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("mattpocock-skills:");
  });

  it("includes session_id when present", () => {
    const { stdout } = run({ session_id: "abc-456", transcript_path: "/tmp/t.jsonl" });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("abc-456");
    expect(out.hookSpecificOutput.additionalContext).toContain("/tmp/t.jsonl");
  });

  it("omits identity block when payload empty", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).not.toContain("session_id:");
  });

  it("exits 0 silently for sdk-py embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 silently for sdk-js embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  // AC: CLAUDE_PLUGIN_ROOT pointing at a foreign dir must not affect the GW path.
  // Bite proof: if we revert to env.CLAUDE_PLUGIN_ROOT ?? import.meta, this fails.
  it("GW path uses hook root even when CLAUDE_PLUGIN_ROOT is a foreign dir", () => {
    const { stdout } = run({}, { CLAUDE_PLUGIN_ROOT: "/tmp/foreign-plugin-root" });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // GW must point at the hook's actual root, not the foreign dir
    expect(ctx).toMatch(new RegExp(`GW="bun ${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/src/cli/main\\.ts"`));
    expect(ctx).not.toContain("/tmp/foreign-plugin-root/src/cli/main.ts");
    // Mismatch warning must appear
    expect(ctx).toContain("CLAUDE_PLUGIN_ROOT mismatch");
  });

  it("additionalContext names version and root", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Header line: groundwork v<semver> [optionally (sha)] — <root>
    expect(ctx).toMatch(/# groundwork v\d+\.\d+\.\d+/);
    expect(ctx).toContain(ROOT);
  });

  it("additionalContext injects routing rules from rules/routing.md", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Routing section header
    expect(ctx).toContain("## Routing");
    // Dispatch rules
    expect(ctx).toContain("groundwork:debugger");
    expect(ctx).toContain("groundwork:explore");
    expect(ctx).toContain("Fan out agents in ONE message");
    expect(ctx).toContain("end turn");
    // A row from the routing table
    expect(ctx).toContain("groundwork:advisor");
  });

  it("additionalContext injects authoring rules from rules/authoring-rules.md", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Rules section header must be present
    expect(ctx).toContain("## Authoring rules");
    // The forbidden zones must appear
    expect(ctx).toMatch(/Negations inviolable/i);
    expect(ctx).toMatch(/Modality preserved/i);
    expect(ctx).toMatch(/Evidence verbatim/i);
    expect(ctx).toMatch(/Sequencing prose/i);
    expect(ctx).toMatch(/invented abbreviations/i);
  });
});
