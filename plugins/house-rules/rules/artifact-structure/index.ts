import type { Rule, RuleContext, Finding, ScopedFile, PendingEdit, EditCheckEnv, EditCheckResult } from '../../src/engine/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from '../../src/config/resolve.mjs';
import type { ManifestOptions } from '../../src/config/resolve.mjs';
import { matchPath, nearestTypes, compileGenerates, renderPath, forbiddenRedirect, inTypedArea, words } from '../../src/config/manifest.mjs';
import { parseFrontmatter, validateFrontmatter, missingHeadings, requiredHeadings } from '../../src/engine/frontmatter.js';

export const CANONICAL_SYNONYMS: Record<string, string> = {
  docs: 'doc',
  tests: 'test',
  script: 'scripts',
};

export const SYMMETRIC_PAIRS: [string, string][] = [
  ['util', 'utils'],
  ['lib', 'libs'],
];

const ROOT_SCRATCH_PATTERNS = [
  /^test-.+\.(js|mjs|ts)$/,
  /^.+\.bak$/,
  /^tmp/,
  /^scratch/,
];

const SLUG_SENTINEL = 'slugplaceholder';

/** The configured manifest, or null when config sets neither types nor forbidden. */
export function resolveManifest(repoRoot: string): ManifestOptions | null {
  try {
    const options = resolveConfig(repoRoot).rules['artifact-structure'].options;
    const hasTypes = options.types !== undefined && Object.keys(options.types).length > 0;
    const hasForbidden = options.forbidden !== undefined && options.forbidden.length > 0;
    return hasTypes || hasForbidden ? options : null;
  } catch {
    return null;
  }
}

function isNewFile(repoRoot: string, relPath: string): boolean {
  const inHead = spawnSync('git', ['cat-file', '-e', `HEAD:${relPath}`], { cwd: repoRoot, stdio: 'ignore' });
  return inHead.status !== 0;
}

function ignoredPaths(repoRoot: string, relPaths: string[]): Set<string> {
  if (relPaths.length === 0) return new Set();
  const r = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
    cwd: repoRoot,
    input: relPaths.join('\0') + '\0',
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 || r.error) return new Set();
  return new Set(r.stdout.split('\0').filter(Boolean));
}

function contentFindings(repoRoot: string, relPath: string, typeId: string, def: NonNullable<ManifestOptions['types']>[string]): string[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch (e) {
    return [`artifact-structure: ${relPath} could not be read for content checks: ${(e as Error).message}`];
  }
  const parsed = parseFrontmatter(text);
  if (!parsed.ok) return [`artifact-structure: ${relPath} frontmatter could not be parsed for type ${typeId}: ${parsed.error}`];
  const messages: string[] = [];
  if (def.frontmatter !== undefined) {
    const errors = validateFrontmatter(def.frontmatter, parsed.data ?? {});
    const prefix = parsed.data === null ? 'has no frontmatter block; ' : '';
    for (const err of errors) messages.push(`artifact-structure: ${relPath} frontmatter invalid for type ${typeId}: ${prefix}${err}`);
  }
  for (const h of missingHeadings(parsed.body, requiredHeadings(def, parsed.data))) {
    messages.push(`artifact-structure: ${relPath} is missing required heading "${h}" (type "${typeId}")`);
  }
  return messages;
}

