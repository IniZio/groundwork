import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { buildContext } from '../engine/context.js';
import { addedHunks, allLinesHunk } from '../hooks/lib/work-scope.js';
import type { RuleContext, ScopedFile } from '../engine/types.js';
import { defaultBase } from './default-base.js';
import { languageForPath } from '../hooks/languages/registry.js';
import { createSourceFiles } from '../engine/source-file.js';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface Scope {
  base: string;
  mode: 'diff' | 'all';
  files: string[];
}

export interface ResolveScopeOpts {
  repoRoot: string;
  all?: boolean;
  paths?: string[];
  base?: string;
  since?: string;
}

export class ScopeUsageError extends Error {}

type SpawnFn = (cmd: string, args: string[], opts: { encoding: 'utf8' }) => SpawnSyncReturns<string>;

export function buildAllTrackedContext(
  repoRoot: string,
  base?: string,
  paths?: string[],
  _spawnFn: SpawnFn = spawnSync,
): RuleContext {
  const effectiveBase = base ?? EMPTY_TREE;
  const lsArgs = ['-C', repoRoot, 'ls-files'];
  if (paths && paths.length > 0) lsArgs.push('--', ...paths);
  const result = _spawnFn('git', lsArgs, { encoding: 'utf8' });
  const filePaths = result.stdout.split('\n').filter(Boolean);

  const sources = createSourceFiles();

  if (effectiveBase === EMPTY_TREE) {
    const files: ScopedFile[] = filePaths.map(relPath => {
      const absPath = path.join(repoRoot, relPath);
      let text: string | undefined;
      try { text = fs.readFileSync(absPath, 'utf8'); } catch { }
      return {
        path: relPath,
        text,
        lang: languageForPath(relPath) ?? undefined,
        baseText: '',
        addedHunks: text !== undefined ? allLinesHunk(text) : [],
        tracked: true,
        sessionCreated: false,
      };
    });
    return {
      repoRoot,
      mode: 'cli',
      files,
      sourceFile(file: ScopedFile) {
        if (!file.lang || file.text === undefined) return Promise.resolve(null);
        return sources.get(file.lang, file.text, file.path);
      },
    };
  }

  const files: ScopedFile[] = filePaths.map(relPath => {
    const absPath = path.join(repoRoot, relPath);
    let text: string | undefined;
    try { text = fs.readFileSync(absPath, 'utf8'); } catch { /* file unreadable */ }
    const showResult = _spawnFn('git', ['-C', repoRoot, 'show', `${effectiveBase}:${relPath}`], { encoding: 'utf8' });
    const baseText = showResult.status === 0 ? showResult.stdout : '';
    return {
      path: relPath,
      text,
      lang: languageForPath(relPath) ?? undefined,
      baseText,
      addedHunks: addedHunks(absPath, effectiveBase) ?? [],
      tracked: true,
      sessionCreated: false,
    };
  });
  return {
    repoRoot,
    mode: 'cli',
    files,
    sourceFile(file: ScopedFile) {
      if (!file.lang || file.text === undefined) return Promise.resolve(null);
      return sources.get(file.lang, file.text, file.path);
    },
  };
}

export function resolveScope(opts: ResolveScopeOpts): { ctx: RuleContext; scope: Scope } {
  const { repoRoot, paths } = opts;

  if (opts.all) {
    if (opts.base !== undefined) {
      throw new ScopeUsageError('--all cannot be combined with --base or --since');
    }
    const base = opts.since ?? EMPTY_TREE;
    const ctx = buildAllTrackedContext(repoRoot, base, paths);
    const scope: Scope = { base, mode: 'all', files: (ctx.files ?? []).map(f => f.path) };
    return { ctx, scope };
  }

  // diff mode
  const base = opts.base ?? opts.since ?? defaultBase(repoRoot);
  let ctx = buildContext({ repoRoot, mode: 'cli', base });

  if (paths && paths.length > 0) {
    // Narrow ctx.files to the set returned by git ls-files for the pathspec.
    const lsResult = spawnSync('git', ['-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths], { encoding: 'utf8' });
    const allowed = new Set(lsResult.stdout.split('\n').filter(Boolean));
    ctx = { ...ctx, files: (ctx.files ?? []).filter(f => allowed.has(f.path)) };
  }

  const scope: Scope = { base, mode: 'diff', files: (ctx.files ?? []).map(f => f.path) };
  return { ctx, scope };
}
