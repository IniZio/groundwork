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
import { sessionBase, touchedFiles, addedRanges, addedHunks, diffTextToHunks, runningAgentIds } from "../../src/hooks/lib/work-scope.js";

const FIXTURES = path.join(
  import.meta.dir,
  "../fixtures/work-scope",
);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function extractEditFilePath(fixturePath: string): string {
  for (const line of readFileSync(fixturePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (obj.type !== "assistant") continue;
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    if (!Array.isArray(msg.content)) continue;
    for (const blk of msg.content as Record<string, unknown>[]) {
      if (blk.type !== "tool_use") continue;
      if (blk.name !== "Edit" && blk.name !== "Write") continue;
      const inp = blk.input as Record<string, unknown> | undefined;
      if (inp && typeof inp.file_path === "string") return inp.file_path;
    }
  }
  throw new Error(`No Edit/Write file_path found in ${fixturePath}`);
}

function extractBashCwdPath(fixturePath: string, filename: string): string {
  for (const line of readFileSync(fixturePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (obj.type !== "assistant" || typeof obj.cwd !== "string") continue;
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    if (!Array.isArray(msg.content)) continue;
    for (const blk of msg.content as Record<string, unknown>[]) {
      if (blk.type !== "tool_use" || blk.name !== "Bash") continue;
      const inp = blk.input as Record<string, unknown> | undefined;
      const cmd = inp && typeof inp.command === "string" ? inp.command : "";
      if (cmd.includes(filename)) return path.join(obj.cwd as string, filename);
    }
  }
  throw new Error(`No Bash entry for ${filename} found in ${fixturePath}`);
}

const SUBAGENT_MOTIVE_MAP_PATH = extractEditFilePath(path.join(FIXTURES, "subagent.jsonl"));
const MAIN_EVALS_JSON_PATH = extractBashCwdPath(path.join(FIXTURES, "main-session.jsonl"), "evals.json");

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

    expect(files).toContain(SUBAGENT_MOTIVE_MAP_PATH);
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

    expect(files).not.toContain(SUBAGENT_MOTIVE_MAP_PATH);
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

    expect(files).toContain(SUBAGENT_MOTIVE_MAP_PATH);
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

    expect(files).toContain(MAIN_EVALS_JSON_PATH);
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

    expect(files).not.toContain(MAIN_EVALS_JSON_PATH);
  });
});

