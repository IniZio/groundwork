import { describe, it, expect, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionBase, touchedFiles, addedRanges } from "../../src/hooks/lib/work-scope.js";

const FIXTURES = path.join(
  import.meta.dir,
  "../fixtures/work-scope",
);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const tmpRoots: string[] = [];
function tmpDir(label: string): string {
  const d = path.join(os.tmpdir(), `gw-ws-${label}-${Date.now()}`);
  mkdirSync(d, { recursive: true });
  tmpRoots.push(d);
  return d;
}

afterEach(() => {
  for (const r of tmpRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ }
  }
  tmpRoots.length = 0;
});

function initRepo(dir: string): void {
  execSync("command git init", { cwd: dir, shell: "/bin/bash" });
  execSync('command git config user.email "t@t.com"', { cwd: dir, shell: "/bin/bash" });
  execSync('command git config user.name "T"', { cwd: dir, shell: "/bin/bash" });
}

function commit(dir: string, msg: string, date: string): string {
  execSync("command git add -A", { cwd: dir, shell: "/bin/bash" });
  execSync(`GIT_COMMITTER_DATE="${date}" command git commit -m "${msg}" --date="${date}"`, {
    cwd: dir,
    shell: "/bin/bash",
  });
  return execSync("command git rev-parse HEAD", { cwd: dir, shell: "/bin/bash" })
    .toString()
    .trim();
}

function makeTranscript(ts: string): string {
  return JSON.stringify({ type: "user", timestamp: ts, uuid: "t1" }) + "\n";
}

// ---------------------------------------------------------------------------
// AC1: Base selection
// ---------------------------------------------------------------------------
describe("sessionBase — selects newest commit before first transcript timestamp", () => {
  it("returns commit A when B and C are after the transcript timestamp", () => {
    const repo = tmpDir("base-sel");
    initRepo(repo);
    writeFileSync(path.join(repo, "a.txt"), "a");
    const shaA = commit(repo, "A", "2026-09-04T16:00:00+00:00");
    writeFileSync(path.join(repo, "b.txt"), "b");
    commit(repo, "B", "2026-09-04T17:00:00+00:00");
    writeFileSync(path.join(repo, "c.txt"), "c");
    commit(repo, "C", "2026-09-04T18:00:00+00:00");

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeTranscript("2026-09-04T16:49:08.861Z"));

    expect(sessionBase(tp, repo)).toBe(shaA);
  });

  it("bite: returning HEAD causes failure when HEAD is after transcript", () => {
    const repo = tmpDir("base-bite");
    initRepo(repo);
    writeFileSync(path.join(repo, "a.txt"), "a");
    const shaA = commit(repo, "A", "2026-09-04T16:00:00+00:00");
    writeFileSync(path.join(repo, "b.txt"), "b");
    commit(repo, "B", "2026-09-04T17:00:00+00:00");

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeTranscript("2026-09-04T16:49:08.861Z"));

    expect(sessionBase(tp, repo)).toBe(shaA);
  });
});

// ---------------------------------------------------------------------------
// AC2: No earlier commit → empty-tree base
// ---------------------------------------------------------------------------
describe("sessionBase — no earlier commit", () => {
  it("returns empty-tree sha when all commits are after transcript", () => {
    const repo = tmpDir("base-empty");
    initRepo(repo);
    writeFileSync(path.join(repo, "a.txt"), "a");
    commit(repo, "A", "2026-09-04T17:00:00+00:00");

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeTranscript("2026-09-04T16:00:00.000Z"));

    expect(sessionBase(tp, repo)).toBe(EMPTY_TREE);
  });
});

// ---------------------------------------------------------------------------
// AC3: Touched files — Edit/Write from transcript + subagent union
// ---------------------------------------------------------------------------
describe("touchedFiles — Stop collects main and subagent transcripts", () => {
  it("includes file edited only by subagent", () => {
    const projDir = tmpDir("touched-stop");
    const sessionId = "04e59890-test-fixture";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      readFileSync(path.join(FIXTURES, "main-session.jsonl"), "utf8"),
    );

    const subDir = path.join(projDir, sessionId, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "agent-a1c91dbbbd1dd83be.jsonl"),
      readFileSync(path.join(FIXTURES, "subagent.jsonl"), "utf8"),
    );

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
    });

    expect(files).toContain(
      "/home/newman/.local/share/groundwork/hooks/lib/motive-map.mjs",
    );
    expect(files).toContain(
      "/tmp/claude-1003/-home-newman--local-share-groundwork/04e59890-9dba-48b8-8bbc-5406dfc81bc2/scratchpad/ledger-seed.json",
    );
  });

  it("bite: without subagent union, subagent-only file is absent", () => {
    const projDir = tmpDir("touched-bite");
    const sessionId = "04e59890-bite-test";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      readFileSync(path.join(FIXTURES, "main-session.jsonl"), "utf8"),
    );

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
    });

    expect(files).not.toContain(
      "/home/newman/.local/share/groundwork/hooks/lib/motive-map.mjs",
    );
  });

  it("SubagentStop reads only agentTranscriptPath", () => {
    const projDir = tmpDir("touched-subagentstop");
    const subFile = path.join(projDir, "agent-sub.jsonl");
    writeFileSync(
      subFile,
      readFileSync(path.join(FIXTURES, "subagent.jsonl"), "utf8"),
    );

    const files = touchedFiles({
      event: "SubagentStop",
      transcriptPath: path.join(projDir, "main.jsonl"),
      sessionId: "irrelevant",
      agentTranscriptPath: subFile,
    });

    expect(files).toContain(
      "/home/newman/.local/share/groundwork/hooks/lib/motive-map.mjs",
    );
  });
});

