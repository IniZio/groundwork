/**
 * Parity test: comment-density Stop gate (addedHunks path) vs per-edit guard
 * (diffTextToHunks path) must agree on net-new comment counts.
 *
 * Part 1 — parity cases + autoFix conversion + E2E hooks.
 * Part 2 — red proofs are run separately in a /dev/shm copy; see bottom of file.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  netNewCommentRows,
  type Lang,
} from "../../src/hooks/lib/comment-density.js";
import { addedHunks, diffTextToHunks } from "../../src/hooks/lib/work-scope.js";
import { run } from "../../src/hooks/comment-density-gate.js";
import { check } from "../../src/hooks/comment-density-guard.js";

function gitRun(
  dir: string,
  args: string[],
  env?: Record<string, string>,
): void {
  spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function initGitRepo(dir: string): void {
  gitRun(dir, ["init"]);
  gitRun(dir, ["config", "user.email", "test@test.com"]);
  gitRun(dir, ["config", "user.name", "Test"]);
}

function gitCommitIn(
  dir: string,
  msg: string,
  dateOpts: { GIT_AUTHOR_DATE?: string; GIT_COMMITTER_DATE?: string } = {},
): string {
  gitRun(dir, ["add", "-A"]);
  gitRun(dir, ["commit", "--allow-empty", "-m", msg], dateOpts);
  const r = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  return r.stdout.trim();
}

function parseOut(stdout: string): Record<string, unknown> {
  const t = stdout.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}

async function assertParity(
  base: string,
  post: string,
  lang: Lang,
  expected: number,
  label: string,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-parity-"));
  try {
    initGitRepo(dir);
    const file = path.join(dir, "subject.ts");
    writeFileSync(file, base);
    gitCommitIn(dir, "base");
    const baseCommit = spawnSync(
      "git",
      ["-C", dir, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).stdout.trim();

    writeFileSync(file, post);

    // Gate path: addedHunks reads git diff --unified=0 vs committed base
    const gateHunks = addedHunks(file, baseCommit);
    expect(gateHunks, `${label}: addedHunks returned null`).not.toBeNull();

    // Guard path: diffTextToHunks writes temp files and runs git diff --unified=0
    const guardHunks = diffTextToHunks(base, post);

    const gateResult = await netNewCommentRows(base, post, lang, gateHunks!);
    const guardResult = await netNewCommentRows(base, post, lang, guardHunks);

    const gateOk = gateResult.ok;
    const guardOk = guardResult.ok;
    expect(gateOk, `${label}: gate netNewCommentRows failed`).toBe(true);
    expect(guardOk, `${label}: guard netNewCommentRows failed`).toBe(true);

    const gateCount = gateOk ? gateResult.rows.length : -1;
    const guardCount = guardOk ? guardResult.rows.length : -1;

    expect(gateCount, `${label}: gate count`).toBe(expected);
    expect(guardCount, `${label}: guard count`).toBe(expected);
    // Parity: the two paths must agree
    expect(gateCount, `${label}: gate≠guard`).toBe(guardCount);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

// ---------------------------------------------------------------------------
// Part 1a — parity cases
// ---------------------------------------------------------------------------

describe("comment-density parity (gate addedHunks path ↔ guard diffTextToHunks path)", () => {
  it("reword: committed comment reworded in-place → 0 net-new", async () => {
    const base = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      "// original why comment",
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
    ].join("\n") + "\n";
    const post = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      "// reworded why comment",
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
    ].join("\n") + "\n";
    await assertParity(base, post, "typescript", 0, "reword");
  });

  it("pure add: new comment appended to code-only base → 1 net-new", async () => {
    const base =
      Array.from({ length: 20 }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n";
    const post = base.trimEnd() + "\n// why this works\n";
    await assertParity(base, post, "typescript", 1, "pure-add");
  });

  it("reword + add: reworded existing + one genuinely new → 1 net-new", async () => {
    const base = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      "// original why",
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
    ].join("\n") + "\n";
    const post = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      "// reworded why",
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
      "// new genuinely fresh comment",
    ].join("\n") + "\n";
    await assertParity(base, post, "typescript", 1, "reword+add");
  });

  it(
    "line10 delete + line12 insert: separate hunks with -U0 both say 1 " +
      "(with default context they would merge → 0; this case catches -U0 regression)",
    async () => {
      // Base: 25 lines; line 10 (1-indexed) is a comment.
      // Post: delete base line 10; insert new comment at post line 12
      // (2 unchanged lines between the deletion and the insertion → gap ≤ 3*2=6
      //  so default context merges them into one hunk, pairing base-10 removal
      //  with post-12 addition → netNew=0 wrongly; -U0 keeps them in separate
      //  hunks → deletion hunk scores 0, insertion hunk scores 1, total=1).
      const base = [
        ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
        "// old comment",                                       // line 10
        ...Array.from({ length: 15 }, (_, i) => `const b${i} = ${i};`), // lines 11-25
      ].join("\n") + "\n";

      // Post construction:
      const post = [
        ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
        "const b0 = 0;",
        "const b1 = 1;",
        "// new comment",
        ...Array.from({ length: 13 }, (_, i) => `const b${i + 2} = ${i + 2};`),
      ].join("\n") + "\n";

      await assertParity(base, post, "typescript", 1, "line10-delete-line12-insert");
    },
  );

  it("deleted nothing added: removing a committed comment → 0 net-new", async () => {
    const base = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      "// existing comment",
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
    ].join("\n") + "\n";
    const post = [
      ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
      ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
    ].join("\n") + "\n";
    await assertParity(base, post, "typescript", 0, "deleted-nothing-added");
  });

  it(
    "exempt @ts-ignore removed + real comment added in same hunk → 1 " +
      "(exempt must not count on base side, so removal does not offset the addition)",
    async () => {
      const base = [
        ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
        "// @ts-ignore",
        ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
      ].join("\n") + "\n";
      const post = [
        ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
        "// real non-exempt comment",
        ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
      ].join("\n") + "\n";
      await assertParity(base, post, "typescript", 1, "exempt-no-pair");
    },
  );
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("gate 1-based→0-based conversion", () => {
  it(
    "autoFix with gate conversion strips the new comment (row 14) not its code neighbour (row 13)",
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-parity-conv-"));
      try {
        initGitRepo(dir);
        writeFileSync(path.join(dir, ".gitkeep"), "");
        gitCommitIn(dir, "init");
        const logR = spawnSync(
          "git",
          ["-C", dir, "log", "--format=%ct", "-1"],
          { encoding: "utf8" },
        );
        const baseEpoch = parseInt(logR.stdout.trim(), 10);

        const codeLines = Array.from({ length: 14 }, (_, i) => `const a${i} = ${i};`);
        const fileLines = [...codeLines, "// why this algorithm works"];
        const content = fileLines.join("\n") + "\n";
        const fp = path.join(dir, "algo.ts");
        writeFileSync(fp, content);

        const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
        const transcriptPath = path.join(dir, "transcript.jsonl");
        writeFileSync(
          transcriptPath,
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "Write",
                  input: { file_path: fp, content },
                },
              ],
            },
            timestamp: afterTs,
            cwd: dir,
          }) + "\n",
        );

        const r = await run(
          {
            hook_event_name: "Stop",
            session_id: `conv-${Date.now()}`,
            transcript_path: transcriptPath,
          },
          {},
          { testOnly_forceWrite: true },
        );
        const out = parseOut(r.stdout);

        expect(out.decision).not.toBe("block");

        const fixed = readFileSync(fp, "utf8");
        expect(fixed).not.toContain("// why this algorithm works");
        expect(fixed).toContain("const a13 = 13;");
      } finally {
        try { rmSync(dir, { recursive: true, force: true }); } catch { }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("E2E gate: reword of committed comment → allows", () => {
  it("gate run(): reword does not block", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-parity-e2e-gate-"));
    try {
      initGitRepo(dir);
      const baseLines = [
        ...Array.from({ length: 9 }, (_, i) => `const a${i} = ${i};`),
        "// original why comment",
        ...Array.from({ length: 10 }, (_, i) => `const b${i} = ${i};`),
      ];
      const fp = path.join(dir, "subject.ts");
      writeFileSync(fp, baseLines.join("\n") + "\n");
      gitCommitIn(dir, "add subject");
      const logR = spawnSync(
        "git",
        ["-C", dir, "log", "--format=%ct", "-1"],
        { encoding: "utf8" },
      );
      const baseEpoch = parseInt(logR.stdout.trim(), 10);

      const reworded = baseLines.map((l, i) =>
        i === 9 ? "// reworded why comment" : l,
      );
      writeFileSync(fp, reworded.join("\n") + "\n");

      const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
      const tp = path.join(dir, "transcript.jsonl");
      writeFileSync(
        tp,
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Edit",
                input: {
                  file_path: fp,
                  old_string: "// original why comment",
                  new_string: "// reworded why comment",
                },
              },
            ],
          },
          timestamp: afterTs,
          cwd: dir,
        }) + "\n",
      );

      const r = await run(
        {
          hook_event_name: "Stop",
          session_id: `e2e-gate-${Date.now()}`,
          transcript_path: tp,
        },
        {},
      );
      const out = parseOut(r.stdout);
      expect(out.decision).not.toBe("block");
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { }
    }
  });
});

describe("E2E guard: reword of committed comment → allows", () => {
  it("guard check(): reword returns empty stdout (allow)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-parity-e2e-guard-"));
    try {
      initGitRepo(dir);
      const file = path.join(dir, "subject.ts");
      const codeLines = Array.from(
        { length: 10 },
        (_, i) => `const c${i} = ${i};`,
      ).join("\n");
      const baseContent = `${codeLines}\n// why old\nconst z = 99;\n`;
      writeFileSync(file, baseContent);
      gitCommitIn(dir, "base", {
        GIT_AUTHOR_DATE: "2024-01-01T12:00:00+00:00",
        GIT_COMMITTER_DATE: "2024-01-01T12:00:00+00:00",
      });

      const transcript = path.join(dir, "transcript.jsonl");
      writeFileSync(
        transcript,
        JSON.stringify({ timestamp: "2024-01-02T12:00:00.000Z" }) + "\n",
      );

      const r = await check({
        tool_name: "Edit",
        tool_input: {
          file_path: file,
          old_string: "// why old",
          new_string: "// why new",
        },
        transcript_path: transcript,
        cwd: dir,
      });

      expect(r.stdout).toBe("");
      expect(r.exit).toBe(0);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { }
    }
  });
});
