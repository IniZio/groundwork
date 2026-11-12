import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { parseTranscript, readTranscript } from "./transcript.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function parseTs(s: string | null): number {
  if (!s) return NaN;
  const n = s.replace(" ", "T");
  return Date.parse(/[+-]\d\d:\d\d$|Z$/.test(n) ? n : n + "Z");
}

function firstTimestamp(transcriptPath: string): string | null {
  return readTranscript(transcriptPath)?.find((e) => e.timestamp)?.timestamp ?? null;
}

export function sessionBase(transcriptPath: string, repo: string): string {
  const ts = firstTimestamp(transcriptPath);
  if (!ts) return EMPTY_TREE;
  const tsMs = parseTs(ts);
  if (isNaN(tsMs)) return EMPTY_TREE;

  const result = spawnSync("git", ["-C", repo, "log", "--format=%H %ct"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) return EMPTY_TREE;

  let best: string | null = null;
  let bestMs = -Infinity;

  for (const line of result.stdout.split("\n")) {
    const parts = line.trim().split(" ");
    if (parts.length < 2) continue;
    const sha = parts[0];
    const commitMs = parseInt(parts[1], 10) * 1000;
    if (isNaN(commitMs)) continue;
    if (commitMs < tsMs && commitMs > bestMs) {
      best = sha;
      bestMs = commitMs;
    }
  }

  return best ?? EMPTY_TREE;
}

function git(repo: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

export function createdFrom(repoRoot: string, branch: string): string | null {
  const log = git(repoRoot, ["reflog", "show", "--format=%gs", `refs/heads/${branch}`, "--"]);
  const ref = log?.split("\n").at(-1)?.match(/^branch: Created from (.+)$/)?.[1];
  if (!ref || ref === "HEAD" || ref === branch || ref === `origin/${branch}`) return null;
  return git(repoRoot, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]) ? ref : null;
}

const TRUNKS = ["main", "master", "develop", "trunk"];

export interface ForkPoint { ref: string; mergeBase: string }

/** The candidate whose merge-base is nearest HEAD, because a clone-time origin/HEAD and a reflog fork ref can each name a stale trunk. */
export function forkPoint(repoRoot: string, branch: string): ForkPoint | null {
  const own = new Set([branch, `origin/${branch}`]);
  const candidates = [createdFrom(repoRoot, branch), "origin/HEAD", ...TRUNKS.flatMap((t) => [`origin/${t}`, t])];
  let best: (ForkPoint & { ahead: number }) | null = null;
  for (const ref of new Set(candidates)) {
    if (!ref || own.has(ref) || !git(repoRoot, ["rev-parse", "--verify", "-q", `${ref}^{commit}`])) continue;
    const mergeBase = git(repoRoot, ["merge-base", "HEAD", ref]);
    const ahead = mergeBase ? Number(git(repoRoot, ["rev-list", "--count", `${mergeBase}..HEAD`])) : NaN;
    if (mergeBase && Number.isFinite(ahead) && (best === null || ahead < best.ahead)) best = { ref, mergeBase, ahead };
  }
  return best && { ref: best.ref, mergeBase: best.mergeBase };
}

/** Gate base: HEAD on a trunk branch or detached; else the nearest fork point. */
export function gateBase(repoRoot: string): string {
  const head = git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!head) return EMPTY_TREE;

  const branch = git(repoRoot, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch || TRUNKS.includes(branch)) return head;
  return forkPoint(repoRoot, branch)?.mergeBase ?? head;
}

/** A Bash call: the directories it ran in and the wall-clock span between its tool_use and tool_result entries. */
interface BashWindow { dirs: string[]; start: number; end: number }

interface AgentTouches {
  /** Edit/Write/MultiEdit targets */
  edited: Set<string>;
  /** paths parsed out of Bash command text */
  parsed: Set<string>;
  windows: BashWindow[];
}

const WINDOW_SLACK_MS = 1000;

