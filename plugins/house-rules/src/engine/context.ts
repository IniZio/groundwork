import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addedHunks, diffTextToHunks, sessionBase, touchedFiles } from '../hooks/lib/work-scope.js';
import { detectLanguage } from '../hooks/lib/comment-density.js';
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
  const { repoRoot, mode } = opts;

  if (mode === 'guard') {
    return opts.files ?? [];
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
    for (const absPath of absPaths) {
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
    return result;
  }

  // cli mode
  const committed = spawnSync(
    'git',
    ['-C', repoRoot, 'diff', '--name-only', `${opts.base ?? ''}...HEAD`],
    { encoding: 'utf8' },
  );
  const staged = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  });
  const unstaged = spawnSync('git', ['-C', repoRoot, 'diff', '--name-only'], {
    encoding: 'utf8',
  });

  const allFiles = new Set<string>();
  for (const result of [committed, staged, unstaged]) {
    if (result.status === 0) {
      for (const line of result.stdout.split('\n')) {
        const f = line.trim();
        if (f) allFiles.add(f);
      }
    }
  }

  // Filter: only tracked files
  const result: string[] = [];
  for (const relPath of allFiles) {
    if (isTracked(repoRoot, relPath)) {
      result.push(relPath);
    }
  }
  return result;
}

export function buildContext(opts: BuildContextOpts): RuleContext {
  const { repoRoot, mode } = opts;
  const relPaths = scopeFiles(opts);

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

    const langResult = detectLanguage(relPath);
    const lang: string | undefined = langResult ?? undefined;

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
  };
}
