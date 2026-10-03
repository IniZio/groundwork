import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { addedHunks, diffTextToHunks, sessionBase, touchedFiles } from '../hooks/lib/work-scope.js';
import { languageForPath } from '../hooks/languages/registry.js';
import type { ParserFactory } from '../hooks/languages/parse.js';
import { resolveConfig } from '../config/resolve.mjs';
import { forbiddenRedirect, inTypedArea, matchPath } from '../config/manifest.mjs';
import { createSourceFiles } from './source-file.js';
import type { RuleContext, ScopedFile } from './types.js';

export interface BuildContextOpts {
  repoRoot: string;
  mode: 'guard' | 'gate' | 'cli';
  /** guard: repo-relative path(s) of the file(s) being edited; gate/cli: ignored */
  files?: string[];
  /** git ref; gate: auto-derived from transcript via sessionBase if omitted; guard: defaults to 'HEAD' if omitted */
  base?: string;
  transcriptPath?: string;
  /** guard only: the new file content being written */
  postText?: string;
  /** gate: for subagent directory lookup in touchedFiles */
  sessionId?: string;
  /** gate: default 'Stop' */
  event?: 'Stop' | 'SubagentStop';
  /** gate: agent ids still running; their touched files are excluded from scope */
  runningAgentIds?: string[];
  /** Injected once; defaults to the tree-sitter loader's getParser. */
  parserFactory?: ParserFactory;
  /** gate: test seam for Bash-created doc detection */
  detectDeps?: DetectDeps;
}

export interface DetectDeps {
  listUntracked?: () => string[];
}

/**
 * Session start = timestamp of the first transcript entry carrying a parseable
 * ISO `timestamp`: the earliest observable moment of the session, so a file
 * older than it cannot have been created by it. Older untracked files from
 * other sessions are excluded on purpose. Fails open: any error, or no
 * timestamp, yields [].
 */
export function detectBashCreatedDocs(
  repoRoot: string,
  transcriptPath: string | undefined,
  deps: DetectDeps = {},
): string[] {
  try {
    if (!transcriptPath) return [];
    const opts = resolveConfig(repoRoot).rules['artifact-structure'].options;
    const govern = opts.govern ?? [];
    if (!opts.types || Object.keys(opts.types).length === 0 || govern.length === 0) return [];

    let start = NaN;
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const ts = (JSON.parse(t) as Record<string, unknown>).timestamp;
        if (typeof ts === 'string' && !Number.isNaN(Date.parse(ts))) {
          start = Date.parse(ts);
          break;
        }
      } catch {
        continue;
      }
    }
    if (Number.isNaN(start)) return [];

    const list = (extra: string[]): string[] => {
      const r = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', ...extra], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.status !== 0) throw new Error('git ls-files failed');
      return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    };
    const untracked = deps.listUntracked?.() ?? list([]);
    // Forbidden or typed: kept whatever the ignore status. Governed-only: kept unless ignored outside every typed area.
    const ignored = deps.listUntracked ? [] : list(['--ignored']);
    const forbidden = opts.forbidden ?? [];
    const seen = new Set(untracked);
    const candidates = [...untracked, ...ignored.filter((p) => !seen.has(p))];

    return candidates.filter((p) => {
      const isGoverned = (seen.has(p) || inTypedArea(p, opts)) && govern.some((g) => forbiddenRedirect(p, { forbidden: [{ pattern: g, redirect: '' }] }) !== null);
      if (!isGoverned && forbiddenRedirect(p, { forbidden }) === null && matchPath(p, opts) === null) {
        return false;
      }
      try {
        return statSync(path.join(repoRoot, p)).mtimeMs >= start;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function isTracked(repoRoot: string, relPath: string): boolean {
  const r = spawnSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', relPath], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

function isSessionCreated(transcriptPath: string, absPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type !== 'assistant') continue;
    const msg = (obj.message ?? obj) as Record<string, unknown>;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const blk of content as Record<string, unknown>[]) {
      if ((blk as Record<string, unknown>).type !== 'tool_use') continue;
      const name = (blk as Record<string, unknown>).name;
      const inp = (blk as Record<string, unknown>).input as Record<string, unknown> | undefined;
      if (name === 'Write' && inp && typeof inp.file_path === 'string' && inp.file_path === absPath) {
        return true;
      }
      // If we see any other touch (Edit/MultiEdit) for this file first, it's not session-created
      if ((name === 'Edit' || name === 'MultiEdit') && inp && typeof inp.file_path === 'string' && inp.file_path === absPath) {
        return false;
      }
    }
  }
  return false;
}

export function scopeFiles(opts: BuildContextOpts): string[] {
  return scopeWithBash(opts).files;
}

function realpathOrSelf(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

function scopeWithBash(opts: BuildContextOpts): { files: string[]; bashCreated: Set<string> } {
  const bashCreated = new Set<string>();
  const { repoRoot, mode } = opts;

  if (mode === 'guard') {
    return { files: opts.files ?? [], bashCreated };
  }

  if (mode === 'gate') {
    const absPaths = touchedFiles({
      event: opts.event ?? 'Stop',
      transcriptPath: opts.transcriptPath ?? '',
      sessionId: opts.sessionId ?? '',
      agentTranscriptPath: undefined,
      runningAgentIds: opts.runningAgentIds,
    });

    const result: string[] = [];
    const realRoot = realpathOrSelf(repoRoot);
    for (const absPath of absPaths) {
      const realAbs = realpathOrSelf(absPath);
      if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) continue;
      if (!existsSync(absPath)) continue;
      const relPath = path.relative(repoRoot, absPath);
      const tracked = isTracked(repoRoot, relPath);
      if (!tracked) {
        // Include only if session-created
        const created = opts.transcriptPath
          ? isSessionCreated(opts.transcriptPath, absPath)
          : false;
        if (!created) continue;
      }
      result.push(relPath);
    }
    for (const rel of detectBashCreatedDocs(repoRoot, opts.transcriptPath, opts.detectDeps)) {
      if (result.includes(rel) || !existsSync(path.join(repoRoot, rel))) continue;
      result.push(rel);
      bashCreated.add(rel);
    }
    return { files: result, bashCreated };
  }

  // cli mode
  const rawBase = opts.base ?? '';

  // Resolve the base ref to determine the correct diff form.
  let committedDiffArgs: string[];
  if (rawBase === '') {
    // No base provided; fall back to legacy behaviour (three-dot with empty LHS).
    committedDiffArgs = ['-C', repoRoot, 'diff', '--name-only', '...HEAD'];
  } else {
    // Peel to commit first; annotated tags and commits both succeed here.
    const peelCommit = spawnSync(
      'git',
      ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${rawBase}^{commit}`],
      { encoding: 'utf8' },
    );
    if (peelCommit.status === 0) {
      const sha = peelCommit.stdout.trim();
      const mb = spawnSync('git', ['-C', repoRoot, 'merge-base', sha, 'HEAD'], {
        encoding: 'utf8',
      });
      if (mb.status === 0) {
        committedDiffArgs = ['-C', repoRoot, 'diff', '--name-only', `${sha}...HEAD`];
      } else {
        committedDiffArgs = ['-C', repoRoot, 'diff', '--name-only', sha, 'HEAD'];
      }
    } else {
      const peelTree = spawnSync(
        'git',
        ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${rawBase}^{tree}`],
        { encoding: 'utf8' },
      );
      if (peelTree.status === 0) {
        committedDiffArgs = ['-C', repoRoot, 'diff', '--name-only', rawBase, 'HEAD'];
      } else {
        throw new Error(
          `house-rules: base ref "${rawBase}" is not a valid git object or has unsupported type`,
        );
      }
    }
  }

  const committed = spawnSync('git', committedDiffArgs, { encoding: 'utf8' });
  if (committed.status !== 0) {
    throw new Error(
      `house-rules: git diff --name-only (committed) failed: ${committed.stderr.trim()}`,
    );
  }

  const staged = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  });
  if (staged.status !== 0) {
    throw new Error(
      `house-rules: git diff --name-only HEAD (staged) failed: ${staged.stderr.trim()}`,
    );
  }

  const unstaged = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only'], {
    encoding: 'utf8',
  });
  if (unstaged.status !== 0) {
    throw new Error(
      `house-rules: git diff --name-only (unstaged) failed: ${unstaged.stderr.trim()}`,
    );
  }

  const allFiles = new Set<string>();
  for (const r of [committed, staged, unstaged]) {
    for (const line of r.stdout.split('\n')) {
      const f = line.trim();
      if (f) allFiles.add(f);
    }
  }

  // Filter: only tracked files
  const result: string[] = [];
  for (const relPath of allFiles) {
    if (isTracked(repoRoot, relPath)) {
      result.push(relPath);
    }
  }
  return { files: result, bashCreated };
}

