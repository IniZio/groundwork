// Bash autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

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
  const r = await parseText(content, "bash", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING rows: ${[...r.errorRows].join(",")}`).toBe(0);
    r.tree.delete();
  }
}

function assertBashN(content: string, label: string): void {
  const r = spawnSync("bash", ["-n"], { input: content, encoding: "utf8" });
  expect(r.status, `${label}: bash -n: ${r.stderr}`).toBe(0);
}

const NARRATIVE = [
  "# narrative comment one: this script provisions the scratch workspace for runs",
  "# narrative comment two: we clean the directory on every invocation for safety",
  "# narrative comment three: the retry count is read from the environment first",
  "# narrative comment four: the timeout is expressed in whole seconds not millis",
  "# narrative comment five: the exit code mirrors the last failing command here",
  "# narrative comment six: see the runbook for the failure handling procedure",
];

const HAZARDS = [
  'echo "${1#*/}"',
  'echo "argc=$#"',
  "echo \"a # inside a string\"",
  "case \"$1\" in",
  "  '#') echo literal ;;",
  "esac",
  "cat > out.json <<'EOF'",
  "# heredoc data one",
  "{}",
  "EOF",
  "cat <<-'EOT'",
  "\t# tab heredoc data",
  "\tEOT",
];

const MARKERS = ["#!/usr/bin/env bash", "# shellcheck disable=SC2086", "# vim: set ts=2 sw=2 et :"];

const SCRIPT_OVER_BUDGET = [
  MARKERS[0],
  MARKERS[1],
  MARKERS[2],
  "set -euo pipefail",
  ...Array.from({ length: 20 }, (_, i) => `field_${i}=${i}`),
  "",
  ...NARRATIVE,
  "",
  "run() {",
  "  if [ -n \"$1\" ]; then",
  "    # narrative comment between then and its body",
  '    echo "$1"',
  "  fi",
  "  # narrative comment at the last line of the function",
  "}",
  "",
  ...HAZARDS,
].join("\n");

function assertStripped(out: string, label: string): void {
  const lines = out.split("\n");
  const budget = Math.floor(lines.length * 0.05);
  const leftover = lines.filter((l) => l.includes("narrative comment"));
  expect(leftover.length, `${label}: ${leftover.join(" | ")}`).toBeLessThanOrEqual(budget);
  expect(leftover.length, label).toBeLessThan(8);
  expect(lines.filter((l) => l.startsWith("#")), label).toEqual([
    ...MARKERS,
    "# heredoc data one",
  ]);
  for (let i = 0; i < 20; i++) expect(out, label).toContain(`field_${i}=${i}`);
  const start = lines.indexOf(HAZARDS[0]);
  expect(start, label).toBeGreaterThan(0);
  expect(lines.slice(start, start + HAZARDS.length), label).toEqual(HAZARDS);
  expect(out, label).toContain("run() {");
  expect(out, label).toContain('    echo "$1"');
  assertBashN(out, label);
}

describe("AC-BASH-GUARD: guard Write of over-budget .sh strips narrative, keeps directives and hazards", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-guard-"));
  const shPath = path.join(tmpDir, "provision.sh");

  it("exit 0; updatedInput.content stripped, parses clean, bash -n ok", async () => {
    await assertParsesClean(SCRIPT_OVER_BUDGET, "input fixture");
    assertBashN(SCRIPT_OVER_BUDGET, "input fixture");

    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: shPath, content: SCRIPT_OVER_BUDGET } },
      tmpDir,
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;

    await assertParsesClean(updated, "guard updatedInput.content");
    assertStripped(updated, "guard .sh");
    expect(hso.additionalContext as string).toContain("not another session's edit");
  });
});

describe("AC-BASH-EXTENSIONLESS: guard Write of shebang-detected extensionless script (hooks/commit-msg)", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-noext-"));
  const hookPath = path.join(tmpDir, "hooks", "commit-msg");

  it("shebang on first line of Write content routes to bash and strips", async () => {
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: hookPath, content: SCRIPT_OVER_BUDGET } },
      tmpDir,
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;
    assertStripped(updated, "guard extensionless");
  });

  it("no shebang and no extension is not bash: passes through untouched", async () => {
    const noShebang = SCRIPT_OVER_BUDGET.split("\n").slice(1).join("\n");
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: hookPath, content: noShebang } },
      tmpDir,
    );
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});

describe("AC-BASH-EDIT: guard Edit on existing .sh strips over-budget prose added by the edit", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-edit-"));
  const shPath = path.join(tmpDir, "edit.sh");
  const base = ["#!/usr/bin/env bash", ...Array.from({ length: 20 }, (_, i) => `f${i}=${i}`), "MARK=1", ""].join("\n");

  it("exit 0; new_string prose removed, code and directive kept", async () => {
    writeFileSync(shPath, base);
    const newString = ["MARK=1", ...NARRATIVE, "echo \"${1#*/}\""].join("\n");
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Edit", tool_input: { file_path: shPath, old_string: "MARK=1", new_string: newString } },
      tmpDir,
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    const ns = (hso.updatedInput as Record<string, unknown>).new_string as string;
    for (const line of NARRATIVE) expect(ns).not.toContain(line);
    expect(ns.split("\n").filter((l) => l !== "")).toEqual(["MARK=1", 'echo "${1#*/}"']);
  });
});

describe("AC-BASH-GATE: gate Stop autofix of over-budget .sh — file fixed on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-gate-"));
  const shPath = path.join(tmpDir, "deploy.sh");

  it("removes narrative from disk; directives and hazards survive; stdout reports autofix", async () => {
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    writeFileSync(shPath, SCRIPT_OVER_BUDGET);

    const tp = makeTranscript(tmpDir, [shPath], new Date(Date.now() - 10000).toISOString());
    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-bash-gate-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
      stop_hook_active: false,
    });
    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");
    const ctx = (parsed.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(ctx).toContain("not another session's edit");
    expect(ctx).toContain("deploy.sh");

    const disk = readFileSync(shPath, "utf8");
    await assertParsesClean(disk, "gate disk result");
    assertStripped(disk, "gate .sh");
  });
});

describe("AC-BASH-UNDER: guard Write of under-budget .sh passes through with empty stdout", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-bash-under-"));

  it("exit 0; stdout empty", async () => {
    const { stdout, exit } = await spawnGuard(
      {
        tool_name: "Write",
        tool_input: { file_path: path.join(tmpDir, "simple.sh"), content: "#!/bin/bash\necho hi\n" },
      },
      tmpDir,
    );
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
