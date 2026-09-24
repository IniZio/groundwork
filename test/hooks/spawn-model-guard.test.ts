import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { check, loadRegistry, parseBriefFiles, isWithinSlice } from "../../src/hooks/spawn-model-guard.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

function task(subagent_type: string, model?: string) {
  return { tool_name: "Task", tool_input: { subagent_type, ...(model ? { model } : {}) } };
}

function agentWithPrompt(subagent_type: string, prompt: string, model?: string) {
  return { tool_name: "Agent", tool_input: { subagent_type, prompt, ...(model ? { model } : {}) } };
}

/**
 * Parse hook stdout safely.
 * Empty stdout is the allow-by-silence contract; treat it as permissionDecision:"allow"
 * so VIOLATION tests fail with "expected deny, got allow" instead of a SyntaxError.
 */
function safeDecision(result: { stdout: string }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

function parseOutput(result: { stdout: string }) {
  return JSON.parse(result.stdout.trim()) as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
      additionalContext?: string;
      updatedInput?: Record<string, unknown>;
    };
  };
}

const TMP_BASE = "/tmp/gw-spawn-model-guard-test";
let tmpDirs: string[] = [];

function makeProjectDir(sliceId: string, files: string[]): string {
  const dir = path.join(TMP_BASE, `proj-${sliceId}-${Date.now()}`);
  const gwDir = path.join(dir, ".groundwork");
  mkdirSync(gwDir, { recursive: true });
  tmpDirs.push(dir);
  const dbPath = path.join(gwDir, "work.db");
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  runMigrations(db, MIGRATIONS);
  db.run(
    "INSERT INTO slices (id, wave, status, created_at, files) VALUES (?, 1, 'pending', ?, ?)",
    [sliceId, new Date().toISOString(), JSON.stringify(files)]
  );
  db.close();
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { unlinkSync(path.join(d, ".groundwork", "work.db")); } catch { /* ok */ }
    try { rmdirSync(path.join(d, ".groundwork")); } catch { /* ok */ }
    try { rmdirSync(d); } catch { /* ok */ }
  }
  tmpDirs = [];
});

