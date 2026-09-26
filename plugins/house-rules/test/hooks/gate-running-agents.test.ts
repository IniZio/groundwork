import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../../src/hooks/gate.js";
import type { FixRecord } from "../../src/hooks/lib/autofix-ledger.js";

const AGENT_ID = "a7c6723ff77026843";

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

function makeViolatorTs(dir: string, name: string): string {
  const fp = path.join(dir, name);
  writeFileSync(fp, Array.from({ length: 20 }, (_, i) =>
    i % 5 === 0 ? `// reason ${i}` : `const x${i} = ${i};`
  ).join("\n") + "\n");
  return fp;
}

function transcriptLine(fp: string, ts: string, cwd: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
    },
    timestamp: ts,
    cwd,
  });
}

function makeMainTranscript(transcriptPath: string, files: string[], ts: string, cwd: string): void {
  const lines = files.map(fp => transcriptLine(fp, ts, cwd));
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
}

function makeSubagentTranscript(subagentPath: string, files: string[], ts: string, cwd: string): void {
  mkdirSync(path.dirname(subagentPath), { recursive: true });
  const lines = files.map(fp => transcriptLine(fp, ts, cwd));
  writeFileSync(subagentPath, lines.join("\n") + "\n");
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

function runningTask(id: string, status = "running"): Record<string, unknown> {
  return { id, type: "subagent", status, description: "implement x", agent_type: "groundwork:implementer" };
}

describe("gate: running agent file exclusion", () => {
  let tmpDir: string;
  let repoDir: string;
  let sessionId: string;
  let transcriptPath: string;
  let subagentPath: string;
  let ts: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gate-running-agents-"));
    repoDir = path.join(tmpDir, "repo");
    mkdirSync(repoDir);
    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, ".gitkeep"), "");
    gitCommit(repoDir, "initial");
    sessionId = `s-runagent-${Date.now()}`;
    transcriptPath = path.join(tmpDir, `${sessionId}.jsonl`);
    subagentPath = path.join(tmpDir, sessionId, "subagents", `agent-${AGENT_ID}.jsonl`);
    ts = new Date(Date.now() - 10000).toISOString();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("running agent: its over-budget file is byte-identical after run and has no ledger record", async () => {
    const agentFile = makeViolatorTs(repoDir, "agent-file.ts");
    const originalContent = readFileSync(agentFile, "utf8");
    gitCommit(repoDir, "add files");

    makeMainTranscript(transcriptPath, [agentFile], ts, repoDir);
    makeSubagentTranscript(subagentPath, [agentFile], ts, repoDir);

    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: repoDir,
        background_tasks: [runningTask(AGENT_ID)],
      },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    expect(readFileSync(agentFile, "utf8")).toBe(originalContent);
    const fixes = readLedgerFixes(ledgerDir);
    const agentFileFixes = fixes.filter(r => r.file === agentFile);
    expect(agentFileFixes).toHaveLength(0);
  });

  it("completed agent: its over-budget file is auto-trimmed (content changes or gate mentions it)", async () => {
    const agentFile = makeViolatorTs(repoDir, "agent-file.ts");
    const originalContent = readFileSync(agentFile, "utf8");
    gitCommit(repoDir, "add files");

    makeMainTranscript(transcriptPath, [agentFile], ts, repoDir);
    makeSubagentTranscript(subagentPath, [agentFile], ts, repoDir);

    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: repoDir,
        background_tasks: [runningTask(AGENT_ID, "completed")],
      },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    const afterContent = readFileSync(agentFile, "utf8");
    const fixes = readLedgerFixes(ledgerDir);
    const agentFileFixes = fixes.filter(r => r.file === agentFile);
    // either the file was auto-trimmed or the gate blocked on it
    const trimmed = afterContent !== originalContent && agentFileFixes.length > 0;
    const blocked = result.stdout.includes("block");
    expect(trimmed || blocked).toBe(true);
  });

  it("docs-shape entry (no type field) running: its over-budget file is excluded", async () => {
    const agentFile = makeViolatorTs(repoDir, "agent-file.ts");
    const originalContent = readFileSync(agentFile, "utf8");
    gitCommit(repoDir, "add files");

    makeMainTranscript(transcriptPath, [agentFile], ts, repoDir);
    makeSubagentTranscript(subagentPath, [agentFile], ts, repoDir);

    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: repoDir,
        background_tasks: [{ id: AGENT_ID, status: "running", description: "implement x" }],
      },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    expect(readFileSync(agentFile, "utf8")).toBe(originalContent);
    const fixes = readLedgerFixes(ledgerDir);
    expect(fixes.filter(r => r.file === agentFile)).toHaveLength(0);
  });

  it("running agent: its file excluded but main-only over-budget file is still trimmed", async () => {
    const agentFile = makeViolatorTs(repoDir, "agent-file.ts");
    const mainFile = makeViolatorTs(repoDir, "main-file.ts");
    const agentOriginal = readFileSync(agentFile, "utf8");
    gitCommit(repoDir, "add files");

    makeMainTranscript(transcriptPath, [agentFile, mainFile], ts, repoDir);
    makeSubagentTranscript(subagentPath, [agentFile], ts, repoDir);

    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    const result = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: repoDir,
        background_tasks: [runningTask(AGENT_ID)],
      },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    // agent file untouched
    expect(readFileSync(agentFile, "utf8")).toBe(agentOriginal);
    // main file was handled (trimmed or blocked)
    const fixes = readLedgerFixes(ledgerDir);
    const mainFixes = fixes.filter(r => r.file === mainFile);
    const agentFixes = fixes.filter(r => r.file === agentFile);
    expect(agentFixes).toHaveLength(0);
    // main file either trimmed (ledger entry) or gate blocked
    const mainTrimmed = mainFixes.length > 0;
    const gateMentionsMain = result.stdout.includes("main-file.ts") || result.stdout.includes("block");
    expect(mainTrimmed || gateMentionsMain).toBe(true);
  });

  it("no-repoRoot fallback: running agent file is excluded even when cwd is absent", async () => {
    const agentFile = makeViolatorTs(repoDir, "agent-file.ts");
    const originalContent = readFileSync(agentFile, "utf8");
    gitCommit(repoDir, "add files");

    // Transcript is inside the repo so gate can find repoRoot from it via fallback
    const fallbackTranscriptPath = path.join(repoDir, `${sessionId}.jsonl`);
    const fallbackSubagentPath = path.join(repoDir, sessionId, "subagents", `agent-${AGENT_ID}.jsonl`);
    makeMainTranscript(fallbackTranscriptPath, [agentFile], ts, repoDir);
    makeSubagentTranscript(fallbackSubagentPath, [agentFile], ts, repoDir);

    const ledgerDir = path.join(tmpDir, "autofix-ledger");

    // No cwd → gate uses touchedFiles fallback to discover repoRoot
    const result = await run(
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        transcript_path: fallbackTranscriptPath,
        background_tasks: [runningTask(AGENT_ID)],
      },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(result.exit).toBe(0);
    expect(readFileSync(agentFile, "utf8")).toBe(originalContent);
    expect(readLedgerFixes(ledgerDir).filter(r => r.file === agentFile)).toHaveLength(0);
  });
});
