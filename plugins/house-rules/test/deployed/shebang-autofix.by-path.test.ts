// Shebang-routed extensionless bash autofix on guard Edit and gate Stop, spawned by path.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE = path.join(REPO, "src/hooks/gate.ts");

function spawnHook(script: string, payload: unknown, cwd: string) {
  const r = spawnSync("bun", [script], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/decoy/project/dir", CLAUDE_PLUGIN_ROOT: REPO },
    cwd,
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", status: r.status };
}

function git(dir: string, ...args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

function initRepo(dir: string): void {
  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(path.join(dir, ".gitkeep"), "");
  git(dir, "add", "-A");
  git(dir, "commit", "--allow-empty", "-m", "initial");
}

function makeTranscript(tmpDir: string, fp: string): string {
  const tp = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
    timestamp: new Date(Date.now() - 10000).toISOString(),
    cwd: tmpDir,
  });
  writeFileSync(tp, line + "\n");
  return tp;
}

const SHEBANG = "#!/usr/bin/env bash";
const NARRATIVE = [
  "# narrative comment one: this script provisions the scratch workspace for runs",
  "# narrative comment two: we clean the directory on every invocation for safety",
  "# narrative comment three: the retry count is read from the environment first",
  "# narrative comment four: the timeout is expressed in whole seconds not millis",
  "# narrative comment five: the exit code mirrors the last failing command here",
  "# narrative comment six: see the runbook for the failure handling procedure",
];
const CODE = Array.from({ length: 20 }, (_, i) => `field_${i}=${i}`);

function fullScript(withShebang: boolean): string {
  return [...(withShebang ? [SHEBANG] : []), "set -euo pipefail", ...CODE, "", ...NARRATIVE, "echo done", ""].join("\n");
}

function gateRun(withShebang: boolean) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "shebang-gate-"));
  initRepo(tmpDir);
  mkdirSync(path.join(tmpDir, "hooks"));
  const fp = path.join(tmpDir, "hooks", "commit-msg");
  writeFileSync(fp, fullScript(withShebang));
  const tp = makeTranscript(tmpDir, fp);
  const r = spawnHook(
    GATE,
    { hook_event_name: "Stop", session_id: `shebang-${Date.now()}`, transcript_path: tp, cwd: tmpDir, stop_hook_active: false },
    tmpDir,
  );
  return { r, disk: readFileSync(fp, "utf8") };
}

describe("SHEBANG-EDIT: guard Edit on extensionless shebang script", () => {
  const base = [SHEBANG, ...CODE, "MARK=1", ""].join("\n");
  const newString = ["MARK=1", ...NARRATIVE, 'echo "$1"'].join("\n");

  function editRun(withShebang: boolean) {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "shebang-edit-"));
    mkdirSync(path.join(tmpDir, "hooks"));
    const fp = path.join(tmpDir, "hooks", "commit-msg");
    writeFileSync(fp, withShebang ? base : base.split("\n").slice(1).join("\n"));
    return spawnHook(GUARD, { tool_name: "Edit", tool_input: { file_path: fp, old_string: "MARK=1", new_string: newString } }, tmpDir);
  }

  it("strips narrative from new_string", () => {
    const { stdout, status } = editRun(true);
    expect(status).toBe(0);
    const hso = (JSON.parse(stdout.trim()) as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    const ns = (hso.updatedInput as Record<string, unknown>).new_string as string;
    for (const line of NARRATIVE) expect(ns).not.toContain(line);
    expect(ns.split("\n").filter((l) => l !== "")).toEqual(["MARK=1", 'echo "$1"']);
  });

  it("control: no shebang, no extension is untouched", () => {
    const { stdout, status } = editRun(false);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});

describe("SHEBANG-GATE: gate Stop on extensionless shebang script", () => {
  it("trims narrative on disk and keeps the shebang line", () => {
    const { r, disk } = gateRun(true);
    expect(r.status).toBe(0);
    const ctx = ((JSON.parse(r.stdout.trim()) as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(disk.split("\n")[0]).toBe(SHEBANG);
    for (const line of NARRATIVE) expect(disk).not.toContain(line);
    for (let i = 0; i < 20; i++) expect(disk).toContain(`field_${i}=${i}`);
  });

  it("control: no shebang, no extension is left unchanged", () => {
    const { disk } = gateRun(false);
    expect(disk).toBe(fullScript(false));
  });
});
