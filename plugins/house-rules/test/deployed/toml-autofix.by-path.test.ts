// TOML autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE = path.join(REPO, "src/hooks/gate.ts");

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

function spawnGate(payload: unknown): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO },
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
  const lines = files.map((fp) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
      },
      timestamp,
      cwd: tmpDir,
    }),
  );
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

async function assertParsesClean(content: string, label: string): Promise<void> {
  const r = await parseText(content, "toml", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING nodes on rows: ${[...r.errorRows].join(",")}`).toBe(0);
  }
}

function sameData(a: string, b: string): void {
  expect(Bun.TOML.parse(a)).toEqual(Bun.TOML.parse(b));
}

const SCHEMA_LINE = "#:schema https://json.schemastore.org/pyproject.json";
const LATE_SCHEMA_LINE = "#:schema https://example.com/late.json";

const NARRATIVE = [
  "# narrative one: this table configures the user lookup service",
  "# narrative two: the timeout is measured in whole seconds here",
  "# narrative three: retries are capped by the retry table below",
  "# narrative four: the endpoint must be reachable from the worker",
  "# narrative five: credentials come from the environment at runtime",
  "# narrative six: see the design doc for the rollout plan details",
];

function tomlBody(): string {
  return [
    SCHEMA_LINE,
    "",
    ...Array.from({ length: 12 }, (_, i) => `field_${i} = ${i}`),
    "",
    NARRATIVE[0],
    NARRATIVE[1],
    "[service]",
    'url = "http://host/path#fragment" # trailing note on url',
    "pattern = 'a # b'",
    'text = """',
    "# not a comment, inside a multi-line string",
    '"""',
    "raw = '''",
    "# neither is this",
    "'''",
    NARRATIVE[2],
    "ports = [",
    "  # narrative inside the array",
    "  80, # after eighty",
    "  443,",
    "]",
    LATE_SCHEMA_LINE,
    NARRATIVE[3],
    "[[service.replicas]]",
    "id = 1",
    NARRATIVE[4],
    "[[service.replicas]]",
    "id = 2",
    NARRATIVE[5],
    "",
  ].join("\n");
}

const IN_STRING_LINES = [
  'url = "http://host/path#fragment"',
  "pattern = 'a # b'",
  "# not a comment, inside a multi-line string",
  "# neither is this",
];

function assertStripped(updated: string, original: string, label: string): void {
  const lines = updated.split("\n");
  expect(lines[0], `${label}: line-1 #:schema`).toBe(SCHEMA_LINE);
  expect(lines, `${label}: late #:schema`).toContain(LATE_SCHEMA_LINE);
  const keptNarrative = NARRATIVE.filter((n) => lines.includes(n));
  expect(keptNarrative.length, `${label}: kept ${keptNarrative.join(" | ")}`).toBeLessThanOrEqual(2);
  const hashLines = (t: string) => t.split("\n").filter((l) => /#/.test(l)).length;
  expect(hashLines(updated), `${label}: comments removed`).toBeLessThan(hashLines(original) - 4);
  expect(updated).not.toContain("narrative inside the array");
  for (const l of ["# not a comment, inside a multi-line string", "# neither is this", "pattern = 'a # b'"]) {
    expect(lines, `${label}: ${l}`).toContain(l);
  }
  expect(updated).toContain("http://host/path#fragment");
  for (let i = 0; i < 12; i++) expect(updated).toContain(`field_${i} = ${i}`);
  for (const h of ["[service]", "[[service.replicas]]"]) expect(lines).toContain(h);
  for (const l of lines) expect(l, `${label}: trailing whitespace`).toBe(l.trimEnd());
  for (const s of IN_STRING_LINES.slice(0, 1)) expect(updated).toContain(s);
  sameData(updated, original);
}

describe("AC-TOML-GUARD: guard Write of over-budget .toml strips narrative, keeps #:schema and string data", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-toml-guard-"));
  const tomlPath = path.join(tmpDir, "service.toml");

  it("exit 0; updatedInput.content stripped, parses to same data", async () => {
    const src = tomlBody();
    await assertParsesClean(src, "input fixture");

    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: tomlPath, content: src } },
      tmpDir,
    );
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;

    await assertParsesClean(updated, "guard updatedInput.content");
    assertStripped(updated, src, "guard");
    expect(hso.additionalContext as string).toContain("not another session's edit");
  });
});

describe("AC-TOML-GATE: gate Stop autofix of over-budget .toml — file fixed on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-toml-gate-"));
  const tomlPath = path.join(tmpDir, "repository.toml");

  it("gate removes narrative from disk; #:schema and in-string # survive; data unchanged", async () => {
    const src = tomlBody();
    await assertParsesClean(src, "gate input fixture");

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(tomlPath, src);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [tomlPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-toml-gate-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
      stop_hook_active: false,
    });
    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toBeDefined();
    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(ctx).toContain("not another session's edit");
    expect(ctx).toContain("repository.toml");

    const disk = readFileSync(tomlPath, "utf8");
    await assertParsesClean(disk, "gate disk result");
    assertStripped(disk, src, "gate");
  });
});
