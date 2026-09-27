/**
 * gate-rule-fix: AC3 + AC4 — generic rule.fix dispatch through the Stop gate.
 * Tests run() with testOnly_rules/testOnly_policy to drive fix, decline, and no-autofix paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../../src/hooks/gate.js";
import type { Rule, RuleContext, FixOptions, FixResult } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "test@test.com"], opts);
  spawnSync("git", ["config", "user.name", "Test"], opts);
}

function gitCommit(dir: string, message: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", message], opts);
}

function makeTranscript(repoDir: string, files: string[], timestamp: string): string {
  const transcriptPath = path.join(repoDir, "transcript.jsonl");
  const lines = files.map(fp => JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
    },
    timestamp,
    cwd: repoDir,
  }));
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

type FixCapture = { ctx: RuleContext; opts: FixOptions | undefined };

function makeStubRule(
  onFix: (ctx: RuleContext, opts: FixOptions | undefined) => FixResult,
): Rule {
  return {
    id: "stub-rewrite",
    meta: { description: "stub rule for gate-rule-fix tests" },
    check(ctx: RuleContext) {
      return (ctx.files ?? [])
        .filter(f => f.path.endsWith(".stub"))
        .map(f => ({
          ruleId: "stub-rewrite",
          path: f.path,
          message: "stub violation",
          fingerprintBasis: f.path,
        }));
    },
    async fix(ctx: RuleContext, opts?: FixOptions): Promise<FixResult> {
      return onFix(ctx, opts);
    },
  };
}

const STUB_POLICY_AUTOFIX = { "stub-rewrite": { severity: "error" as const, autofix: true } };
const STUB_POLICY_NO_AUTOFIX = { "stub-rewrite": { severity: "error" as const, autofix: false } };
const SESSION_ENV = { ...process.env } as Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// AC3: fix rewrites — file updated, additionalContext, caller + testOnly correct
// ---------------------------------------------------------------------------

describe("gate-rule-fix AC3: rule.fix called and rewrites file", () => {
  let repoDir: string;
  let gateTmpDir: string;
  let sessionId: string;
  let stubFile: string;
  let relPath: string;
  let tp: string;
  let captures: FixCapture[];
  let stubRule: Rule;
  const marker = { identity: "AC3" };

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "grfix-a-repo-"));
    gateTmpDir = mkdtempSync(path.join(os.tmpdir(), "grfix-a-tmp-"));
    sessionId = `grfix-a-${Date.now()}`;
    captures = [];

    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, "placeholder.txt"), "base\n");
    gitCommit(repoDir, "initial");

    relPath = "test.stub";
    stubFile = path.join(repoDir, relPath);
    writeFileSync(stubFile, "original content\n");

    tp = makeTranscript(repoDir, [stubFile], new Date(Date.now() - 5000).toISOString());

    stubRule = makeStubRule((ctx, opts) => {
      captures.push({ ctx, opts });
      writeFileSync(path.join(ctx.repoRoot, ctx.files![0].path), "FIXED\n");
      return {
        fixed: 1,
        skipped: 0,
        files: [{
          path: relPath,
          status: "fixed" as const,
          removed: 1,
          kept: 0,
          total: 1,
          addedLines: 7,
        }],
      };
    });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { rmSync(gateTmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("file rewritten, additionalContext has removal line, fix args match contract, testOnly passthrough", async () => {
    const r = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: tp,
        cwd: repoDir,
        stop_hook_active: false,
      },
      SESSION_ENV,
      {
        testOnly_tmpDir: gateTmpDir,
        testOnly_rules: [stubRule],
        testOnly_policy: STUB_POLICY_AUTOFIX,
        stubHook: marker,
      },
    );

    // File on disk must be FIXED\n
    expect(readFileSync(stubFile, "utf8")).toBe("FIXED\n");

    // stdout: hookSpecificOutput (not a block)
    const out = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(out.decision).toBeUndefined();
    const hso = out.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toBeDefined();
    expect(hso.hookEventName).toBe("Stop");
    const additionalContext = hso.additionalContext as string;
    expect(additionalContext).toContain(
      `${stubFile}: removed 1 (kept 0 of 1 added comments; 7 added lines)`,
    );

    // fix called exactly once
    expect(captures.length).toBe(1);
    const { ctx, opts } = captures[0];

    // ctx mode and files
    expect(ctx.mode).toBe("gate");
    expect(ctx.files?.map(f => f.path)).toEqual([relPath]);

    // caller
    expect(opts?.caller).toEqual({
      source: "gate",
      sessionId,
      event: "Stop",
      ledgerDir: path.join(gateTmpDir, "autofix-ledger"),
      shadowDir: gateTmpDir,
    });

    // testOnly passthrough: custom key arrives with identity
    expect((opts?.testOnly as Record<string, unknown>)?.stubHook).toBe(marker);
  });
});

// ---------------------------------------------------------------------------
// AC4a: fix declines — gate blocks, stop-block.txt written with finding + reason
// ---------------------------------------------------------------------------

describe("gate-rule-fix AC4a: rule.fix declines — block output and stop-block.txt", () => {
  let repoDir: string;
  let gateTmpDir: string;
  let sessionId: string;
  let stubFile: string;
  let relPath: string;
  let tp: string;
  let captures: FixCapture[];
  let stubRule: Rule;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "grfix-b-repo-"));
    gateTmpDir = mkdtempSync(path.join(os.tmpdir(), "grfix-b-tmp-"));
    sessionId = `grfix-b-${Date.now()}`;
    captures = [];

    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, "placeholder.txt"), "base\n");
    gitCommit(repoDir, "initial");

    relPath = "test.stub";
    stubFile = path.join(repoDir, relPath);
    writeFileSync(stubFile, "original content\n");

    tp = makeTranscript(repoDir, [stubFile], new Date(Date.now() - 5000).toISOString());

    stubRule = makeStubRule((ctx, opts) => {
      captures.push({ ctx, opts });
      // do NOT write the file
      return {
        fixed: 0,
        skipped: 1,
        files: [{
          path: relPath,
          status: "declined" as const,
          reason: "stub refused",
        }],
      };
    });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { rmSync(gateTmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("stdout is block, file unchanged, stop-block.txt has declined line with reason", async () => {
    const contentBefore = readFileSync(stubFile, "utf8");

    const r = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: tp,
        cwd: repoDir,
        stop_hook_active: false,
      },
      SESSION_ENV,
      {
        testOnly_tmpDir: gateTmpDir,
        testOnly_rules: [stubRule],
        testOnly_policy: STUB_POLICY_AUTOFIX,
      },
    );

    // stdout is a block decision
    const out = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(out.decision).toBe("block");

    // file unchanged
    expect(readFileSync(stubFile, "utf8")).toBe(contentBefore);

    expect(captures.length).toBe(1);

    const blockPath = path.join(gateTmpDir, "house-rules", sessionId, "stop-block.txt");
    expect(existsSync(blockPath)).toBe(true);
    const blockContent = readFileSync(blockPath, "utf8");
    expect(blockContent).toContain(`  ${stubFile}: stub violation — stub refused`);
  });
});


describe("gate-rule-fix AC4b: autofix:false policy — fix not called, gate blocks", () => {
  let repoDir: string;
  let gateTmpDir: string;
  let sessionId: string;
  let stubFile: string;
  let relPath: string;
  let tp: string;
  let fixCallCount: number;
  let stubRule: Rule;

  beforeEach(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "grfix-c-repo-"));
    gateTmpDir = mkdtempSync(path.join(os.tmpdir(), "grfix-c-tmp-"));
    sessionId = `grfix-c-${Date.now()}`;
    fixCallCount = 0;

    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, "placeholder.txt"), "base\n");
    gitCommit(repoDir, "initial");

    relPath = "test.stub";
    stubFile = path.join(repoDir, relPath);
    writeFileSync(stubFile, "original content\n");

    tp = makeTranscript(repoDir, [stubFile], new Date(Date.now() - 5000).toISOString());

    stubRule = makeStubRule((_ctx, _opts) => {
      fixCallCount++;
      return { fixed: 0, skipped: 0, files: [] };
    });
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { }
    try { rmSync(gateTmpDir, { recursive: true, force: true }); } catch { }
  });

  // Before LA-08 the gate acted only on comment-density and stray-artifacts, so an error from a rule the policy does not autofix still allows.
  it("fix never called, stdout is continue, file unchanged, no stop-block written", async () => {
    const r = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: tp,
        cwd: repoDir,
        stop_hook_active: false,
      },
      SESSION_ENV,
      {
        testOnly_tmpDir: gateTmpDir,
        testOnly_rules: [stubRule],
        testOnly_policy: STUB_POLICY_NO_AUTOFIX,
      },
    );

    expect(fixCallCount).toBe(0);
    expect(r.stdout).toBe(JSON.stringify({ continue: true }) + "\n");
    expect(r.exit).toBe(0);
    expect(readFileSync(stubFile, "utf8")).toBe("original content\n");
    expect(existsSync(path.join(gateTmpDir, "house-rules", sessionId, "stop-block.txt"))).toBe(false);
  });
});
