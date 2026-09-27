/**
 * Tests for guard.ts edit-check behaviours:
 *   AC4 — rule ordering (sort by id) + chaining (each rule sees prior rule's post)
 *   AC5 — parse-safety refusal of unparseable rewrites
 *   AC6 — entry-point parity (in-process vs subprocess)
 */

import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { check } from "../../src/hooks/guard.js";
import type { Rule, PendingEdit, EditCheckResult } from "../../src/engine/types.js";
import type { Language } from "../../src/hooks/languages/registry.js";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");

function getHso(r: { stdout: string }): Record<string, unknown> {
  const s = r.stdout.trim();
  if (!s) return {};
  const parsed = JSON.parse(s) as Record<string, unknown>;
  return (parsed.hookSpecificOutput as Record<string, unknown>) ?? {};
}

function safeContext(r: { stdout: string }): string | null {
  const hso = getHso(r);
  return typeof hso.additionalContext === "string" ? hso.additionalContext : null;
}

// ─── AC4: rule ordering + chaining ───────────────────────────────────────────

describe("AC4 rule ordering and chaining", () => {
  it("rules sorted by id: zz-second receives aa-first output; final content is GAMMA", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guard-routing-ac4-"));
    const filePath = path.join(tmpDir, "order-test.ts");
    const originalContent = 'export const v = "ALPHA";\n';

    let receivedBySecond: string | undefined;

    // Declared BEFORE aaFirst — but id "aa-first" sorts before "zz-second"
    const zzSecond: Rule = {
      id: "zz-second",
      meta: { description: "stub: replace BETA with GAMMA" },
      languages: ["typescript"] as readonly Language[],
      check: () => [],
      editCheck(edit: PendingEdit): EditCheckResult {
        receivedBySecond = edit.post;
        const idx = edit.post.indexOf("BETA");
        if (idx === -1) return { findings: [], edits: [] };
        return {
          findings: [],
          edits: [{ start: idx, end: idx + "BETA".length, text: "GAMMA" }],
          notice: "zz-second applied",
        };
      },
    };

    const aaFirst: Rule = {
      id: "aa-first",
      meta: { description: "stub: replace ALPHA with BETA" },
      languages: ["typescript"] as readonly Language[],
      check: () => [],
      editCheck(edit: PendingEdit): EditCheckResult {
        const idx = edit.post.indexOf("ALPHA");
        if (idx === -1) return { findings: [], edits: [] };
        return {
          findings: [],
          edits: [{ start: idx, end: idx + "ALPHA".length, text: "BETA" }],
          notice: "aa-first applied",
        };
      },
    };

    // Rules intentionally OUT of id-order — guard must sort them
    const r = await check(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: filePath, content: originalContent },
        session_id: "test-ac4",
        transcript_path: path.join(tmpDir, "nonexistent.jsonl"),
        cwd: tmpDir,
      },
      { readFile: () => null, rules: [zzSecond, aaFirst] },
    );

    // Identity assertion: zz-second must have seen the BETA text, not ALPHA
    expect(receivedBySecond).toBe('export const v = "BETA";\n');

    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    // Identity assertion on final content
    expect(ui.content).toBe('export const v = "GAMMA";\n');

    const ctx = safeContext(r);
    expect(ctx).toBe("aa-first applied\nzz-second applied");
  });
});

// ─── AC5: parse-safety refusal ───────────────────────────────────────────────

const AC5_RULE_ID = "stub-refuse-test";
const AC5_ORIGINAL = 'export const v = "ALPHA";\n';

