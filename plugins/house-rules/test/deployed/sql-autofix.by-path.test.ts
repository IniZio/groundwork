// SQL autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE  = path.join(REPO, "src/hooks/gate.ts");

async function spawnGuard(
  payload: unknown,
  tmpDir: string,
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(["bun", GUARD], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: "/decoy/project/dir",
      CLAUDE_PLUGIN_ROOT: REPO,
    } as Record<string, string>,
    cwd: tmpDir,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

function spawnGate(
  payload: unknown,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO, ...extraEnv },
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

function gitCommit(dir: string, message: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", message], opts);
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

async function assertParsesClean(content: string, label: string): Promise<void> {
  const r = await parseText(content, "sql", getParser);
  expect(r.ok, `${label}: parse failed`).toBe(true);
  if (r.ok) expect(r.errorRows.size, `${label}: errorRows`).toBe(0);
}

const NARRATIVE = Array.from({ length: 8 }, (_, i) => `-- narrative line ${i}: this statement is described in prose here`);
const MARKERS = [
  "-- migrate:up",
  "-- +goose Up",
  "-- +goose StatementBegin",
  "-- name: ListItems :many",
  "-- +goose StatementEnd",
  "-- migrate:down",
];
const HINT = "SELECT /*+ INDEX(items idx_items_name) */ id FROM items;";

function sqlSource(): string {
  return [
    MARKERS[0],
    MARKERS[1],
    MARKERS[2],
    MARKERS[3],
    ...Array.from({ length: 20 }, (_, i) => `INSERT INTO items (id, name) VALUES (${i}, 'item_${i}');`),
    "",
    ...NARRATIVE,
    "",
    "INSERT INTO items (id, name) VALUES (99, 'value -- not a comment');",
    HINT,
    MARKERS[4],
    MARKERS[5],
    "DROP TABLE items;",
  ].join("\n");
}

function assertSurvivors(out: string): void {
  for (const line of NARRATIVE) expect(out).not.toContain(line);
  const dashed = out.split("\n").filter((l) => l.startsWith("--"));
  expect(dashed).toEqual(MARKERS);
  for (let i = 0; i < 20; i++) expect(out).toContain(`VALUES (${i}, 'item_${i}');`);
  expect(out).toContain("'value -- not a comment'");
  expect(out).toContain(HINT);
  expect(out).toContain("DROP TABLE items;");
}

describe("AC-SQL-GUARD: guard Write of over-budget .sql strips narrative, keeps markers", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-sql-guard-"));
  it("exit 0; updatedInput.content keeps markers/hint/string literal", async () => {
    await assertParsesClean(sqlSource(), "input");
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: path.join(tmpDir, "0001_items.sql"), content: sqlSource() } },
      tmpDir,
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;
    await assertParsesClean(updated, "guard output");
    assertSurvivors(updated);
    expect(hso.additionalContext as string).toContain("not another session's edit");
  });
});

describe("AC-SQL-GATE: gate Stop autofix of over-budget .sql fixes file on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-sql-gate-"));
  const sqlPath = path.join(tmpDir, "0002_items.sql");
  it("removes narrative from disk; markers survive; stdout reports autofix", async () => {
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    writeFileSync(sqlPath, sqlSource());
    const tp = makeTranscript(tmpDir, [sqlPath], new Date(Date.now() - 10000).toISOString());
    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-sql-gate-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
      stop_hook_active: false,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");
    const ctx = (parsed.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(ctx).toContain("0002_items.sql");
    const disk = readFileSync(sqlPath, "utf8");
    await assertParsesClean(disk, "gate disk");
    assertSurvivors(disk);
  });
});