function cdTargets(cmd: string, cwd: string): string[] {
  const dirs = [cwd];
  let cur = cwd;
  for (const m of cmd.matchAll(/(?:^|[;&|(\s])cd\s+(?:--\s+)?("[^"]+"|'[^']+'|[^\s;&|)]+)/g)) {
    let d = m[1].replace(/^["']|["']$/g, "");
    if (d.includes("$") || d === "-") continue;
    if (d === "~" || d.startsWith("~/")) d = path.join(os.homedir(), d.slice(1));
    cur = path.resolve(cur, d);
    dirs.push(cur);
  }
  return dirs;
}

function scanTranscript(raw: string): AgentTouches {
  const touches: AgentTouches = { edited: new Set(), parsed: new Set(), windows: [] };
  const pending = new Map<string, { dirs: string[]; start: number }>();
  for (const entry of parseTranscript(raw)) {
    for (const blk of entry.blocks) {
      if (entry.type === "user" && blk.kind === "tool_result") {
        const open = blk.toolUseId ? pending.get(blk.toolUseId) : undefined;
        if (open && !isNaN(entry.timeMs)) touches.windows.push({ ...open, end: entry.timeMs });
        continue;
      }
      if (entry.type !== "assistant" || blk.kind !== "tool_use") continue;
      if (blk.name === "Edit" || blk.name === "Write" || blk.name === "MultiEdit") {
        if (blk.filePath) touches.edited.add(blk.filePath);
      } else if (blk.name === "Bash") {
        const cmd = blk.command ?? "";
        extractBashTargets(cmd, entry.cwd, touches.parsed);
        if (blk.id && entry.cwd && !isNaN(entry.timeMs)) {
          pending.set(blk.id, { dirs: cdTargets(cmd, entry.cwd), start: entry.timeMs });
        }
      }
    }
  }
  return touches;
}

interface Candidate { abs: string; untracked: boolean; changedMs: number; bornMs: number }

/** Files differing from the gate base, or untracked and not ignored, in one repo. */
function repoCandidates(repoRoot: string): Candidate[] {
  const list = (args: string[]): string[] => {
    const r = spawnSync("git", ["-C", repoRoot, ...args, "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : [];
  };
  const untracked = new Set(list(["ls-files", "--others", "--exclude-standard"]));
  const changed = list(["diff", "--name-only", "--no-renames", gateBase(repoRoot)]);
  const out: Candidate[] = [];
  for (const rel of new Set([...changed, ...untracked])) {
    const abs = path.join(repoRoot, rel);
    try {
      const st = statSync(abs);
      if (st.isDirectory() && existsSync(path.join(abs, ".git"))) out.push(...repoCandidates(abs));
      if (!st.isFile()) continue;
      out.push({ abs, untracked: untracked.has(rel), changedMs: Math.max(st.mtimeMs, st.ctimeMs), bornMs: st.birthtimeMs });
    } catch { continue; }
  }
  return out;
}

class GitScope {
  private roots = new Map<string, string | null>();
  private candidates = new Map<string, Candidate[]>();

  private root(dir: string): string | null {
    if (!this.roots.has(dir)) this.roots.set(dir, git(dir, ["rev-parse", "--show-toplevel"]));
    return this.roots.get(dir) ?? null;
  }

  /** Adds every candidate whose last change falls inside one of the windows; untracked ones born inside it go to `created`. */
  attribute(windows: BashWindow[], files: Set<string>, created: Set<string>): void {
    for (const w of windows) {
      const lo = w.start - WINDOW_SLACK_MS;
      const hi = w.end + WINDOW_SLACK_MS;
      const repos = new Set(w.dirs.map((d) => this.root(d)).filter((r): r is string => r !== null));
      for (const repo of repos) {
        if (!this.candidates.has(repo)) this.candidates.set(repo, repoCandidates(repo));
        for (const c of this.candidates.get(repo)!) {
          if (c.changedMs < lo || c.changedMs > hi) continue;
          files.add(c.abs);
          if (c.untracked && (c.bornMs <= 0 || c.bornMs >= lo)) created.add(c.abs);
        }
      }
    }
  }
}

function addPath(
  raw: string,
  cwd: string,
  files: Set<string>,
): void {
  if (!raw || raw.includes("$")) return;
  const stripped = raw.replace(/^["']|["']$/g, "");
  if (!stripped) return;
  const resolved = stripped.startsWith("/")
    ? stripped
    : path.join(cwd, stripped);
  if (resolved === "/dev/null") return;
  files.add(resolved);
}

function extractBashTargets(
  cmd: string,
  cwd: string,
  files: Set<string>,
): void {
  for (const line of cmd.split("\n")) {
    try {
      let m: RegExpMatchArray | null;

      m = line.match(/\bcat\s+>>?\s+(["']?[^\s'"<>&|$;]+["']?)\s*<</);
      if (m) { addPath(m[1], cwd, files); continue; }

      m = line.match(/\btee\s+(?:-a\s+)?(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/);
      if (m) { addPath(m[1], cwd, files); continue; }

      m = line.match(/\bsed\s+(?:-i\S*|-i\s)\s+\S+\s+(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/);
      if (m) { addPath(m[1], cwd, files); continue; }

      m = line.match(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/);
      if (m) { addPath(m[1], cwd, files); continue; }

      m = line.match(/(?:^|[^<])>>?\s+(["']?[^\s'"<>&|$;]+["']?)(?:\s|$)/);
      if (m) { addPath(m[1], cwd, files); continue; }
    } catch { continue; }
  }
}

export interface TouchedFilesOpts {
  event: "Stop" | "SubagentStop";
  transcriptPath: string;
  sessionId: string;
  agentTranscriptPath?: string;
  runningAgentIds?: string[];
}

export function runningAgentIds(backgroundTasks: unknown): string[] {
  if (!Array.isArray(backgroundTasks)) return [];
  const ids: string[] = [];
  for (const entry of backgroundTasks) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.status !== "running") continue;
    if (e.type !== undefined && e.type !== "subagent") continue;
    if (typeof e.id === "string" && e.id) ids.push(e.id);
  }
  return ids;
}

export function touchedFiles(opts: TouchedFilesOpts): string[] {
  return [...workScope(opts).files];
}

export interface WorkScope {
  files: Set<string>;
  /** Untracked files a Bash call of this agent brought into existence: every line counts as added. */
  created: Set<string>;
}

function readTouches(tp: string): AgentTouches | null {
  try { return scanTranscript(readFileSync(tp, "utf8")); } catch { return null; }
}

function subagentTranscripts(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => /^agent-.+\.jsonl$/.test(e)).map((e) => path.join(dir, e));
  } catch { return []; }
}

/**
 * Files this agent changed. Edit/Write targets and paths parsed from Bash commands come from
 * the transcript; any other Bash write is found in git: a file differing from the gate base,
 * or untracked, in a repo the call ran in, whose last change falls inside the call's window.
 */
export function workScope(opts: TouchedFilesOpts): WorkScope {
  const { event, transcriptPath, sessionId, agentTranscriptPath, runningAgentIds: runningIds } = opts;
  const scope = new GitScope();
  const files = new Set<string>();
  const created = new Set<string>();
  const collect = (t: AgentTouches, into: Set<string>, born: Set<string>) => {
    for (const f of t.edited) into.add(f);
    for (const f of t.parsed) into.add(f);
    scope.attribute(t.windows, into, born);
  };

  if (event === "SubagentStop") {
    const tp = agentTranscriptPath ?? transcriptPath;
    const own = readTouches(tp);
    if (!own) return { files, created };
    const fromWindows = new Set<string>();
    scope.attribute(own.windows, fromWindows, created);
    const siblingEdits = new Set<string>();
    for (const sib of subagentTranscripts(path.dirname(tp))) {
      if (sib === tp) continue;
      for (const f of readTouches(sib)?.edited ?? []) siblingEdits.add(f);
    }
    for (const f of fromWindows) {
      if (siblingEdits.has(f) && !own.edited.has(f)) { created.delete(f); continue; }
      files.add(f);
    }
    for (const f of own.edited) files.add(f);
    for (const f of own.parsed) files.add(f);
    return { files, created };
  }

  const main = readTouches(transcriptPath);
  if (main) collect(main, files, created);

  const runningSet = new Set(runningIds ?? []);
  const runningFiles = new Set<string>();
  for (const sub of subagentTranscripts(path.join(path.dirname(transcriptPath), sessionId, "subagents"))) {
    const t = readTouches(sub);
    if (!t) continue;
    const agentId = path.basename(sub).replace(/^agent-|\.jsonl$/g, "");
    if (runningSet.has(agentId)) collect(t, runningFiles, new Set());
    else collect(t, files, created);
  }

  for (const f of runningFiles) {
    files.delete(f);
    created.delete(f);
  }
  return { files, created };
}

type TouchKind =
  | { kind: "Write" }
  | { kind: "Edit" }
  | { kind: "Bash"; from: string };

function firstTouchInfo(transcriptPath: string, file: string): TouchKind | null {
  const entries = readTranscript(transcriptPath);
  if (!entries) return null;

  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const blk of entry.blocks) {
      if (blk.kind !== "tool_use") continue;
      if (blk.name === "Write" || blk.name === "Edit" || blk.name === "MultiEdit") {
        if (blk.filePath && blk.filePath === file) {
          return blk.name === "Write" ? { kind: "Write" } : { kind: "Edit" };
        }
      } else if (blk.name === "Bash") {
        for (const cmdLine of (blk.command ?? "").split("\n")) {
          const m = cmdLine.match(
            /\b(?:mv|cp)\s+(?:-\S+\s+)*(['"]?[^\s'"<>&|$;]+['"]?)\s+(['"]?[^\s'"<>&|$;]+['"]?)\s*(?:$|[|&;])/,
          );
          if (m) {
            const src = m[1].replace(/^["']|["']$/g, "");
            const dst = m[2].replace(/^["']|["']$/g, "");
            if (dst === file || path.resolve(dst) === file) {
              return { kind: "Bash", from: src };
            }
          }
        }
      }
    }
  }
  return null;
}

function findRenameSourceFromGit(relPath: string, base: string, repoRoot: string): string | null {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "diff", base, "--name-status", "-M", "-C"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/^[RC]\d*\t(.+)\t(.+)$/);
    if (m && m[2] === relPath) return m[1];
  }
  return null;
}

function addedVsCommittedSource(
  file: string,
  src: string,
  base: string,
  repoRoot: string,
): number[] | null {
  // Resolve src relative to repoRoot
  const srcAbs = src.startsWith("/") ? src : path.resolve(repoRoot, src);
  const srcRel = path.relative(repoRoot, srcAbs);

  const showResult = spawnSync(
    "git",
    ["-C", repoRoot, "show", `${base}:${srcRel}`],
    { encoding: "utf8" },
  );
  if (showResult.status !== 0) return null;

  // Write original content to a temp file
  const tmpFile = `/dev/shm/hr-work-scope-orig-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmpFile, showResult.stdout, "utf8");
    const diffResult = spawnSync(
      "git",
      ["diff", "--no-index", "--", tmpFile, file],
      { encoding: "utf8" },
    );
    // git diff --no-index exits 1 when there are differences, 0 when identical
    if (diffResult.status !== 0 && diffResult.status !== 1) return null;
    return parseDiffAdded(diffResult.stdout);
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ok */ }
  }
}

export function addedRanges(file: string, base: string, transcriptPath?: string, knownRoot?: string | null): number[] | null {
  const dir = path.dirname(file);

  let repoRoot: string;
  if (knownRoot !== undefined) {
    if (knownRoot === null) return null;
    repoRoot = knownRoot;
  } else {
    const rootResult = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    });
    if (rootResult.status !== 0) return null;
    repoRoot = rootResult.stdout.trim();
  }

  let exists = false;
  try { exists = statSync(file).isFile(); } catch { /* ok */ }
  if (!exists) return null;

  const relPath = path.relative(repoRoot, file);

  const isTrackedResult = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "--error-unmatch", "--", relPath],
    { encoding: "utf8" },
  );

  if (isTrackedResult.status !== 0) {
    // Fail-closed: if we can't consult the transcript, don't treat as session-added
    if (!transcriptPath) return null;

    const touch = firstTouchInfo(transcriptPath, file);
    if (!touch) return null;

    if (touch.kind === "Write") {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines.map((_, i) => i + 1);
    }

    if (touch.kind === "Bash") {
      return addedVsCommittedSource(file, touch.from, base, repoRoot);
    }

    return null;
  }

  const catFileResult = spawnSync(
    "git",
    ["-C", repoRoot, "cat-file", "-e", `${base}:${relPath}`],
    { encoding: "utf8" },
  );

  if (catFileResult.status !== 0) {
    const gitSrc = findRenameSourceFromGit(relPath, base, repoRoot);
    const transcriptSrc =
      !gitSrc && transcriptPath
        ? (() => {
            const touch = firstTouchInfo(transcriptPath, file);
            return touch?.kind === "Bash" ? touch.from : null;
          })()
        : null;
    const src = gitSrc ?? transcriptSrc;
    if (src) return addedVsCommittedSource(file, src, base, repoRoot);
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((_, i) => i + 1);
  }

  const diffResult = spawnSync(
    "git",
    ["-C", repoRoot, "diff", base, "--", relPath],
    { encoding: "utf8" },
  );
  if (diffResult.status !== 0) return null;

  return parseDiffAdded(diffResult.stdout);
}

export interface DiffHunk {
  /** New-file 1-based line numbers of added lines in this hunk */
  added: number[];
  /** Texts of removed lines (parallel to removedBaseLineNos) */
  removed: string[];
  /** Base-file 1-based line numbers of the removed lines */
  removedBaseLineNos: number[];
}

export function parseDiffHunks(diffText: string): DiffHunk[] {
  const result: DiffHunk[] = [];
  let hunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const raw of diffText.split("\n")) {
    if (
      raw.startsWith("+++ ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    ) continue;

    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      if (hunk && (hunk.added.length > 0 || hunk.removed.length > 0)) {
        result.push(hunk);
      }
      oldLineNo = parseInt(hunkMatch[1], 10) - 1;
      newLineNo = parseInt(hunkMatch[2], 10) - 1;
      hunk = { added: [], removed: [], removedBaseLineNos: [] };
      continue;
    }

    if (!hunk) continue;

    if (raw.startsWith("+")) {
      newLineNo++;
      hunk.added.push(newLineNo);
    } else if (raw.startsWith("-")) {
      oldLineNo++;
      hunk.removedBaseLineNos.push(oldLineNo);
      hunk.removed.push(raw.slice(1));
    } else {
      newLineNo++;
      oldLineNo++;
    }
  }

  if (hunk && (hunk.added.length > 0 || hunk.removed.length > 0)) {
    result.push(hunk);
  }

  return result;
}

/** Pure helper: given the full text of a newly-added file, return the single DiffHunk that marks every line as added. */
export function allLinesHunk(content: string): DiffHunk[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }];
}

export function addedHunks(file: string, base: string, transcriptPath?: string): DiffHunk[] | null {
  const dir = path.dirname(file);

  const rootResult = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();

  let exists = false;
  try { exists = statSync(file).isFile(); } catch { /* ok */ }
  if (!exists) return null;

  const relPath = path.relative(repoRoot, file);

  const isTrackedResult = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "--error-unmatch", "--", relPath],
    { encoding: "utf8" },
  );

  if (isTrackedResult.status !== 0) {
    if (!transcriptPath) return null;

    const touch = firstTouchInfo(transcriptPath, file);
    if (!touch) return null;

    if (touch.kind === "Write") {
      return allLinesHunk(readFileSync(file, "utf8"));
    }

    if (touch.kind === "Bash") {
      const addedLines = addedVsCommittedSource(file, touch.from, base, repoRoot);
      if (!addedLines) return null;
      return [{ added: addedLines, removed: [], removedBaseLineNos: [] }];
    }

    return null;
  }

  const catFileResult = spawnSync(
    "git",
    ["-C", repoRoot, "cat-file", "-e", `${base}:${relPath}`],
    { encoding: "utf8" },
  );

  if (catFileResult.status !== 0) {
    const gitSrc = findRenameSourceFromGit(relPath, base, repoRoot);
    const transcriptSrc =
      !gitSrc && transcriptPath
        ? (() => {
            const touch = firstTouchInfo(transcriptPath, file);
            return touch?.kind === "Bash" ? touch.from : null;
          })()
        : null;
    const src = gitSrc ?? transcriptSrc;
    if (src) {
      const addedLines = addedVsCommittedSource(file, src, base, repoRoot);
      if (!addedLines) return null;
      return [{ added: addedLines, removed: [], removedBaseLineNos: [] }];
    }
    return allLinesHunk(readFileSync(file, "utf8"));
  }

  const diffResult = spawnSync(
    "git",
    ["-C", repoRoot, "diff", "--no-ext-diff", "--unified=0", base, "--", relPath],
    { encoding: "utf8" },
  );
  if (diffResult.status !== 0) return null;

  return parseDiffHunks(diffResult.stdout);
}

export function diffTextToHunks(baseText: string, postText: string): DiffHunk[] {
  const tmpDir = os.tmpdir();
  const id = randomUUID();
  const baseTmpPath = path.join(tmpDir, `hr-diff-base-${id}`);
  const postTmpPath = path.join(tmpDir, `hr-diff-post-${id}`);
  try {
    writeFileSync(baseTmpPath, baseText, { encoding: "utf8", mode: 0o600 });
    writeFileSync(postTmpPath, postText, { encoding: "utf8", mode: 0o600 });
    const diffResult = spawnSync(
      "git",
      ["diff", "--no-index", "--no-ext-diff", "--unified=0", "--", baseTmpPath, postTmpPath],
      { encoding: "utf8" },
    );
    // exit code 1 is normal when files differ
    if (diffResult.status !== 0 && diffResult.status !== 1) return [];
    return parseDiffHunks(diffResult.stdout);
  } finally {
    try { unlinkSync(baseTmpPath); } catch { /* ok */ }
    try { unlinkSync(postTmpPath); } catch { /* ok */ }
  }
}

function parseDiffAdded(diffOutput: string): number[] {
  const added: number[] = [];
  let newLineNo = 0;
  for (const raw of diffOutput.split("\n")) {
    if (raw.startsWith("+++ ") || raw.startsWith("--- ") ||
        raw.startsWith("diff ") || raw.startsWith("index ")) continue;
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLineNo = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (raw.startsWith("+")) {
      newLineNo++;
      added.push(newLineNo);
    } else if (!raw.startsWith("-")) {
      newLineNo++;
    }
  }
  return added;
}