function fileManifestFindings(
  repoRoot: string,
  relPath: string,
  options: ManifestOptions,
  contentChecks: boolean,
  isIgnored: () => boolean,
): Finding[] {
  const redirect = forbiddenRedirect(relPath, { forbidden: options.forbidden ?? [] });
  if (redirect !== null) {
    return [{
      ruleId: 'artifact-structure',
      path: relPath,
      message: `artifact-structure: ${relPath} is not allowed here. ${redirect}`,
      fingerprintBasis: relPath,
    }];
  }
  const matched = matchPath(relPath, options);
  if (matched !== null) {
    const def = options.types?.[matched.type];
    // Edit-time writes are drafts; only the gate content-checks.
    if (!contentChecks || !def || (def.frontmatter === undefined && def.headings === undefined && def.headingsWhen === undefined)) return [];
    return contentFindings(repoRoot, relPath, matched.type, def).map(message => ({
      ruleId: 'artifact-structure',
      path: relPath,
      message,
      fingerprintBasis: `${relPath}:${message}`,
    }));
  }
  const globs = options.govern ?? [];
  const governed = globs.some(g => forbiddenRedirect(relPath, { forbidden: [{ pattern: g, redirect: '' }] }) !== null);
  if (!governed) return [];
  if (isIgnored() && !inTypedArea(relPath, options)) return [];
  const stem = words(path.basename(relPath, path.extname(relPath))).join('-');
  const lines = nearestTypes(relPath, options, 2).flatMap(n => {
    const def = options.types?.[n.type];
    if (!def) return [];
    try {
      const params: Record<string, string> = {};
      for (const p of compileGenerates(def.generates).params) params[p.name] = p.name === 'slug' ? SLUG_SENTINEL : stem;
      const resolved = renderPath(def.generates, params).split(SLUG_SENTINEL).join('<slug>');
      return [`- ${n.type}: ${def.description ? `${def.description} ` : ''}-> ${resolved}`];
    } catch {
      return [];
    }
  });
  return [{
    ruleId: 'artifact-structure',
    path: relPath,
    message: [`artifact-structure: ${relPath} is outside every doc type path. Nearest types:`, ...lines].join('\n'),
    fingerprintBasis: relPath,
  }];
}

function manifestFindings(repoRoot: string, scoped: ScopedFile[], manifest: ManifestOptions, contentChecks: boolean): Finding[] {
  const findings: Finding[] = [];
  let ignored: Set<string> | null = null;
  for (const f of scoped) {
    if (!isNewFile(repoRoot, f.path)) continue;
    findings.push(...fileManifestFindings(repoRoot, f.path, manifest, contentChecks, () => {
      ignored ??= ignoredPaths(repoRoot, scoped.map(s => s.path));
      return ignored.has(f.path);
    }));
  }
  return findings;
}

/** Checks one file against the resolved manifest whether or not it is new in git. Writes nothing. */
export function checkDocConformance(repoRoot: string, relPath: string): Finding[] {
  const manifest = resolveManifest(repoRoot);
  if (manifest === null) return [];
  return fileManifestFindings(repoRoot, relPath, manifest, true, () => ignoredPaths(repoRoot, [relPath]).has(relPath));
}

