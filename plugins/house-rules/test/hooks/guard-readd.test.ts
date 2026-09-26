import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../../src/hooks/guard.js";
import { appendFix } from "../../src/hooks/lib/autofix-ledger.js";

let ledgerDir: string;

beforeEach(() => {
  ledgerDir = mkdtempSync(path.join(os.tmpdir(), "guard-readd-test-"));
});

afterEach(() => {
  rmSync(ledgerDir, { recursive: true, force: true });
});

// 100 code lines + 1 comment → budget = floor(0.05*101) = 5 → within budget
function withinBudgetContent(comment: string): string {
  const lines = Array.from({ length: 100 }, (_, i) => `const v${i} = ${i};`);
  lines.push(comment);
  return lines.join("\n");
}

// 5 code lines + 6 comments → budget = floor(0.05*11) = 0 → over budget
function overBudgetContent(matchingComment: string): string {
  const lines = Array.from({ length: 5 }, (_, i) => `const c${i} = ${i};`);
  for (let i = 0; i < 5; i++) lines.push(`// filler comment ${i}`);
  lines.push(matchingComment);
  return lines.join("\n");
}

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

const COMMENT_LINE = "// retry three times because the API flakes";
const COMMENT_BLOCK = "/* retry three times because the API flakes */";

describe("guard re-add detection", () => {
  it("within-budget Write matching ledger comment emits advisory with re-add message, no permissionDecision", async () => {
    const fileDir = mkdtempSync(path.join(os.tmpdir(), "guard-readd-f1-"));
    const filePath = path.join(fileDir, "example.ts");

    appendFix(
      { file: filePath, fixedContent: "x", removed: [COMMENT_LINE], reason: "over-budget", source: "gate" },
      { dir: ledgerDir },
    );

    const r = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: withinBudgetContent(COMMENT_LINE) } },
      { ledgerDir },
    );

    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).not.toHaveProperty("permissionDecision");
    expect(hso).not.toHaveProperty("updatedInput");
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("removed from");
    expect(ctx!).toContain("over-budget");
    expect(ctx!).toContain("Fold the information into names");
  });

  it("within-budget Write matching ledger comment for different file → no re-add advisory", async () => {
    const fileDir = mkdtempSync(path.join(os.tmpdir(), "guard-readd-f2-"));
    const filePath = path.join(fileDir, "example.ts");
    const otherFile = path.join(fileDir, "other.ts");

    // ledger record for otherFile only (not filePath)
    appendFix(
      { file: otherFile, fixedContent: "x", removed: [COMMENT_LINE], reason: "over-budget", source: "gate" },
      { dir: ledgerDir },
    );

    const rWithRecord = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: withinBudgetContent(COMMENT_LINE) } },
      { ledgerDir },
    );
    expect(rWithRecord.stdout).toBe("");
    expect(rWithRecord.stdout).not.toContain("removed from");
    expect(rWithRecord.stdout).not.toContain("Fold the information");

    appendFix(
      { file: filePath, fixedContent: "x", removed: [COMMENT_LINE], reason: "over-budget", source: "gate" },
      { dir: ledgerDir },
    );
    const rWithTargetRecord = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: withinBudgetContent(COMMENT_LINE) } },
      { ledgerDir },
    );
    const ctx = safeContext(rWithTargetRecord);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("removed from");
  });

  it("over-budget Write matching ledger comment → message contains both budget text and re-add line", async () => {
    const fileDir = mkdtempSync(path.join(os.tmpdir(), "guard-readd-f3-"));
    const filePath = path.join(fileDir, "example.ts");

    appendFix(
      { file: filePath, fixedContent: "x", removed: [COMMENT_LINE], reason: "over-budget", source: "gate" },
      { dir: ledgerDir },
    );

    const r = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: overBudgetContent(COMMENT_LINE) } },
      { ledgerDir },
    );

    expect(r.exit).toBe(0);
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    // normal budget text
    expect(ctx!).toContain("comment-density");
    // re-add line
    expect(ctx!).toContain("removed from");
    expect(ctx!).toContain("Fold the information into names");
  });

  it("block comment variant matches line comment in ledger (normalizeCommentText)", async () => {
    const fileDir = mkdtempSync(path.join(os.tmpdir(), "guard-readd-f4-"));
    const filePath = path.join(fileDir, "example.ts");

    // ledger has the // form, Write uses /* */ form
    appendFix(
      { file: filePath, fixedContent: "x", removed: [COMMENT_LINE], reason: "over-budget", source: "gate" },
      { dir: ledgerDir },
    );

    const r = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: withinBudgetContent(COMMENT_BLOCK) } },
      { ledgerDir },
    );

    expect(r.exit).toBe(0);
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("removed from");
    expect(ctx!).toContain("Fold the information into names");
  });
});
