import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const FAIL_GRAMMARS_PRELOAD = path.join(import.meta.dir, "../seams/fail-grammars.preload.ts");

function runGate(payload: unknown, extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const bunArgs = extraEnv.HOUSE_RULES_TEST_FAIL_GRAMMARS
    ? ["--preload", FAIL_GRAMMARS_PRELOAD, GATE_PATH]
    : [GATE_PATH];
  const r = spawnSync("bun", bunArgs, {
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

  it("session writes notes.scala → allow path emits {continue:true} with no additionalContext", async () => {
    const fp = path.join(tmpDir, "notes.scala");
    writeFileSync(fp, "fun main() {\n    println(\"hello\")\n}\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov1-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    // must NOT be a block
    expect(parsed.decision).not.toBe("block");
    // allow path must not carry hookSpecificOutput.additionalContext (coverage-only re-prompts the model)
    const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
    expect(hso?.additionalContext).toBeUndefined();
    expect(r.stdout).not.toContain("not checked");
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

describe("COV-4: outside-repo file excluded from block reason; inside .scala present", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cov4-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("block path: inside notes.scala in 'not checked', outside memory.scala absent", async () => {
    const violatorFp = makePreviewViolator(tmpDir, "bad.sh");
    const insideKt = path.join(tmpDir, "notes.scala");
    writeFileSync(insideKt, "fun main() {}\n");
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), "cov4-outside-"));
    const outsideFp = path.join(outsideDir, "memory.scala");
    writeFileSync(outsideFp, "fun outside() {}\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [violatorFp, insideKt, outsideFp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov4-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
    const reason = parsed.reason as string;
    expect(reason).toContain(insideKt);
    expect(reason).not.toContain(outsideFp);
    try { rmSync(outsideDir, { recursive: true, force: true }); } catch { }
  });
});

// Bash with >5/100 comment density — bash has no entry in COMMENT_DENSITY_LANGUAGE_HOOKS so it
// defaults to "preview" and is never auto-fixed (stays unfixable).
function makePreviewViolator(dir: string, name: string): string {
  const fp = path.join(dir, name);
  const lines = [
    "# first narration comment",
    "x_1=1",
    "y_2=2",
    "z_3=3",
    "w_4=4",
    "# second narration comment",
    "a_5=5",
    "b_6=6",
    "c_7=7",
    "h_8=8",
  ];
  writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

function makePreviewViolatorWithSyntaxError(dir: string, name: string): string {
  const fp = path.join(dir, name);
  const lines = [
    "# first narration comment",
    "x_1=1",
    "y_2=2",
    "z_3=3",
    "w_4=4",
    "# second narration comment",
    "a_5=5",
    "b_6=6",
    "c_7=7",
    "x_9=$(",
  ];
  writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

describe("GRAM-1: LOOP-SAFETY — grammar failure on allow path emits only systemMessage, no additionalContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gram1-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("clean .ts with FAIL_GRAMMARS=typescript → {continue:true, systemMessage} only; no hookSpecificOutput, no additionalContext, no decision", async () => {
    const fp = path.join(tmpDir, "clean.ts");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `gram1-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
      { HOUSE_RULES_TEST_FAIL_GRAMMARS: "typescript" },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    // Must be exactly {continue:true, systemMessage:...}
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.decision).toBeUndefined();
    // No hookSpecificOutput or additionalContext anywhere
    expect(parsed.hookSpecificOutput).toBeUndefined();
    expect(r.stdout).not.toContain("additionalContext");
    // systemMessage must name the grammar and reason
    const msg = parsed.systemMessage as string;
    expect(msg).toContain("typescript");
    expect(msg).toContain("forced by HOUSE_RULES_TEST_FAIL_GRAMMARS");
  });
});

describe("GRAM-2: grammar failure suppresses block on that file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gram2-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("over-budget .sh violator + FAIL_GRAMMARS=bash → allow (no block)", async () => {
    const fp = makePreviewViolator(tmpDir, "bad.sh");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `gram2a-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
      { HOUSE_RULES_TEST_FAIL_GRAMMARS: "bash" },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");
    expect(parsed.continue).toBe(true);
  });

  it("over-budget .sh violator without FAIL_GRAMMARS → blocks (control: proves fixture is a real violator)", async () => {
    const fp = makePreviewViolator(tmpDir, "bad.sh");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `gram2b-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
  });
});

describe("GRAM-3: BLOCK carries grammar-failure warning + failed entry in reason", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gram3-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("ts grammar fails + preview-language unfixable violator → block with failed entry and warning in reason", async () => {
    // .ts file: grammar will fail (typescript env)
    const tsFp = path.join(tmpDir, "skip.ts");
    writeFileSync(tsFp, Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const violatorFp = makePreviewViolator(tmpDir, "violator.sh");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [tsFp, violatorFp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `gram3-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
      { HOUSE_RULES_TEST_FAIL_GRAMMARS: "typescript" },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
    const reason = parsed.reason as string;
    expect(reason).toContain(`failed: ${tsFp} (typescript grammar did not load: forced by HOUSE_RULES_TEST_FAIL_GRAMMARS)`);
    expect(reason).toContain("house-rules warning: the typescript grammar did not load (forced by HOUSE_RULES_TEST_FAIL_GRAMMARS)");
    expect(reason).toContain(tsFp);
  });
});

describe("GRAM-4: BLOCK shows partially-checked entry for file with syntax errors", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gram4-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
  });

  it("preview violator with syntax error → block reason contains partially checked entry with row numbers", async () => {
    const violatorFp = makePreviewViolatorWithSyntaxError(tmpDir, "violator-err.sh");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [violatorFp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `gram4-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
    const reason = parsed.reason as string;
    expect(reason).toContain(`partially checked: ${violatorFp} (parse errors: rows `);
  });
});

describe("COV-TSX-AUTOFIX: .tsx over-budget violator is autofixed by gate (tsx is now typescript/stable)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cov-tsx-af-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("over-budget .tsx violator → gate autofixes file (comments removed), no block, additionalContext names the fix", async () => {
    const fp = path.join(tmpDir, "widget.tsx");
    const lines = [
      "// first narration comment",
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "const d = 4;",
      "// second narration comment",
      "const e = 5;",
      "const f = 6;",
      "const g = 7;",
      "const h = 8;",
    ];
    writeFileSync(fp, lines.join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `tsx-af-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    // tsx is typescript (stable+safe): autofix resolves the violation — no block
    expect(parsed.decision).not.toBe("block");
    // gate reports the autofix via hookSpecificOutput.additionalContext
    const hso = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
    const ctx = hso?.additionalContext as string | undefined;
    expect(ctx).toBeDefined();
    expect(ctx).toContain("auto-removed");
    const content = readFileSync(fp, "utf8");
    expect(content).not.toContain("// first narration comment");
    expect(content).not.toContain("// second narration comment");
  });
});

describe("COV-3: notes.scala + comment-density violator → block message names notes.scala as not checked", () => {
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

  it("notes.scala + unfixable violator .sh → block reason contains notes.scala as not checked", async () => {
    const violatorFp = makePreviewViolator(tmpDir, "bad.sh");

    const ktFp = path.join(tmpDir, "notes.scala");
    writeFileSync(ktFp, "fun main() {\n    println(\"hello\")\n}\n");

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [violatorFp, ktFp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `cov3-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).toBe("block");
    // reason must mention notes.scala as not checked
    const reason = parsed.reason as string;
    expect(reason).toContain("not checked:");
    expect(reason).toContain(ktFp);
  });
});