describe("AC5 parse-safety refusal", () => {
  it("rewrite that makes TS unparseable is refused — no updatedInput, additionalContext has refusedNotice and guard refusal line", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guard-routing-ac5-"));
    const filePath = path.join(tmpDir, "parse-test.ts");

    const badRewriteRule: Rule = {
      id: AC5_RULE_ID,
      meta: { description: "stub: replace whole file with invalid TS" },
      languages: ["typescript"] as readonly Language[],
      check: () => [],
      editCheck(edit: PendingEdit): EditCheckResult {
        return {
          findings: [],
          edits: [{ start: 0, end: edit.post.length, text: "export const = = ;(" }],
          notice: "stub rewrote",
          refusedNotice: "stub refused",
        };
      },
    };

    const r = await check(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: filePath, content: AC5_ORIGINAL },
        session_id: "test-ac5-refuse",
        transcript_path: path.join(tmpDir, "nonexistent.jsonl"),
        cwd: tmpDir,
      },
      { readFile: () => null, rules: [badRewriteRule] },
    );

    const hso = getHso(r);
    expect(hso).not.toHaveProperty("updatedInput");

    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("stub refused");
    expect(ctx!).toContain(`house-rules edit guard: ${AC5_RULE_ID} rewrite refused`);
  });

  it("same rule with valid rewrite produces updatedInput — positive control proving guard can see positive case", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guard-routing-ac5b-"));
    const filePath = path.join(tmpDir, "parse-test.ts");

    const validRewriteRule: Rule = {
      id: AC5_RULE_ID,
      meta: { description: "stub: replace ALPHA with DELTA (valid TS)" },
      languages: ["typescript"] as readonly Language[],
      check: () => [],
      editCheck(edit: PendingEdit): EditCheckResult {
        const idx = edit.post.indexOf("ALPHA");
        if (idx === -1) return { findings: [], edits: [] };
        return {
          findings: [],
          edits: [{ start: idx, end: idx + "ALPHA".length, text: "DELTA" }],
          notice: "stub rewrote valid",
          refusedNotice: "stub refused",
        };
      },
    };

    const r = await check(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: filePath, content: AC5_ORIGINAL },
        session_id: "test-ac5-valid",
        transcript_path: path.join(tmpDir, "nonexistent.jsonl"),
        cwd: tmpDir,
      },
      { readFile: () => null, rules: [validRewriteRule] },
    );

    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(ui.content).toBe('export const v = "DELTA";\n');
  });
});

// ─── AC6: entry-point parity ─────────────────────────────────────────────────

const OVER_CAP_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// comment one",
  "// comment two",
  "// comment three",
  "// comment four",
  "// comment five",
].join("\n");

describe("AC6 entry point — real registry and subprocess parity", () => {
  it("(a) in-process: over-budget TS Write yields updatedInput with fewer comment lines; additionalContext contains removal notice", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guard-routing-ac6a-"));
    const filePath = path.join(tmpDir, "over-cap.ts");

    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: filePath, content: OVER_CAP_25 },
      session_id: "test-ac6a",
      transcript_path: path.join(tmpDir, "nonexistent.jsonl"),
      cwd: tmpDir,
    };

    const r = await check(payload);

    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    const content = ui.content as string;
    const commentCount = content.split("\n").filter(l => l.trim().startsWith("//")).length;
    expect(commentCount).toBeLessThan(5);

    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("groundwork comment-density: removed");
  });

  it("(b) subprocess stdin: same payload gives updatedInput with fewer comment lines", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "guard-routing-ac6b-"));
    const filePath = path.join(tmpDir, "over-cap.ts");

    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: filePath, content: OVER_CAP_25 },
      session_id: "test-ac6b",
      transcript_path: path.join(tmpDir, "nonexistent.jsonl"),
      cwd: tmpDir,
    };

    const proc = spawnSync(
      "bun",
      [path.join(PLUGIN_ROOT, "src/hooks/guard.ts")],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
        cwd: tmpDir,
        timeout: 30_000,
      },
    );

    expect(proc.status).toBe(0);

    const hso = getHso({ stdout: proc.stdout ?? "" });
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    const content = ui.content as string;
    const commentCount = content.split("\n").filter(l => l.trim().startsWith("//")).length;
    expect(commentCount).toBeLessThan(5);

    const ctx = safeContext({ stdout: proc.stdout ?? "" });
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("groundwork comment-density: removed");
  });
});