describe("C-status copy", () => {
  it("addedRanges resolves copy source via C-status git diff and returns empty for identical copy", () => {
    const repo = tmpDir("c-status");
    initRepo(repo);

    writeFileSync(path.join(repo, "src.ts"), [
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
    ].join("\n") + "\n");
    const base = commit(repo, "base", "2026-01-01T00:00:00+00:00");

    const srcContent = readFileSync(path.join(repo, "src.ts"), "utf8");
    writeFileSync(path.join(repo, "dst.ts"), srcContent);
    writeFileSync(path.join(repo, "src.ts"), srcContent + "const d = 4;\n");
    commit(repo, "copy-and-modify-src", "2026-01-02T00:00:00+00:00");

    const transcriptPath = path.join(repo, "transcript.jsonl");
    writeFileSync(transcriptPath, makeTranscript("2026-01-01T12:00:00Z"));

    const result = addedRanges(path.join(repo, "dst.ts"), base, transcriptPath);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

});

// ---------------------------------------------------------------------------
// unified=0 parity: addedHunks and diffTextToHunks use same context
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// runningAgentIds — parsing background_tasks field
// ---------------------------------------------------------------------------
describe("runningAgentIds — parses Stop payload background_tasks", () => {
  it("returns ids where status is running and type is subagent", () => {
    const tasks = [
      { id: "abc123", type: "subagent", status: "running", description: "impl" },
      { id: "def456", type: "subagent", status: "completed", description: "done" },
    ];
    expect(runningAgentIds(tasks)).toEqual(["abc123"]);
  });

  it("includes entry missing type field (type absent treated as subagent)", () => {
    const tasks = [
      { id: "notype1", status: "running", description: "no type" },
      { id: "notype2", status: "completed" },
    ];
    expect(runningAgentIds(tasks)).toEqual(["notype1"]);
  });

  it("includes entry missing agent_type (agent_type is optional doc field)", () => {
    const tasks = [
      { id: "noagenttype", type: "subagent", status: "running" },
    ];
    expect(runningAgentIds(tasks)).toEqual(["noagenttype"]);
  });

  it("excludes entry with status completed", () => {
    const tasks = [
      { id: "done1", type: "subagent", status: "completed" },
    ];
    expect(runningAgentIds(tasks)).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(runningAgentIds(null)).toEqual([]);
    expect(runningAgentIds(undefined)).toEqual([]);
    expect(runningAgentIds("string")).toEqual([]);
    expect(runningAgentIds(42)).toEqual([]);
    expect(runningAgentIds({})).toEqual([]);
  });

  it("ignores malformed entries without throwing", () => {
    const tasks = [null, undefined, 42, "string", { id: "ok", status: "running" }];
    expect(() => runningAgentIds(tasks)).not.toThrow();
    expect(runningAgentIds(tasks)).toEqual(["ok"]);
  });

  it("handles real payload shape with type and agent_type fields", () => {
    const tasks = [
      { id: "a7c6723ff77026843", type: "subagent", status: "running", description: "impl", agent_type: "groundwork:implementer" },
      { id: "b8d9012ff88137954", type: "subagent", status: "completed", description: "done", agent_type: "groundwork:implementer" },
    ];
    expect(runningAgentIds(tasks)).toEqual(["a7c6723ff77026843"]);
  });
});

// ---------------------------------------------------------------------------
// touchedFiles — Stop with runningAgentIds exclusion
// ---------------------------------------------------------------------------
describe("touchedFiles — Stop excludes files from running agents", () => {
  function makeAgentLine(filePath: string): string {
    return JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-26T00:00:00Z",
      message: {
        content: [{ type: "tool_use", name: "Edit", input: { file_path: filePath } }],
      },
    }) + "\n";
  }

  it("running agent file excluded even when main transcript also touched it", () => {
    const projDir = tmpDir("running-excl-shared");
    const sessionId = "run-excl-sess-1";
    const sharedFile = "/repo/shared/both-touched.ts";
    const runningOnlyFile = "/repo/running/only-running.ts";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      makeAgentLine(sharedFile),
    );

    const subDir = path.join(projDir, sessionId, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "agent-runagent001.jsonl"),
      makeAgentLine(sharedFile) + makeAgentLine(runningOnlyFile),
    );

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
      runningAgentIds: ["runagent001"],
    });

    expect(files).not.toContain(sharedFile);
    expect(files).not.toContain(runningOnlyFile);
  });

  it("same fixture with runningAgentIds empty returns file included", () => {
    const projDir = tmpDir("running-empty-ids");
    const sessionId = "run-excl-sess-2";
    const sharedFile = "/repo/shared/included-when-empty.ts";

    writeFileSync(
      path.join(projDir, `${sessionId}.jsonl`),
      makeAgentLine(sharedFile),
    );

    const subDir = path.join(projDir, sessionId, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "agent-runagent002.jsonl"),
      makeAgentLine(sharedFile),
    );

    const filesEmpty = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
      runningAgentIds: [],
    });
    expect(filesEmpty).toContain(sharedFile);

    const filesOmitted = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
    });
    expect(filesOmitted).toContain(sharedFile);
  });

  it("finished agent files included while running agent files excluded", () => {
    const projDir = tmpDir("running-mixed-agents");
    const sessionId = "run-excl-sess-3";
    const finishedFile = "/repo/finished/agent-done.ts";
    const runningFile = "/repo/running/agent-still-going.ts";

    writeFileSync(path.join(projDir, `${sessionId}.jsonl`), "");

    const subDir = path.join(projDir, sessionId, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "agent-finishedagent01.jsonl"),
      makeAgentLine(finishedFile),
    );
    writeFileSync(
      path.join(subDir, "agent-runningagent01.jsonl"),
      makeAgentLine(runningFile),
    );

    const files = touchedFiles({
      event: "Stop",
      transcriptPath: path.join(projDir, `${sessionId}.jsonl`),
      sessionId,
      runningAgentIds: ["runningagent01"],
    });

    expect(files).toContain(finishedFile);
    expect(files).not.toContain(runningFile);
  });
});

describe("addedHunks / diffTextToHunks — unified=0 parity", () => {
  it("delete comment at line 10, add comment at line 12 → both produce 2 hunks", () => {
    const repo = tmpDir("unified-zero");
    initRepo(repo);

    // Base file: 15 lines, comment at line 10
    const baseLines = Array.from({ length: 15 }, (_, i) => {
      if (i === 9) return "// comment A";
      return `const x${i + 1} = ${i + 1};`;
    });
    const baseContent = baseLines.join("\n") + "\n";

    writeFileSync(path.join(repo, "f.ts"), baseContent);
    const base = commit(repo, "base", "2026-01-01T00:00:00+00:00");

    const postLines = baseLines.map((l, i) => {
      if (i === 9) return `const x${i + 1} = ${i + 1};`;
      if (i === 11) return "// comment B";
      return l;
    });
    const postContent = postLines.join("\n") + "\n";
    writeFileSync(path.join(repo, "f.ts"), postContent);

    const filePath = path.join(repo, "f.ts");

    const fromAddedHunks = addedHunks(filePath, base);
    const fromDiffText = diffTextToHunks(baseContent, postContent);

    expect(fromAddedHunks).not.toBeNull();
    expect(fromAddedHunks!.length).toBe(2);
    expect(fromDiffText.length).toBe(2);

    const addedFromGit = fromAddedHunks!.flatMap(h => h.added).sort((a, b) => a - b);
    const addedFromText = fromDiffText.flatMap(h => h.added).sort((a, b) => a - b);
    expect(addedFromGit).toEqual(addedFromText);
  });
});
