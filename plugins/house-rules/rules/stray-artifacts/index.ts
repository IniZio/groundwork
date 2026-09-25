import type { Rule, RuleContext, Finding } from '../../src/engine/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const rule: Rule = {
  id: 'stray-artifacts',
  meta: {
    description: 'Flags repo-shape bloat: coexisting synonym directory pairs, symmetric duplicate dirs, and root scratch files.',
  },
  vehicles: ['tree'],

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
      for (const f of files) {
        if (hasSpecialSegment(f.path)) continue;
        const ignore = spawnSync('git', ['check-ignore', '-q', '--', f.path], { cwd: repoRoot });
        if (ignore.status !== 0) addFileDirs(f.path);
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
                  ruleId: 'stray-artifacts',
                  path: f.path,
                  message: `${synonym}/ and ${canonical}/ coexist under ${parentLabel}; merge ${synonym}/ into ${canonical}/`,
                  fingerprintBasis: f.path,
                });
              } else if (fileParent === parent && dirAtDepth === canonical) {
                seenSynonym.add(f.path);
                findings.push({
                  ruleId: 'stray-artifacts',
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
                  ruleId: 'stray-artifacts',
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
            ruleId: 'stray-artifacts',
            path: f.path,
            message: `root scratch file: ${filename}`,
            fingerprintBasis: f.path,
          });
          break;
        }
      }
    }

    return findings;
  },
};

export default rule;
