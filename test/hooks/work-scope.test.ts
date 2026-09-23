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

  it("untracked file — all lines are added", () => {
    const repo = tmpDir("untracked");
    initRepo(repo);

    writeFileSync(path.join(repo, "existing.ts"), "x\n");
    const base = commit(repo, "init", "2026-09-01T10:00:00+00:00");

    writeFileSync(path.join(repo, "new.ts"), "a\nb\nc\n");

    const ranges = addedRanges(path.join(repo, "new.ts"), base);
    expect(ranges).toEqual([1, 2, 3]);
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
// AC7: Bash file writes — heredoc cat > file parsed from real transcript line
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
