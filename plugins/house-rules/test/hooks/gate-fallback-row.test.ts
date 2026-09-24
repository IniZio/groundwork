import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findComments } from "../../src/hooks/lib/comment-density.js";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "test@test.com"], opts);
  spawnSync("git", ["config", "user.name", "Test"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], opts);
}

function makeTranscript(tmpDir: string, filePath: string, content: string): string {
  const transcriptPath = path.join(tmpDir, "transcript.jsonl");
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: filePath, content } }],
    },
    timestamp: new Date().toISOString(),
    cwd: tmpDir,
  });
  writeFileSync(transcriptPath, line + "\n");
  return transcriptPath;
}

function runGate(payload: unknown, repoDir: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoDir },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

async function firstErrorRowFor(content: string, lang: "typescript" | "yaml"): Promise<number | undefined> {
  const result = await findComments(content, lang);
  if (result.ok || result.errorRows.size === 0) return undefined;
  return Math.min(...result.errorRows) + 1;
}

// Case A: unclosed brace at row 0 — error zone covers the whole file
const CONTENT_A =
  "const x = {\n" +
  "// ca1\n" +
  "// ca2\n" +
  "// ca3\n" +
  "// ca4\n" +
  "// ca5\n" +
  "const y = 1;\n";

// Case B: valid preamble (rows 0-2) then unclosed brace at row 3 — error starts at row 3
const CONTENT_B =
  "const a = 1;\n" +
  "const b = 2;\n" +
  "const c = 3;\n" +
  "const x = {\n" +
  "// cb4\n" +
  "// cb5\n" +
  "// cb6\n" +
  "// cb7\n" +
  "// cb8\n" +
  "// cb9\n" +
  "const y = 1;\n";

const cases: Array<{ label: string; content: string }> = [
  { label: "error-at-row-0", content: CONTENT_A },
  { label: "error-at-row-3", content: CONTENT_B },
];

describe("gate fallback-row: parse error row in notice", () => {
  for (const { label, content } of cases) {
    it(`emits :<row>: in fallback notice (${label})`, async () => {
      const expectedRow = await firstErrorRowFor(content, "typescript");
      expect(expectedRow, `expected an error row for ${label}`).toBeDefined();

      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "hr-fbrow-"));
      try {
        initGitRepo(tmpDir);
        const filePath = path.join(tmpDir, "target.ts");
        writeFileSync(filePath, content);

        const transcriptPath = makeTranscript(tmpDir, filePath, content);
        const result = runGate(
          {
            hook_event_name: "Stop",
            session_id: `test-fbrow-${label}`,
            transcript_path: transcriptPath,
            cwd: tmpDir,
          },
          tmpDir,
        );

        const out = result.stdout.trim();
        const parsed = out ? (JSON.parse(out) as Record<string, unknown>) : {};
        const reason = typeof parsed.reason === "string" ? parsed.reason : "";

        expect(reason, `gate should block for ${label}`).toContain("parse error — prefix count used");
        expect(reason, `row ${expectedRow} should appear in notice for ${label}`).toContain(
          `target.ts:${expectedRow}: parse error — prefix count used`,
        );
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  it("two cases have different first error rows (hardcoded value cannot pass both)", async () => {
    const rowA = await firstErrorRowFor(CONTENT_A, "typescript");
    const rowB = await firstErrorRowFor(CONTENT_B, "typescript");
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA).not.toBe(rowB);
  });
});
