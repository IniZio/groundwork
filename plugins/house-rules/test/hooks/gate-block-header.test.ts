import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "t@t.com"], opts);
  spawnSync("git", ["config", "user.name", "T"], opts);
}

function gitCommit(dir: string, msg: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", msg], opts);
}

function makeTranscript(tmpDir: string, files: string[], ts: string): string {
  const tp = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const lines = files.map(fp => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
    timestamp: ts,
    cwd: tmpDir,
  }));
  writeFileSync(tp, lines.join("\n") + "\n");
  return tp;
}

function runGate(payload: unknown, dir: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function parseOut(stdout: string): Record<string, unknown> {
  const t = stdout.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}

// TSX with >5/100 comment density — tsx is "preview" so never auto-fixed (stays unfixable).
function makeTsxViolator(dir: string, name: string): string {
  const fp = path.join(dir, name);
  // 8 code lines, 2 comment lines = 2/10 = 20% > 5%
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
  return fp;
}

describe("gate-block-header: stray-only block", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-stray-"));
    initGitRepo(tmpDir);
    // doc/ is tracked (canonical); docs/ is the synonym
    mkdirSync(path.join(tmpDir, "doc"), { recursive: true });
    writeFileSync(path.join(tmpDir, "doc", "base.md"), "# base\n");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(a) stray-only: reason contains merge line, no 'comment' or '5/100'", () => {
    mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    const fp = path.join(tmpDir, "docs", "x.md");
    writeFileSync(fp, "# x\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({
      hook_event_name: "Stop",
      session_id: `gbh-stray-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    // Must contain the merge direction line
    expect(reason).toContain("docs/");
    expect(reason).toContain("doc/");
    // Must NOT mention comments or 5/100
    expect(reason).not.toContain("comment");
    expect(reason).not.toContain("5/100");
  });
});

describe("gate-block-header: comment-density-only block", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-dens-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(b) density-only: reason contains existing comment-density header", () => {
    const fp = makeTsxViolator(tmpDir, "widget.tsx");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({
      hook_event_name: "Stop",
      session_id: `gbh-dens-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    expect(reason).toContain("house-rules comment-density gate:");
    expect(reason).toContain("5 comment lines per 100");
  });
});

describe("gate-block-header: both density and stray", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-both-"));
    initGitRepo(tmpDir);
    mkdirSync(path.join(tmpDir, "doc"), { recursive: true });
    writeFileSync(path.join(tmpDir, "doc", "base.md"), "# base\n");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(c) both: reason contains density section and stray section", () => {
    // density violator
    const tsxFp = makeTsxViolator(tmpDir, "widget.tsx");
    // stray: docs/ coexists with doc/
    mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    const strayFp = path.join(tmpDir, "docs", "x.md");
    writeFileSync(strayFp, "# x\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeTranscript(tmpDir, [tsxFp, strayFp], ts);
    const r = runGate({
      hook_event_name: "Stop",
      session_id: `gbh-both-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    // Must contain density section guidance
    expect(reason).toContain("comment-density:");
    expect(reason).toContain("5/100");
    // Must contain stray section
    expect(reason).toContain("stray-artifacts:");
    expect(reason).toContain("docs/");
  });
});

describe("gate-block-header: SubagentStop stray-only", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-sub-"));
    initGitRepo(tmpDir);
    mkdirSync(path.join(tmpDir, "doc"), { recursive: true });
    writeFileSync(path.join(tmpDir, "doc", "base.md"), "# base\n");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(d) SubagentStop stray-only: reason contains hand-back suffix", () => {
    mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    const fp = path.join(tmpDir, "docs", "x.md");
    writeFileSync(fp, "# x\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({
      hook_event_name: "SubagentStop",
      session_id: `gbh-sub-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    expect(reason).toContain("Edits made after hand-back do not reach the caller.");
    expect(reason).not.toContain("comment");
    expect(reason).not.toContain("5/100");
  });
});

// Helper: make a .ts file with over-budget comment density that autofix (stable) will fix.
// Uses 6 comment lines per 50 code lines = 12/100 > 5/100.
function makeTsViolatorAutoFixable(dir: string, name: string): string {
  const fp = path.join(dir, name);
  const code = Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`);
  // Insert 6 comments — over the 5/100 threshold
  const lines = [...code.slice(0, 10), "// comment one", ...code.slice(10, 20),
    "// comment two", ...code.slice(20, 30), "// comment three", ...code.slice(30, 40),
    "// comment four", ...code.slice(40, 45), "// comment five", "// comment six",
    ...code.slice(45)];
  writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

describe("gate-block-header: stray + auto-fixed .ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-e-"));
    initGitRepo(tmpDir);
    mkdirSync(path.join(tmpDir, "doc"), { recursive: true });
    writeFileSync(path.join(tmpDir, "doc", "base.md"), "# base\n");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(e) stray + auto-fixed .ts: reason contains fixedNote and merge line", () => {
    // stray: untracked docs/ coexists with tracked doc/
    mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    const strayFp = path.join(tmpDir, "docs", "x.md");
    writeFileSync(strayFp, "# x\n");

    mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    const tsFp = makeTsViolatorAutoFixable(tmpDir, "src/fix.ts");

    const ts = new Date(Date.now() - 5000).toISOString();
    // transcript records both files as session-written
    const tp = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
    const lines = [strayFp, tsFp].map(fp => JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
      timestamp: ts,
      cwd: tmpDir,
    }));
    writeFileSync(tp, lines.join("\n") + "\n");

    const r = runGate({
      hook_event_name: "Stop",
      session_id: `gbh-e-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);

    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    expect(reason).toContain("auto-fixed in this run:");
    expect(reason).toContain("fix.ts");
    expect(reason).toContain("docs/");
    expect(reason).toContain("doc/");
  });
});

describe("gate-block-header: both rules truncation on SubagentStop", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gbh-f-"));
    initGitRepo(tmpDir);
    mkdirSync(path.join(tmpDir, "doc"), { recursive: true });
    writeFileSync(path.join(tmpDir, "doc", "base.md"), "# base\n");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("(f) both rules, many density files, SubagentStop → ≤2000 chars with required sections", () => {
    const tsxFiles: string[] = [];
    for (let i = 0; i < 30; i++) {
      const fp = makeTsxViolator(tmpDir, `widget${i}.tsx`);
      tsxFiles.push(fp);
    }

    mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    const strayFp = path.join(tmpDir, "docs", "x.md");
    writeFileSync(strayFp, "# x\n");

    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
    const allFiles = [...tsxFiles, strayFp];
    const tpLines = allFiles.map(fp => JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
      timestamp: ts,
      cwd: tmpDir,
    }));
    writeFileSync(tp, tpLines.join("\n") + "\n");

    const r = runGate({
      hook_event_name: "SubagentStop",
      session_id: `gbh-f-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    }, tmpDir);

    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    expect(reason.length).toBeLessThanOrEqual(2000);
    expect(reason).toContain("stray-artifacts:");
    expect(reason).toContain("Merge the coexisting directories or move/delete the scratch file.");
    expect(reason).toContain("Edits made after hand-back do not reach the caller.");
  });
});
