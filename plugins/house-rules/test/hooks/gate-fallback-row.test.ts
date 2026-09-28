import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findComments } from "../../src/hooks/lib/comment-density.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { run } from "../../src/hooks/gate.js";

const TS = parserForPath(getParser, "sample.ts");

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

async function firstErrorRowFor(content: string, lang: "typescript"): Promise<number | undefined> {
  const result = await findComments(content, lang, TS);
  if (result.errorRows.size === 0) return undefined;
  return Math.min(...result.errorRows) + 1;
}

// Case A: valid section rows 0-9 (3 comments at rows 2,5,8), then unclosed brace at row 10.
// Non-error-row comments: 3 in 15 total added rows = 20% density → violates 5/100 cap.
const CONTENT_A = [
  "const a0 = 0;",
  "const a1 = 1;",
  "// va2",
  "const a3 = 3;",
  "const a4 = 4;",
  "// va5",
  "const a6 = 6;",
  "const a7 = 7;",
  "// va8",
  "const a9 = 9;",
  "const x = {",
  "// ea11",
  "// ea12",
  "// ea13",
  "const y = 1;",
].join("\n") + "\n";

// Case B: valid section rows 0-4 (2 comments at rows 1,3), then unclosed brace at row 5.
const CONTENT_B = [
  "const b0 = 0;",
  "// vb1",
  "const b2 = 2;",
  "// vb3",
  "const b4 = 4;",
  "const x = {",
  "// eb6",
  "// eb7",
  "// eb8",
  "// eb9",
  "const y = 1;",
].join("\n") + "\n";

const cases: Array<{ label: string; content: string }> = [
  { label: "error-at-row-10", content: CONTENT_A },
  { label: "error-at-row-5", content: CONTENT_B },
];

describe("gate partial-row: parse error row in coverage", () => {
  for (const { label, content } of cases) {
    it(`gate blocks; coverage lists partially-checked file with error rows (${label})`, async () => {
      const expectedRow = await firstErrorRowFor(content, "typescript");
      expect(expectedRow, `expected an error row for ${label}`).toBeDefined();

      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "hr-partial-"));
      try {
        initGitRepo(tmpDir);
        const filePath = path.join(tmpDir, "target.ts");
        writeFileSync(filePath, content);

        const transcriptPath = makeTranscript(tmpDir, filePath, content);
        const sessionId = `test-partial-${label}`;

        const result = await run(
          {
            hook_event_name: "Stop",
            session_id: sessionId,
            transcript_path: transcriptPath,
            cwd: tmpDir,
          },
          process.env as Record<string, string | undefined>,
          {
            testOnly_tmpDir: tmpDir,
            testOnly_fixTableOverride: { typescript: { stability: "preview" } },
          } as any,
        );

        const out = JSON.parse(result.stdout.trim() || "{}") as Record<string, unknown>;
        expect(out.decision, `gate should block for ${label}`).toBe("block");

        const blockFilePath = path.join(tmpDir, "house-rules", sessionId, "stop-block.txt");
        const fullReport = readFileSync(blockFilePath, "utf8");

        expect(fullReport, `partially-checked line must appear for ${label}`)
          .toContain("partially checked:");
        expect(fullReport, `file name must appear in coverage for ${label}`)
          .toContain("target.ts");
        expect(fullReport, `error row ${expectedRow} must appear in coverage for ${label}`)
          .toContain(`${expectedRow}`);
        expect(fullReport, `old prefix-count notice must be absent for ${label}`)
          .not.toContain("prefix count used");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }

  it("two cases have different min error rows (hardcoded value cannot pass both)", async () => {
    const resultA = await findComments(CONTENT_A, "typescript", TS);
    const resultB = await findComments(CONTENT_B, "typescript", TS);
    expect(resultA.errorRows.size, "case A must have error rows").toBeGreaterThan(0);
    expect(resultB.errorRows.size, "case B must have error rows").toBeGreaterThan(0);
    const rowA = Math.min(...resultA.errorRows);
    const rowB = Math.min(...resultB.errorRows);
    expect(rowA, "case A and B must have different min error rows").not.toBe(rowB);
  });
});