const rule: Rule = {
  id: 'artifact-structure',
  meta: {
    description: 'Flags repo-shape bloat: coexisting synonym directory pairs, symmetric duplicate dirs, and root scratch files.',
  },
  async editCheck(edit: PendingEdit, _env: EditCheckEnv): Promise<EditCheckResult> {
    if (edit.pre !== null) return { findings: [] };
    const repoRoot = edit.repoRoot;
    if (repoRoot === null) return { findings: [] };
    const ctx: RuleContext = {
      repoRoot,
      mode: 'guard',
      files: [{ path: path.relative(repoRoot, edit.path), baseText: '', addedHunks: [], tracked: false, sessionCreated: true }],
    };
    return { findings: await rule.check(ctx) };
  },

  check(ctx: RuleContext): Finding[] {
    const { repoRoot, files = [] } = ctx;

    const scoped = files.filter(f => f.tracked === true || f.sessionCreated === true);

    const findings: Finding[] = [];

    const parentDirs = new Map<string, Set<string>>();

    function addFileDirs(filePath: string): void {
      const segments = filePath.split('/');
      for (let i = 0; i < segments.length - 1; i++) {
        const parent = segments.slice(0, i).join('/');
        const existing = parentDirs.get(parent) ?? new Set<string>();
        existing.add(segments[i]);
        parentDirs.set(parent, existing);
      }
    }

    function hasSpecialSegment(filePath: string): boolean {
      return filePath.split('/').some(s => s === 'node_modules' || s === '.git');
    }

    const gitResult = spawnSync(
      'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );

    if (gitResult.status === 0 && !gitResult.error) {
      for (const filePath of gitResult.stdout.split('\n')) {
        if (!filePath || hasSpecialSegment(filePath)) continue;
        addFileDirs(filePath);
      }
      // Add dirs from ctx.files that are not gitignored (guards writing new files)
      const candidates = files.filter(f => !hasSpecialSegment(f.path));
      const ignoredFiles = ignoredPaths(repoRoot, candidates.map(f => f.path));
      for (const f of candidates) {
        if (!ignoredFiles.has(f.path)) addFileDirs(f.path);
      }
    } else {
      (function walkFs(dir: string, relParent: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
          const existing = parentDirs.get(relParent) ?? new Set<string>();
          existing.add(e.name);
          parentDirs.set(relParent, existing);
          walkFs(path.join(dir, e.name), relParent ? `${relParent}/${e.name}` : e.name);
        }
      })(repoRoot, '');

      for (const f of files) {
        if (hasSpecialSegment(f.path)) continue;
        addFileDirs(f.path);
      }
    }

    const seenSynonym = new Set<string>();
    for (const [synonym, canonical] of Object.entries(CANONICAL_SYNONYMS)) {
      for (const [parent, dirSet] of parentDirs) {
        if (dirSet.has(synonym) && dirSet.has(canonical)) {
          const parentLabel = parent === '' ? 'root' : parent;
          for (const f of scoped) {
            if (seenSynonym.has(f.path)) continue;
            const segments = f.path.split('/');
            const depth = parent === '' ? 0 : parent.split('/').length;
            if (segments.length > depth) {
              const fileParent = segments.slice(0, depth).join('/');
              const dirAtDepth = segments[depth];
              if (fileParent === parent && dirAtDepth === synonym) {
                seenSynonym.add(f.path);
                findings.push({
                  ruleId: 'artifact-structure',
                  path: f.path,
                  message: `${synonym}/ and ${canonical}/ coexist under ${parentLabel}; merge ${synonym}/ into ${canonical}/`,
                  fingerprintBasis: f.path,
                });
              } else if (fileParent === parent && dirAtDepth === canonical) {
                seenSynonym.add(f.path);
                findings.push({
                  ruleId: 'artifact-structure',
                  path: f.path,
                  message: `${canonical}/ and ${synonym}/ coexist under ${parentLabel}; merge ${canonical}/ into ${synonym}/`,
                  fingerprintBasis: f.path,
                });
              }
            }
          }
        }
      }
    }

    const seenSymmetric = new Set<string>();
    for (const [a, b] of SYMMETRIC_PAIRS) {
      for (const [parent, dirSet] of parentDirs) {
        if (dirSet.has(a) && dirSet.has(b)) {
          const parentLabel = parent === '' ? 'root' : parent;
          for (const f of scoped) {
            if (seenSymmetric.has(f.path)) continue;
            const segments = f.path.split('/');
            const depth = parent === '' ? 0 : parent.split('/').length;
            if (segments.length > depth) {
              const fileParent = segments.slice(0, depth).join('/');
              const dirAtDepth = segments[depth];
              if (fileParent === parent && (dirAtDepth === a || dirAtDepth === b)) {
                seenSymmetric.add(f.path);
                findings.push({
                  ruleId: 'artifact-structure',
                  path: f.path,
                  message: `both ${a}/ and ${b}/ exist under ${parentLabel}; consolidate`,
                  fingerprintBasis: f.path,
                });
              }
            }
          }
        }
      }
    }

    // --- 3. Root scratch files ---
    for (const f of scoped) {
      if (f.path.includes('/')) continue;
      const filename = f.path;
      for (const pattern of ROOT_SCRATCH_PATTERNS) {
        if (pattern.test(filename)) {
          findings.push({
            ruleId: 'artifact-structure',
            path: f.path,
            message: `root scratch file: ${filename}`,
            fingerprintBasis: f.path,
          });
          break;
        }
      }
    }

    const manifest = resolveManifest(repoRoot);
    if (manifest !== null) findings.push(...manifestFindings(repoRoot, scoped, manifest, ctx.mode !== 'guard'));

    return findings;
  },
};

export default rule;
