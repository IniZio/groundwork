import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function parseTs(s: string | null): number {
  if (!s) return NaN;
  const n = s.replace(" ", "T");
  return Date.parse(/[+-]\d\d:\d\d$|Z$/.test(n) ? n : n + "Z");
}

function firstTimestamp(transcriptPath: string): string | null {
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return null; }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const ts = obj.timestamp;
      if (typeof ts === "string" && ts) return ts;
    } catch { continue; }
  }
  return null;
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

function extractFilesFromContent(
  raw: string,
  sessionCwd: string,
  files: Set<string>,
): void {
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      if (obj.type !== "assistant") continue;
      const msg = (obj.message ?? obj) as Record<string, unknown>;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      const entryCwd = typeof obj.cwd === "string" ? obj.cwd : sessionCwd;
      for (const blk of content as Record<string, unknown>[]) {
        if ((blk as Record<string, unknown>).type !== "tool_use") continue;
        const inp = (blk as Record<string, unknown>).input as
          | Record<string, unknown>
          | undefined;
        const name = (blk as Record<string, unknown>).name;
        if (name === "Edit" || name === "Write" || name === "MultiEdit") {
          const fp =
            inp && typeof inp.file_path === "string" ? inp.file_path : null;
          if (fp) files.add(fp);
        } else if (name === "Bash") {
          const cmd =
            inp && typeof inp.command === "string" ? inp.command : "";
          extractBashTargets(cmd, entryCwd, files);
        }
      }
    } catch { continue; }
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
  if (resolved.startsWith("/tmp/")) return;
  if (resolved.startsWith("/dev/shm/")) return;
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
}

export function touchedFiles(opts: TouchedFilesOpts): string[] {
  const files = new Set<string>();
  const { event, transcriptPath, sessionId, agentTranscriptPath } = opts;

  if (event === "SubagentStop") {
    const tp = agentTranscriptPath ?? transcriptPath;
    try {
      const raw = readFileSync(tp, "utf8");
      extractFilesFromContent(raw, "", files);
    } catch { /* fail-open */ }
    return [...files];
  }

  try {
    const raw = readFileSync(transcriptPath, "utf8");
    extractFilesFromContent(raw, "", files);
  } catch { /* fail-open */ }

  const subDir = path.join(path.dirname(transcriptPath), sessionId, "subagents");
  try {
    for (const entry of readdirSync(subDir)) {
      if (!entry.endsWith(".jsonl")) continue;
      try {
        const raw = readFileSync(path.join(subDir, entry), "utf8");
        extractFilesFromContent(raw, "", files);
      } catch { continue; }
    }
  } catch { /* no subagents dir */ }

  return [...files];
}

type TouchKind =
  | { kind: "Write" }
  | { kind: "Edit" }
  | { kind: "Bash"; from: string };

function firstTouchInfo(transcriptPath: string, file: string): TouchKind | null {
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return null; }

  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    if (obj.type !== "assistant") continue;
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const blk of content as Record<string, unknown>[]) {
      if (blk.type !== "tool_use") continue;
      const name = blk.name as string | undefined;
      const inp = blk.input as Record<string, unknown> | undefined;
      if (name === "Write" || name === "Edit" || name === "MultiEdit") {
        const fp = inp && typeof inp.file_path === "string" ? inp.file_path : null;
        if (fp && fp === file) {
          return name === "Write" ? { kind: "Write" } : { kind: "Edit" };
        }
      } else if (name === "Bash") {
        const cmd = inp && typeof inp.command === "string" ? inp.command : "";
        for (const cmdLine of cmd.split("\n")) {
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
  const tmpFile = `/dev/shm/gw-work-scope-orig-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
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

export function addedRanges(file: string, base: string, transcriptPath?: string): number[] | null {
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
