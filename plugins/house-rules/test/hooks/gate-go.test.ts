/**
 * GO-T4 / GO-T7: Stop-gate tests for Go comment-autofix path.
 * Covers preview (AC1), forced-stable (AC2–AC5), default-stable (AC6), and CLI fix (AC7) paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../../src/hooks/gate.js";
import { isGofmtAvailable } from "../../src/hooks/lib/gofmt.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors gate.test.ts)
// ---------------------------------------------------------------------------

function sha256(fp: string): string {
  return createHash("sha256").update(readFileSync(fp)).digest("hex");
}

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

function makeTranscript(tmpDir: string, files: string[], timestamp: string): string {
  const transcriptPath = path.join(tmpDir, "transcript.jsonl");
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

// ---------------------------------------------------------------------------
// Go corpus directive lines (from test/fixtures/comment-density/go-directives/corpus.go)
// These must survive autoFix unchanged.
// ---------------------------------------------------------------------------
const CORPUS_DIRECTIVES = [
  "//go:generate echo hello",
  "//go:embed dummy.txt",
  "//go:build ignore",
  "// +build ignore",
  "//go:noinline",
  "//nolint:errcheck",
];

// A minimal, gofmt-clean base Go file (within budget, no comments)
const BASE_GO = `package gotest

func Add(a, b int) int {
\treturn a + b
}
`;

// Over-budget session file: corpus directives + many narrative comments.
// Directive lines must survive; narrative lines may be removed.
// This file is gofmt-clean (tabs, correct spacing).
const SESSION_GO_OVER_BUDGET = `package gotest

//go:generate echo hello

// NarrativeA this comment adds no value.
// NarrativeB this comment adds no value.
// NarrativeC this comment adds no value.
// NarrativeD this comment adds no value.
// NarrativeE this comment adds no value.
// NarrativeF this comment adds no value.
// NarrativeG this comment adds no value.
// NarrativeH this comment adds no value.
// NarrativeI this comment adds no value.
// NarrativeJ this comment adds no value.

func Add(a, b int) int {
\treturn a + b
}
`;

// Gofmt-DIRTY base: misaligned const block (missing tabs).
// gofmt would reformat this; committed as-is.
const DIRTY_BASE_GO = `package gotest

const (
x = 1
y = 2
)

func Add(a, b int) int {
\treturn a + b
}
`;

const DIRTY_SESSION_GO = `package gotest

const (
x = 1
y = 2
)

//go:generate echo hello

// NarrativeA dirty session narrative.
// NarrativeB dirty session narrative.
// NarrativeC dirty session narrative.
// NarrativeD dirty session narrative.
// NarrativeE dirty session narrative.
// NarrativeF dirty session narrative.
// NarrativeG dirty session narrative.
// NarrativeH dirty session narrative.

func Add(a, b int) int {
\treturn a + b
}
`;

// ---------------------------------------------------------------------------
// AC1: preview path (Go default stability is "preview")
// ---------------------------------------------------------------------------
describe("GO-T4 AC1: Go autofix preview — no write, shadow log written", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac1-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac1-sh-"));
    sessionId = `go-ac1-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_GO);
    gitCommit(tmpDir, "initial");

    // Session: overwrite with over-budget version
    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, SESSION_GO_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it("file hash unchanged; shadow jsonl has go record with removedLines; no directive text removed; all preExisting=false", async () => {
    const hashBefore = sha256(fp);

    await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
      { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir, testOnly_fixTableOverride: { go: { stability: "preview", applicability: "safe" } } } as any,
    );

    // File must not be written (preview mode)
    expect(sha256(fp)).toBe(hashBefore);

    // Positive control: shadow file exists and has ≥1 record
    const shadowFile = path.join(shadowTmpDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
    expect(existsSync(shadowFile)).toBe(true);
    const rawLines = readFileSync(shadowFile, "utf8").split("\n").filter(l => l.trim());
    expect(rawLines.length).toBeGreaterThanOrEqual(1);

    // Find the record for this Go file
    const records = rawLines.map(l => JSON.parse(l) as Record<string, unknown>);
    const goRec = records.find(rec => rec.lang === "go");
    expect(goRec).toBeDefined();
    const removedLines = goRec!.removedLines as Array<{ lineNum: number; text: string; preExisting: boolean }>;
    expect(removedLines.length).toBeGreaterThan(0);

    // All removed lines must be session-added (preExisting=false)
    for (const rl of removedLines) {
      expect(rl.preExisting).toBe(false);
    }

    // No corpus directive text must appear in removedLines
    const removedTexts = removedLines.map(rl => rl.text);
    for (const directive of CORPUS_DIRECTIVES) {
      const bare = directive.trim();
      expect(removedTexts.some(t => t.includes(bare))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2: forced stable — file rewritten; directives survive; narrative comments gone;
//       gofmt-clean output; hookSpecificOutput contains "auto-removed"
// ---------------------------------------------------------------------------
describe("GO-T4 AC2: Go autofix forced stable — writes file", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac2-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac2-sh-"));
    sessionId = `go-ac2-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_GO);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, SESSION_GO_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it.skipIf(!isGofmtAvailable())(
    "hash changed; directives present; narrative comments gone; gofmt-clean; additionalContext has auto-removed",
    async () => {
      const hashBefore = sha256(fp);

      const r = await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
        { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
        {
          testOnly_tmpDir: shadowTmpDir,
          testOnly_fixTableOverride: { go: { stability: "stable", applicability: "safe" } },
        } as any,
      );

      const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;

      // File must have been rewritten
      expect(sha256(fp)).not.toBe(hashBefore);
      expect(out.decision).not.toBe("block");

      const content = readFileSync(fp, "utf8");

      // Corpus directive //go:generate must be present
      expect(content).toContain("//go:generate echo hello");

      // At least one narrative comment is gone
      const narratives = ["NarrativeA", "NarrativeB", "NarrativeC", "NarrativeD", "NarrativeE",
        "NarrativeF", "NarrativeG", "NarrativeH", "NarrativeI", "NarrativeJ"];
      const remaining = narratives.filter(n => content.includes(n));
      expect(remaining.length).toBeLessThan(narratives.length);

      // Output must be gofmt-clean
      const { spawnSync: spawn } = await import("node:child_process");
      const fmt = spawn("gofmt", [], { input: content, encoding: "utf8" });
      expect(fmt.stdout).toBe(content);

      // hookSpecificOutput/additionalContext mentions "auto-removed"
      const hso = out.hookSpecificOutput as Record<string, unknown> | undefined;
      expect(hso?.additionalContext).toMatch(/auto-removed/);
    },
  );
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe("GO-T4 AC3: base comments preserved after stable write", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  const BASE_WITH_COMMENTS = `package gotest

// BaseComment1 explains base behavior.
// BaseComment2 more base info.

func Add(a, b int) int {
\treturn a + b
}
`;

  const SESSION_WITH_EXTRA_COMMENTS = `package gotest

// BaseComment1 explains base behavior.
// BaseComment2 more base info.

func Add(a, b int) int {
\treturn a + b
}

// SessionC1 session narrative comment.
// SessionC2 session narrative comment.
// SessionC3 session narrative comment.
// SessionC4 session narrative comment.
// SessionC5 session narrative comment.
// SessionC6 session narrative comment.
// SessionC7 session narrative comment.
// SessionC8 session narrative comment.

func Mul(a, b int) int {
\treturn a * b
}
`;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac3-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac3-sh-"));
    sessionId = `go-ac3-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_WITH_COMMENTS);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, SESSION_WITH_EXTRA_COMMENTS);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() + 10000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it.skipIf(!isGofmtAvailable())(
    "base-committed comments stay byte-identical after stable write",
    async () => {
      await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
        { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
        {
          testOnly_tmpDir: shadowTmpDir,
          testOnly_fixTableOverride: { go: { stability: "stable", applicability: "safe" } },
        } as any,
      );

      const content = readFileSync(fp, "utf8");
      expect(content).toContain("// BaseComment1 explains base behavior.");
      expect(content).toContain("// BaseComment2 more base info.");
    },
  );
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe("GO-T4 AC4: HOUSE_RULES_GOFMT='' — no write, gate blocks", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac4-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac4-sh-"));
    sessionId = `go-ac4-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_GO);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, SESSION_GO_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it("hash unchanged; decision=block", async () => {
    const hashBefore = sha256(fp);

    const savedGofmt = process.env.HOUSE_RULES_GOFMT;
    process.env.HOUSE_RULES_GOFMT = "";
    let r: Awaited<ReturnType<typeof run>>;
    try {
      r = await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
        { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, HOUSE_RULES_GOFMT: "" } as Record<string, string | undefined>,
        {
          testOnly_tmpDir: shadowTmpDir,
          testOnly_fixTableOverride: { go: { stability: "stable", applicability: "safe" } },
        } as any,
      );
    } finally {
      if (savedGofmt === undefined) {
        delete process.env.HOUSE_RULES_GOFMT;
      } else {
        process.env.HOUSE_RULES_GOFMT = savedGofmt;
      }
    }

    expect(sha256(fp)).toBe(hashBefore);

    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(typeof out.reason).toBe("string");
    expect(out.reason as string).toMatch(/house-rules/);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe("GO-T4 AC5: gofmt-dirty base — writes but preserves misalignment", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac5-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac5-sh-"));
    sessionId = `go-ac5-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), DIRTY_BASE_GO);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, DIRTY_SESSION_GO);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it.skipIf(!isGofmtAvailable())(
    "file written; misaligned const block byte-identical",
    async () => {
      const hashBefore = sha256(fp);

      const r = await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
        { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
        {
          testOnly_tmpDir: shadowTmpDir,
          testOnly_fixTableOverride: { go: { stability: "stable", applicability: "safe" } },
        } as any,
      );

      const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;

      expect(sha256(fp)).not.toBe(hashBefore);
      expect(out.decision).not.toBe("block");

      const content = readFileSync(fp, "utf8");

      expect(content).toContain("const (\nx = 1\ny = 2\n)");
    },
  );
});

// ---------------------------------------------------------------------------
// AC6: default table (no override) — Go now stable, Stop gate writes fix
// ---------------------------------------------------------------------------
describe("GO-T7 AC6: Go default-stable — no override, Stop gate rewrites over-budget file", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac6-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac6-sh-"));
    sessionId = `go-ac6-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_GO);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "base.go");
    writeFileSync(fp, SESSION_GO_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it.skipIf(!isGofmtAvailable())(
    "default-stable: hash changed; directives survive; output gofmt-clean; no block",
    async () => {
      const hashBefore = sha256(fp);

      const r = await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
        { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
        { testOnly_tmpDir: shadowTmpDir } as any,
      );

      const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;

      // File must have been rewritten (Go is now stable by default)
      expect(sha256(fp)).not.toBe(hashBefore);
      expect(out.decision).not.toBe("block");

      const content = readFileSync(fp, "utf8");

      expect(content).toContain("//go:generate echo hello");

      // Output must be gofmt-clean
      const fmt = spawnSync("gofmt", [], { input: content, encoding: "utf8" });
      expect(fmt.stdout).toBe(content);
    },
  );
});

// ---------------------------------------------------------------------------
// AC7: CLI rule fix path — comment-density rule fix() writes Go file
// ---------------------------------------------------------------------------
describe("GO-T7 AC7: CLI rule fix path — comment-density fix() handles stable Go", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-go-ac7-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "base.go"), BASE_GO);
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
  });

  it.skipIf(!isGofmtAvailable())(
    "fix() returns fixed>=1 and writes the Go file",
    async () => {
      const fp2 = path.join(tmpDir, "base.go");
      writeFileSync(fp2, SESSION_GO_OVER_BUDGET);

      const sessionLines = SESSION_GO_OVER_BUDGET.split("\n");
      const addedLineNums: number[] = [];
      for (let i = 1; i <= sessionLines.length; i++) addedLineNums.push(i);

      const { default: rule } = await import("../../rules/comment-density/index.js");

      const result = await rule.fix!({
        repoRoot: tmpDir,
        mode: "cli",
        files: [
          {
            path: "base.go",
            text: SESSION_GO_OVER_BUDGET,
            baseText: BASE_GO,
            addedHunks: [
              {
                added: addedLineNums,
                removed: [],
                removedBaseLineNos: [],
              },
            ],
          },
        ],
      });

      expect(result.fixed).toBeGreaterThanOrEqual(1);

      // File must have been rewritten
      const written = readFileSync(fp2, "utf8");
      expect(written).not.toBe(SESSION_GO_OVER_BUDGET);

      expect(written).toContain("//go:generate echo hello");
    },
  );
});