export function buildContext(opts: BuildContextOpts): RuleContext {
  const { repoRoot, mode } = opts;
  const { files: relPaths, bashCreated } = scopeWithBash(opts);
  const sources = createSourceFiles(opts.parserFactory);

  // Compute base once
  let base: string;
  if (mode === 'guard') {
    base = opts.base ?? 'HEAD';
  } else if (mode === 'gate') {
    base = opts.base ?? sessionBase(opts.transcriptPath ?? '', repoRoot);
  } else {
    base = opts.base ?? '';
  }

  const files: ScopedFile[] = [];

  for (const relPath of relPaths) {
    const absPath = path.join(repoRoot, relPath);

    let text: string | undefined;
    if (mode === 'guard') {
      text = opts.postText;
    } else {
      try {
        text = readFileSync(absPath, 'utf8');
      } catch {
        text = undefined;
      }
    }

    const lang = languageForPath(relPath, text?.split('\n')[0]) ?? undefined;

    let baseText: string;
    const showResult = spawnSync('git', ['-C', repoRoot, 'show', `${base}:${relPath}`], {
      encoding: 'utf8',
    });
    if (showResult.status === 0) {
      baseText = showResult.stdout;
    } else {
      baseText = '';
    }

    let hunks: import('./types.js').DiffHunk[] | undefined;
    if (mode === 'guard') {
      hunks = diffTextToHunks(baseText, opts.postText ?? '');
    } else {
      const h = addedHunks(absPath, base, opts.transcriptPath);
      hunks = h ?? undefined;
    }

    const tracked = isTracked(repoRoot, relPath);

    let sessionCreated = false;
    if (mode === 'gate') {
      sessionCreated = opts.transcriptPath
        ? isSessionCreated(opts.transcriptPath, absPath)
        : false;
      if (bashCreated.has(relPath)) sessionCreated = true;
    }

    files.push({
      path: relPath,
      text,
      lang,
      baseText,
      addedHunks: hunks,
      tracked,
      sessionCreated,
    });
  }

  return {
    repoRoot,
    mode,
    files,
    sourceFile(file: ScopedFile) {
      if (!file.lang || file.text === undefined) return Promise.resolve(null);
      return sources.get(file.lang, file.text, file.path);
    },
  };
}
