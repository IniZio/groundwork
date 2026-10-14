import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/guard.js";
import type { Rule, Severity } from "../../src/engine/types.js";

// Unknown rule ids cannot be configured; comment-density is built in as an error rule.
const RULE_ID = "comment-density";
const MSG = "fake finding message";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guard-finding-sev-"));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "t@t.com");
  git("config", "user.name", "T");
  for (const [n, c] of Object.entries(files)) writeFileSync(path.join(dir, n), c);
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

function fakeRule(severity: Severity | undefined): Rule {
  return {
    id: RULE_ID,
    meta: { description: "fake" },
    check: () => [],
    editCheck: (edit) => ({
      findings: [{
        ruleId: RULE_ID, path: path.basename(edit.path), line: 1,
        message: MSG, fingerprintBasis: "x", ...(severity ? { severity } : {}),
      }],
    }),
  };
}

function hso(r: { stdout: string }): Record<string, unknown> {
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : {};
}

describe("guard per-finding severity", () => {
  it("a Write finding tagged warn under an error rule warns instead of denying", async () => {
    const dir = repo({});
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: "const x = 1;\n" } }, { rules: [fakeRule("warn")] });
      const h = hso(r);
      expect(h.permissionDecision).toBeUndefined();
      expect(h.additionalContext as string).toContain(`house-rules ${RULE_ID}: ${MSG}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("an Edit finding tagged warn under an error rule warns instead of denying", async () => {
    const dir = repo({ "a.ts": "const x = 1;\nconst y = 2;\n" });
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({
        tool_name: "Edit", cwd: dir,
        tool_input: { file_path: fp, old_string: "const y = 2;", new_string: "const y = 3;" },
      }, { rules: [fakeRule("warn")] });
      const h = hso(r);
      expect(h.permissionDecision).toBeUndefined();
      expect(h.additionalContext as string).toContain(`house-rules ${RULE_ID}: ${MSG}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("an untagged finding under an error rule still denies with its message", async () => {
    const dir = repo({});
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: "const x = 1;\n" } }, { rules: [fakeRule(undefined)] });
      const h = hso(r);
      expect(h.permissionDecision).toBe("deny");
      expect(h.additionalContext as string).toContain(MSG);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a finding tagged off under an error rule neither denies nor is reported", async () => {
    const dir = repo({});
    try {
      const fp = path.join(dir, "a.ts");
      const r = await check({ tool_name: "Write", cwd: dir, tool_input: { file_path: fp, content: "const x = 1;\n" } }, { rules: [fakeRule("off")] });
      expect(hso(r).permissionDecision).toBeUndefined();
      expect(r.stdout).not.toContain(MSG);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