// ---------------------------------------------------------------------------
// AC4: Added ranges — exact line numbers across committed + uncommitted
// ---------------------------------------------------------------------------
describe("addedRanges — returns exact 1-based line numbers added since base", () => {
  it("returns committed and uncommitted added lines with exact numbers", () => {
    const repo = tmpDir("added-ranges");
    initRepo(repo);

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\nline4\nline5\n");
    commit(repo, "add lines 4-5", "2026-09-01T11:00:00+00:00");

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\nline4\nline5\nline6\n");

    const ranges = addedRanges(path.join(repo, "f.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([4, 5, 6]);
  });

  it("bite: HEAD-only diff misses committed lines — addedRanges must return [4,5,6]", () => {
    const repo = tmpDir("added-bite");
    initRepo(repo);

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\nline4\nline5\n");
    commit(repo, "add lines 4-5", "2026-09-01T11:00:00+00:00");

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\nline3\nline4\nline5\nline6\n");

    expect(addedRanges(path.join(repo, "f.ts"), base)).toEqual([4, 5, 6]);
  });

  it("untracked file — returns null when no transcript (fail-closed)", () => {
    const repo = tmpDir("untracked");
    initRepo(repo);

    writeFileSync(path.join(repo, "existing.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "new.ts"), "a\nb\nc\n");

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC5: Repo resolution — uses file's own repo, ignores CLAUDE_PROJECT_DIR
// ---------------------------------------------------------------------------
describe("addedRanges — repo resolution uses file's own repo", () => {
  it("decoy CLAUDE_PROJECT_DIR does not affect result", () => {
    const repo = tmpDir("repo-res");
    const decoyRepo = tmpDir("decoy");
    initRepo(repo);
    initRepo(decoyRepo);

    writeFileSync(path.join(repo, "f.ts"), "line1\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "f.ts"), "line1\nline2\n");

    const prev = process.env.CLAUDE_PROJECT_DIR;
    try {
      process.env.CLAUDE_PROJECT_DIR = decoyRepo;
      const ranges = addedRanges(path.join(repo, "f.ts"), base);
      expect(ranges).not.toBeNull();
      expect(ranges).toContain(2);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prev;
    }
  });

  it("deleted file returns null", () => {
    const repo = tmpDir("deleted");
    initRepo(repo);

    writeFileSync(path.join(repo, "f.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const ranges = addedRanges(path.join(repo, "nonexistent.ts"), base);
    expect(ranges).toBeNull();
  });

  it("non-repo file returns null", () => {
    const dir = tmpDir("norepo");
    writeFileSync(path.join(dir, "f.ts"), "x\n");
    const ranges = addedRanges(path.join(dir, "f.ts"), EMPTY_TREE);
    expect(ranges).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bug B: Untracked pre-existing file — Edit touch → null (not all-added)
// ---------------------------------------------------------------------------
describe("addedRanges — untracked pre-existing file (Bug B)", () => {
  function makeAssistantToolUse(name: string, input: Record<string, unknown>): string {
    return JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content: [{ type: "tool_use", name, input }],
      },
    });
  }

  it("returns null when first touch is Edit (pre-existing untracked)", () => {
    const repo = tmpDir("bug-b-preexisting");
    initRepo(repo);
    writeFileSync(path.join(repo, "seed.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const file = path.join(repo, "draft.ts");
    writeFileSync(file, "line1\nline2\nline3\nline4\nline5\n");
    // NOT git-added — pre-existing untracked file

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeAssistantToolUse("Edit", { file_path: file }) + "\n");

    const ranges = addedRanges(file, base, tp);
    // Bite proof: if we comment out `if (!transcriptPath) return null` and the
    // transcriptPath branch, the old code returns [1,2,3,4,5] instead of null.
    // Perturb: comment out `if (!touch) return null` line → test goes red.
    expect(ranges).toBeNull();
  });

  it("bite: old behavior (no transcript) returns all lines for untracked", () => {
    const repo = tmpDir("bug-b-bite");
    initRepo(repo);
    writeFileSync(path.join(repo, "seed.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const file = path.join(repo, "draft.ts");
    writeFileSync(file, "line1\nline2\nline3\n");

    // No transcriptPath → fail-closed → null (new behavior)
    const ranges = addedRanges(file, base);
    expect(ranges).toBeNull();
  });

  it("returns all line numbers when first touch is Write (session-created)", () => {
    const repo = tmpDir("bug-b2-session-created");
    initRepo(repo);
    writeFileSync(path.join(repo, "seed.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const file = path.join(repo, "new.ts");
    writeFileSync(file, "alpha\nbeta\ngamma\n");

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeAssistantToolUse("Write", { file_path: file }) + "\n");

    const ranges = addedRanges(file, base, tp);
    expect(ranges).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe("addedRanges — mv/cp from committed source (Bug C)", () => {
  function makeAssistantBash(cmd: string): string {
    return JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }],
      },
    });
  }

  it("mv of committed file: only changed lines returned, not all 20", () => {
    const repo = tmpDir("bug-c-mv");
    initRepo(repo);

    const origLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFileSync(path.join(repo, "original.ts"), origLines);
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const newFile = path.join(repo, "new.ts");
    const modifiedLines = Array.from({ length: 20 }, (_, i) => {
      if (i === 17) return "changed-line18";
      if (i === 18) return "changed-line19";
      return `line${i + 1}`;
    }).join("\n") + "\n";
    writeFileSync(newFile, modifiedLines);

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeAssistantBash(`mv original.ts ${newFile}`) + "\n");

    const ranges = addedRanges(newFile, base, tp);
    expect(ranges).not.toBeNull();
    expect(ranges).toContain(18);
    expect(ranges).toContain(19);
    expect(ranges).not.toContain(1);
    expect(ranges).not.toContain(10);
    expect(ranges).not.toContain(20);
  });

  it("mv of committed file: identical content → empty added ranges", () => {
    const repo = tmpDir("bug-c-mv-identical");
    initRepo(repo);

    const origLines = "line1\nline2\nline3\n";
    writeFileSync(path.join(repo, "src.ts"), origLines);
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    const newFile = path.join(repo, "dest.ts");
    writeFileSync(newFile, origLines);

    const tp = path.join(repo, "transcript.jsonl");
    writeFileSync(tp, makeAssistantBash(`mv src.ts ${newFile}`) + "\n");

    const ranges = addedRanges(newFile, base, tp);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC6: git mv rename detection
// ---------------------------------------------------------------------------
describe("addedRanges — git mv rename detection", () => {
  it("git mv uncommitted: identical content → empty added ranges", () => {
    const repo = tmpDir("gitmv-identical");
    initRepo(repo);

    writeFileSync(path.join(repo, "old.ts"), "line1\nline2\nline3\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    execSync("command git mv old.ts new.ts", { cwd: repo, shell: "/bin/bash" });

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([]);
  });

  it("git mv + appended 5-line block → exactly those 5 rows", () => {
    const repo = tmpDir("gitmv-appended");
    initRepo(repo);

    const origLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFileSync(path.join(repo, "old.ts"), origLines);
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    execSync("command git mv old.ts new.ts", { cwd: repo, shell: "/bin/bash" });
    writeFileSync(path.join(repo, "new.ts"), origLines + "extra1\nextra2\nextra3\nextra4\nextra5\n");

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([11, 12, 13, 14, 15]);
  });

  it("git mv + commit: rename committed after base → empty added ranges", () => {
    const repo = tmpDir("gitmv-committed");
    initRepo(repo);

    writeFileSync(path.join(repo, "old.ts"), "line1\nline2\nline3\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    execSync("command git mv old.ts new.ts", { cwd: repo, shell: "/bin/bash" });
    commit(repo, "rename", "2026-09-01T11:00:00+00:00");

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([]);
  });

  it("mv + git add: staged rename → empty added ranges", () => {
    const repo = tmpDir("mv-gitadd");
    initRepo(repo);

    writeFileSync(path.join(repo, "old.ts"), "line1\nline2\nline3\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    execSync("mv old.ts new.ts && command git add new.ts", { cwd: repo, shell: "/bin/bash" });

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([]);
  });

  it("new tracked file (git add): all rows added", () => {
    const repo = tmpDir("new-tracked");
    initRepo(repo);

    writeFileSync(path.join(repo, "existing.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "new.ts"), "alpha\nbeta\ngamma\n");
    execSync("command git add new.ts", { cwd: repo, shell: "/bin/bash" });

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).not.toBeNull();
    expect(ranges).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
describe("touchedFiles — Bash heredoc file write is captured", () => {
  it("cat > evals.json <<EOF in fixture is included", () => {
    const projDir = tmpDir("bash-heredoc");
    const sessionId = "6d597c7e-bash-test";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      readFileSync(path.join(FIXTURES, "main-session.jsonl"), "utf8"),
    );
    mkdirSync(path.join(projDir, sessionId, "subagents"), { recursive: true });

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
    });

    expect(files).toContain(
      "/home/newman/.local/share/groundwork/.claude/skills/release/evals/evals.json",
    );
  });

  it("bite: evals.json is absent when using a transcript with no Bash entries", () => {
    const projDir = tmpDir("bash-bite");
    const sessionId = "bash-bite-session";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      readFileSync(path.join(FIXTURES, "subagent.jsonl"), "utf8"),
    );
    mkdirSync(path.join(projDir, sessionId, "subagents"), { recursive: true });

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
    });

    expect(files).not.toContain(
      "/home/newman/.local/share/groundwork/.claude/skills/release/evals/evals.json",
    );
  });
});
