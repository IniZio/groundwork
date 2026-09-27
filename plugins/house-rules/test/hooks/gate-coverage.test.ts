import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");

function runGate(payload: unknown, extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "test@test.com"], opts);
  spawnSync("git", ["config", "user.name", "Test"], opts);
}

function gitCommit(dir: string, message: string): string {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", message], opts);
  const r = spawnSync("git", ["rev-parse", "HEAD"], opts);
  return r.stdout.trim();
}

function makeTranscript(tmpDir: string, files: string[], timestamp: string): string {
  const transcriptPath = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const lines = files.map(fp => JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
    },
    timestamp,
    cwd: tmpDir,
  }));
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

describe("COV-1: unrecognised extension appears in coverage report", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cov1-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("session writes notes.kt → output contains 'not checked:' with absolute path", async () => {
    const fp = path.join(tmpDir, "notes.kt");
    writeFileSync(fp, "fun main() {\n    println(\"hello\")\n}\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov1-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const stdout = r.stdout.trim();
    expect(stdout).not.toBe("");
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    // must NOT be a block
    expect(parsed.decision).not.toBe("block");
    // must carry hookSpecificOutput with coverage info
    const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
    expect(hso).toBeTruthy();
    const ctx = hso!.additionalContext as string;
    expect(ctx).toContain("not checked:");
    expect(ctx).toContain(fp);
  });
});

describe("COV-2: recognised .ts file produces no coverage output", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cov2-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("session writes only clean .ts file → stdout is {continue:true}, no 'not checked'", async () => {
    const fp = path.join(tmpDir, "clean.ts");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov2-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed).toEqual({ continue: true });
    expect(r.stdout).not.toContain("not checked");
  });
});

describe("COV-3: notes.kt + comment-density violator → block message names notes.kt as not checked", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cov3-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("notes.kt + unfixable violator .ts → block reason contains notes.kt as not checked", async () => {
    // unfixable violator (parse error prevents autofix)
    const tsFp = path.join(tmpDir, "bad.ts");
    writeFileSync(tsFp, [
      ...Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// r${i}` : `const x${i} = ${i};`),
      "const broken = ;",
    ].join("\n") + "\n");

    const ktFp = path.join(tmpDir, "notes.kt");
    writeFileSync(ktFp, "fun main() {\n    println(\"hello\")\n}\n");

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [tsFp, ktFp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov3-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
    // reason must mention notes.kt as not checked
    const reason = parsed.reason as string;
    expect(reason).toContain("not checked:");
    expect(reason).toContain(ktFp);
  });
});
