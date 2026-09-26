import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../../src/hooks/gate.js";
import type { FixRecord } from "../../src/hooks/lib/autofix-ledger.js";

function sha256Str(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
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

function readLedgerFixes(ledgerDir: string): FixRecord[] {
  const lp = path.join(ledgerDir, "ledger.jsonl");
  if (!existsSync(lp)) return [];
  const raw = readFileSync(lp, "utf8");
  return raw
    .split("\n")
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as FixRecord)
    .filter(r => r.kind === "fix");
}

function makeViolatorTs(dir: string, name: string): string {
  // 4 comments in 20 lines = 20/100 > 5/100 budget
  const fp = path.join(dir, name);
  writeFileSync(fp, Array.from({ length: 20 }, (_, i) =>
    i % 5 === 0 ? `// reason ${i}` : `const x${i} = ${i};`
  ).join("\n") + "\n");
  return fp;
}

function makeViolatorTsMixed(dir: string, name: string): string {
  // 20 lines: 4 whole-line, 1 trailing, 1 inline block = 6 comments → over 5/100 budget
  const lines = [
    "const v0 = 0;",
    "// whole 1",
    "const v2 = 2;",
    "// whole 3",
    "const v4 = 4;",
    "// whole 5",
    "const v6 = 6;",
    "// whole 7",
    "const v8 = 8;",
    "const v9 = 9; // trailing",
    "const v10 = /* inline note */ 10;",
    "const v11 = 11;",
    "const v12 = 12;",
    "const v13 = 13;",
    "const v14 = 14;",
    "const v15 = 15;",
    "const v16 = 16;",
    "const v17 = 17;",
    "const v18 = 18;",
    "const v19 = 19;",
  ];
  const fp = path.join(dir, name);
  writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

describe("gate ledger: autofix writes recorded", () => {
  let tmpDir: string;
  let repoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gate-ledger-test-"));
    repoDir = path.join(tmpDir, "repo");
    mkdirSync(repoDir);
    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, ".gitkeep"), "");
    gitCommit(repoDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("over-budget TS auto-fixed: ledger has one record matching disk content and removed texts", async () => {
    const fp = makeViolatorTs(repoDir, "dense.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const transcriptPath = makeTranscript(tmpDir, [fp], ts);
    const sessionId = `ledger-fix-${Date.now()}`;
    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: transcriptPath },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    const out = result.stdout.trim() ? JSON.parse(result.stdout) as Record<string, unknown> : {};
    expect(out.decision).not.toBe("block");

    const fixes = readLedgerFixes(ledgerDir);
    expect(fixes).toHaveLength(1);

    const rec = fixes[0];
    expect(rec.file).toBe(fp);
    expect(rec.source).toBe("gate");

    const diskContent = readFileSync(fp, "utf8");
    expect(rec.fixedHash).toBe(sha256Str(diskContent));

    expect(rec.removed.length).toBeGreaterThan(0);
    for (const r of rec.removed) {
      expect(typeof r).toBe("string");
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it("over-budget TS with trailing and inline block comments: removed[] contains only comment texts, count matches gate report", async () => {
    const fp = makeViolatorTsMixed(repoDir, "mixed.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const transcriptPath = makeTranscript(tmpDir, [fp], ts);
    const sessionId = `ledger-mixed-${Date.now()}`;
    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: transcriptPath },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);

    const fixes = readLedgerFixes(ledgerDir);
    expect(fixes).toHaveLength(1);

    const rec = fixes[0];
    const countMatch = rec.reason.match(/removed (\d+) comment\(s\)/);
    expect(countMatch).not.toBeNull();
    const gateRemovedCount = parseInt(countMatch![1], 10);

    expect(rec.removed).toHaveLength(gateRemovedCount);
    for (const r of rec.removed) {
      const t = r.trim();
      const isComment = t.startsWith("//") || (t.startsWith("/*") && t.endsWith("*/"));
      expect(isComment).toBe(true);
      expect(t.includes(" = ") && !t.startsWith("//") && !t.startsWith("/*")).toBe(false);
    }
  });

  it("under-budget TS file: no ledger record written", async () => {
    const fp = path.join(repoDir, "clean.ts");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const transcriptPath = makeTranscript(tmpDir, [fp], ts);
    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    await run(
      { hook_event_name: "Stop", session_id: `ledger-clean-${Date.now()}`, transcript_path: transcriptPath },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(readLedgerFixes(ledgerDir)).toHaveLength(0);
  });

  it("preview language (bash) over-budget: shadow only, no ledger record", async () => {
    // bash stability = "preview" → no disk write → no ledger entry
    const fp = path.join(repoDir, "script.sh");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) =>
      i % 5 === 0 ? `# reason ${i}` : `echo line${i}`
    ).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const transcriptPath = makeTranscript(tmpDir, [fp], ts);
    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    await run(
      { hook_event_name: "Stop", session_id: `ledger-bash-${Date.now()}`, transcript_path: transcriptPath },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(readLedgerFixes(ledgerDir)).toHaveLength(0);
  });
});
