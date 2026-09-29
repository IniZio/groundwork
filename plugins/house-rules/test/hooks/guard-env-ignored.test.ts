import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(PLUGIN_ROOT, "src/hooks/guard.ts");
const PRELOAD = path.join(PLUGIN_ROOT, "test/seams/fail-grammars.preload.ts");

const OVER_CAP_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// comment one",
  "// comment two",
  "// comment three",
  "// comment four",
  "// comment five",
].join("\n");

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function runGuard(preload: boolean): { status: number | null; updatedInput: boolean } {
  const project = mkdtempSync(path.join(os.tmpdir(), "guard-env-proj-"));
  const tmp = mkdtempSync(path.join(os.tmpdir(), "guard-env-tmp-"));
  tmpDirs.push(project, tmp);
  const payload = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(project, "over-cap.ts"), content: OVER_CAP_25 },
    session_id: "test-env-ignored",
    transcript_path: path.join(project, "nonexistent.jsonl"),
    cwd: project,
  };
  const proc = spawnSync("bun", [...(preload ? ["--preload", PRELOAD] : []), GUARD], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: project,
    timeout: 30_000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
      TMPDIR: tmp,
      HOUSE_RULES_TEST_FAIL_GRAMMARS: "typescript",
    },
  });
  const out = (proc.stdout ?? "").trim();
  const hso = out ? (JSON.parse(out).hookSpecificOutput ?? {}) : {};
  return { status: proc.status, updatedInput: "updatedInput" in hso };
}

describe("guard ignores HOUSE_RULES_TEST_FAIL_GRAMMARS without preload", () => {
  it("env set, no preload: over-budget comments still corrected", () => {
    const r = runGuard(false);
    expect(r.status).toBe(0);
    expect(r.updatedInput).toBe(true);
  });

  it("control: env set with preload: grammar forced to fail, no correction", () => {
    const r = runGuard(true);
    expect(r.status).toBe(0);
    expect(r.updatedInput).toBe(false);
  });
});