describe("spawn-model-guard — Family 1", () => {
  it("VIOLATION: junior-orchestrator spawning junior-orchestrator → deny", () => {
    const result = check(task("groundwork:junior-orchestrator"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: junior-orchestrator spawning orchestrator → deny", () => {
    const result = check(task("groundwork:orchestrator"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: primary orchestrator spawning junior-orchestrator → inject model (allow)", () => {
    const result = check(task("groundwork:junior-orchestrator"), "groundwork:orchestrator");
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("sonnet");
  });

  it("CLEAN: explicit model set → passthrough (empty stdout + exit 0)", () => {
    const result = check(task("groundwork:advisor", "opus"));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: non-Agent tool → passthrough (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "echo hi" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("injects registry model for advisor → opus", () => {
    const result = check(task("groundwork:advisor"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.updatedInput.model).toBe("opus");
  });

  it("VIOLATION: general-purpose spawned by junior-orchestrator → deny (not in allowlist)", () => {
    const result = check(task("groundwork:general-purpose"), "groundwork:junior-orchestrator");
    expect(safeDecision(result)).toBe("deny");
  });

  it("loadRegistry returns sonnet for implementer", () => {
    const reg = loadRegistry();
    expect(reg["implementer"]).toBe("sonnet");
  });

  it("VIOLATION: bare Explore → deny naming groundwork:explore", () => {
    const result = check(task("Explore"));
    expect(safeDecision(result)).toBe("deny");
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain("groundwork:explore");
  });

  it("VIOLATION: bare general-purpose → deny naming groundwork:implementer", () => {
    const result = check(task("general-purpose"));
    expect(safeDecision(result)).toBe("deny");
    const reason = JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason as string;
    expect(reason).toContain("groundwork:implementer");
  });

  it("VIOLATION: bare EXPLORE (upper) → deny (case-insensitive)", () => {
    const result = check(task("EXPLORE"));
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: groundwork:explore → inject haiku", () => {
    const result = check(task("groundwork:explore"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("haiku");
  });

  it("CLEAN: groundwork:Explore (mixed case) → inject haiku (case-insensitive registry)", () => {
    const result = check(task("groundwork:Explore"));
    const out = JSON.parse(result.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput.model).toBe("haiku");
  });

  it("CLEAN: unknown agent → no crash, allow", () => {
    const result = check(task("some-unknown-agent-xyz"));
    expect(result.exit).toBe(0);
  });
});

describe("spawn-model-guard — size-guard redirect", () => {
  it("REDIRECT: ≥3-file slice → allow + subagent_type rewritten to junior-orchestrator", () => {
    const projDir = makeProjectDir("S1", ["a.ts", "b.ts", "c.ts"]);
    const prompt = "SLICE: S1\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).toBe("groundwork:junior-orchestrator");
  });

  it("REDIRECT: model forced to registry junior-orchestrator model even when caller set a model", () => {
    const projDir = makeProjectDir("S2", ["a.ts", "b.ts", "c.ts"]);
    const prompt = "SLICE: S2\nDo the work.";
    const result = check(
      { tool_name: "Agent", tool_input: { subagent_type: "groundwork:implementer", prompt, model: "opus" } },
      undefined,
      projDir
    );
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.model).toBe("sonnet");
    expect(out.hookSpecificOutput.updatedInput?.model).not.toBe("opus");
  });

  it("REDIRECT: prompt prefix exact", () => {
    const projDir = makeProjectDir("S3", ["a.ts", "b.ts", "c.ts"]);
    const origPrompt = "SLICE: S3\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", origPrompt), undefined, projDir);
    const out = parseOutput(result);
    const newPrompt = out.hookSpecificOutput.updatedInput?.prompt as string;
    expect(newPrompt).toMatch(/^\[size-guard: slice S3 owns 3 files — redirected from implementer; split into ≤2-file leaves\]/);
    expect(newPrompt).toContain("\n" + origPrompt);
  });

  it("REDIRECT: additionalContext present and names slice + count + redirect", () => {
    const projDir = makeProjectDir("S4", ["a.ts", "b.ts", "c.ts"]);
    const prompt = "SLICE: S4\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.additionalContext).toBeTruthy();
    expect(out.hookSpecificOutput.additionalContext).toContain("S4");
    expect(out.hookSpecificOutput.additionalContext).toContain("3");
    expect(out.hookSpecificOutput.additionalContext).toContain("junior-orchestrator");
  });

  it("LEAF EXCEPTION (same-line syntax): 2 files within slice → no redirect, fall through to inject", () => {
    const projDir = makeProjectDir("S5", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const prompt = "SLICE: S5\nFiles owned: src/a.ts, src/b.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });

  it("LEAF EXCEPTION (bullet syntax): 1 file within slice → no redirect", () => {
    const projDir = makeProjectDir("S6", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const prompt = "SLICE: S6\nFiles owned:\n- src/a.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });

  it("LEAF EXCEPTION (bold colon-inside label): **Files owned:** 1 file → no redirect", () => {
    const projDir = makeProjectDir("S6b", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const prompt = "SLICE: S6b\n**Files owned:** src/a.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });

  it("DIR-PREFIX: slice file 'test/hooks' covers 'test/hooks/x.test.ts' → leaf exception", () => {
    const projDir = makeProjectDir("S7", ["src/a.ts", "src/b.ts", "test/hooks"]);
    const prompt = "SLICE: S7\nFiles owned: test/hooks/x.test.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });

  it("NOT-A-PREFIX: 'test/hook' does NOT cover 'test/hooks/x.ts' → redirect", () => {
    const projDir = makeProjectDir("S8", ["src/a.ts", "src/b.ts", "test/hook"]);
    const prompt = "SLICE: S8\nFiles owned: test/hooks/x.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).toBe("groundwork:junior-orchestrator");
  });

  it("NOT-SUBSET: brief file outside slice → redirect listing stray file", () => {
    const projDir = makeProjectDir("S9", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const prompt = "SLICE: S9\nFiles owned: src/a.ts, outside/z.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).toBe("groundwork:junior-orchestrator");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside/z.ts");
  });

  it("3 ENTRIES: brief with 3 files → redirect even if all within slice", () => {
    const projDir = makeProjectDir("S10", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const prompt = "SLICE: S10\nFiles owned: src/a.ts, src/b.ts, src/c.ts\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).toBe("groundwork:junior-orchestrator");
  });

  it("JUNIOR-ORCHESTRATOR CALLER: unaffected by size guard (depth check allows, no size check)", () => {
    const projDir = makeProjectDir("S11", ["a.ts", "b.ts", "c.ts"]);
    const prompt = "SLICE: S11\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), "groundwork:junior-orchestrator", projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });

  it("SMALL SLICE: <3 files → no redirect", () => {
    const projDir = makeProjectDir("S12", ["a.ts", "b.ts"]);
    const prompt = "SLICE: S12\nDo the work.";
    const result = check(agentWithPrompt("groundwork:implementer", prompt), undefined, projDir);
    const out = parseOutput(result);
    expect(out.hookSpecificOutput.updatedInput?.subagent_type).not.toBe("groundwork:junior-orchestrator");
  });
});

describe("parseBriefFiles", () => {
  it("same-line comma-separated", () => {
    expect(parseBriefFiles("Files owned: src/a.ts, src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("bullet lines", () => {
    const p = "Files owned:\n- src/a.ts\n- src/b.ts\nOther: stuff";
    expect(parseBriefFiles(p)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("bold syntax with em-dash", () => {
    expect(parseBriefFiles("**Files owned** — src/a.ts, src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("strips backticks", () => {
    expect(parseBriefFiles("Files owned: `src/a.ts`, `src/b.ts`")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("drops trailing parenthetical", () => {
    expect(parseBriefFiles("Files owned: src/a.ts (read-only), src/b.ts (main)")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("backtick + parenthetical: strips both correctly", () => {
    expect(parseBriefFiles("Files owned — `src/a.ts` (new), test/b.ts")).toEqual(["src/a.ts", "test/b.ts"]);
  });

  it("bold colon-inside same-line: **Files owned:** `src/a.ts`", () => {
    expect(parseBriefFiles("**Files owned:** `src/a.ts`")).toEqual(["src/a.ts"]);
  });

  it("bold colon-inside bullets: **Files owned:**\\n- src/a.ts", () => {
    expect(parseBriefFiles("**Files owned:**\n- src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("returns null when header missing", () => {
    expect(parseBriefFiles("SLICE: S1\nDo the work.")).toBeNull();
  });

  it("bullet with * prefix", () => {
    const p = "Files owned:\n* src/a.ts\n* src/b.ts";
    expect(parseBriefFiles(p)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("isWithinSlice", () => {
  it("exact match", () => {
    expect(isWithinSlice("src/a.ts", ["src/a.ts", "src/b.ts"])).toBe(true);
  });

  it("directory prefix match", () => {
    expect(isWithinSlice("test/hooks/x.test.ts", ["test/hooks"])).toBe(true);
  });

  it("non-prefix: 'test/hook' does not cover 'test/hooks/x.ts'", () => {
    expect(isWithinSlice("test/hooks/x.ts", ["test/hook"])).toBe(false);
  });

  it("no match", () => {
    expect(isWithinSlice("outside/z.ts", ["src/a.ts", "src/b.ts"])).toBe(false);
  });
});
