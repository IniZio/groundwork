// A feature-branch worktree off `develop`, whose clone still points origin/HEAD at an old `main`, gated through gate.ts spawned by path.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "../..");
const GATE = path.join(REPO, "src/hooks/gate.ts");
const BIN = path.join(REPO, "bin/house-rules");

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function dockerfile(): string {
  const lines = ["# syntax=docker/dockerfile:1.7", "FROM debian:bookworm-slim AS build", "ARG TOOL_VERSION=1.0.0", "ARG TOOL_SHA256=aaaa"];
  for (let i = 0; lines.length < 175; i++) {
    if (i % 9 === 0) lines.push(`# stage note ${i}: why this layer stays separate from the next`);
    else lines.push(`RUN echo step-${i} > /tmp/step-${i}`);
  }
  return lines.join("\n") + "\n";
}

interface Fixture { worktree: string; file: string; transcript: string; sessionStart: string }

type Reflog = "fresh" | "names-old-main" | "expired";

function fixture(staleOriginHead: boolean, reflog: Reflog = "fresh"): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "hr-gate-base-"));
  const seed = path.join(root, "seed");
  git(root, "init", "-q", "-b", "main", seed);
  writeFileSync(path.join(seed, "README.md"), "old main\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "main");
  git(seed, "checkout", "-q", "-b", "develop");
  writeFileSync(path.join(seed, "Dockerfile"), dockerfile());
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "develop");
  const bare = path.join(root, "origin.git");
  git(root, "clone", "-q", "--bare", seed, bare);
  git(bare, "symbolic-ref", "HEAD", "refs/heads/develop");

  const clone = path.join(root, "clone");
  git(root, "clone", "-q", bare, clone);
  if (staleOriginHead) git(clone, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  writeFileSync(path.join(clone, ".git", "info", "exclude"), ".worktrees/\n");

  const sessionStart = new Date(Date.now() - 60_000).toISOString();
  const worktree = path.join(clone, ".worktrees", "pins");
  if (reflog === "names-old-main") {
    git(clone, "worktree", "add", "-q", "-b", "build/pins", worktree, "origin/main");
    git(worktree, "reset", "-q", "--hard", "origin/develop");
  } else {
    git(clone, "worktree", "add", "-q", "-b", "build/pins", worktree, "origin/develop");
  }
  if (reflog === "expired") git(clone, "reflog", "expire", "--expire=now", "--all");
  return { worktree, file: path.join(worktree, "Dockerfile"), transcript: path.join(root, "session.jsonl"), sessionStart };
}

function editAndCommit(f: Fixture, edit: (text: string) => string): void {
  const before = readFileSync(f.file, "utf8");
  const after = edit(before);
  writeFileSync(f.file, after);
  git(f.worktree, "commit", "-q", "-am", "pins");
  const ts = f.sessionStart;
  const entries = [
    { type: "user", message: { content: "bump the pins" }, timestamp: ts, cwd: f.worktree },
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_1", name: "Edit", input: { file_path: f.file, old_string: before, new_string: after } }] },
      timestamp: ts,
      cwd: f.worktree,
    },
  ];
  writeFileSync(f.transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

interface StopResult { decision?: string; text: string }

function stop(f: Fixture): StopResult {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify({
      hook_event_name: "Stop",
      session_id: `hr-gate-base-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      transcript_path: f.transcript,
      cwd: f.worktree,
      stop_hook_active: false,
    }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  const out = r.stdout.trim();
  const parsed = out ? (JSON.parse(out) as { decision?: string }) : {};
  return { decision: parsed.decision, text: out };
}

const bumpPins = (t: string) => t.replace("TOOL_VERSION=1.0.0", "TOOL_VERSION=1.1.0").replace("TOOL_SHA256=aaaa", "TOOL_SHA256=bbbb");

const addCommentedCode = (t: string) => {
  const block: string[] = [];
  for (let i = 0; i < 30; i++) block.push(i % 3 === 0 ? `# new narration ${i} restating the next step` : `RUN echo added-${i}`);
  return t + block.join("\n") + "\n";
};

describe("Stop gate judges a feature branch by what it adds over the branch it forked from", () => {
  for (const stale of [false, true]) {
    const label = stale ? "origin/HEAD left on an old main" : "origin/HEAD on develop";

    it(`${label}: two changed ARG values in a commented Dockerfile do not block`, () => {
      const f = fixture(stale);
      editAndCommit(f, bumpPins);
      const r = stop(f);
      expect(r.text).not.toContain("Dockerfile");
      expect(r.decision).not.toBe("block");
    });

    it(`${label}: ten new comment lines over twenty new code lines are acted on`, () => {
      const f = fixture(stale);
      editAndCommit(f, addCommentedCode);
      const r = stop(f);
      expect(r.text).toContain("Dockerfile");
      const after = readFileSync(f.file, "utf8");
      const kept = after.split("\n").filter((l) => l.startsWith("# new narration")).length;
      expect(r.decision === "block" || kept <= 1).toBe(true);
      expect(after.split("\n").filter((l) => l.startsWith("# stage note")).length).toBe(19);
    });
  }
});

describe("Stop gate finds the nearest fork point when the reflog misleads or is gone", () => {
  for (const reflog of ["names-old-main", "expired"] as const) {
    it(`reflog ${reflog}, origin/HEAD on an old main: two changed ARG values do not block`, () => {
      const f = fixture(true, reflog);
      editAndCommit(f, bumpPins);
      const r = stop(f);
      expect(r.text).not.toContain("Dockerfile");
      expect(r.decision).not.toBe("block");
      expect(readFileSync(f.file, "utf8").split("\n").filter((l) => l.startsWith("# stage note")).length).toBe(19);
    });
  }
});

describe("check with no --base judges a feature branch by the branch it forked from", () => {
  it("origin/HEAD left on an old main: two changed ARG values report nothing", () => {
    const f = fixture(true);
    editAndCommit(f, bumpPins);
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const r = spawnSync(BIN, ["check", "--verbose", "--repo", f.worktree, "--baseline-file", path.join(f.worktree, "..", "no-baseline.json")], { cwd: f.worktree, encoding: "utf8", env });
    expect(r.stdout + r.stderr).not.toContain("Dockerfile");
    expect(r.status).toBe(0);
  });
});
