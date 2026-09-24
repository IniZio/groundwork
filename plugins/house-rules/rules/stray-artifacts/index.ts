import type { Rule, RuleContext, Finding } from '../../src/engine/types.js';
import fs from 'node:fs';
import path from 'node:path';

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
    description: 'Flags repo-shape bloat: non-canonical directory names, symmetric duplicate dirs, and root scratch files.',
  },
  vehicles: ['tree'],

  check(ctx: RuleContext): Finding[] {
    const { repoRoot, files = [] } = ctx;

    const scoped = files.filter(f => f.tracked === true || f.sessionCreated === true);

    const findings: Finding[] = [];
    const seenSymmetric = new Set<string>();

    // --- 1. Canonical synonyms ---
    for (const f of scoped) {
      const segments = f.path.split('/');
      const dirs = segments.slice(0, -1);
      for (const seg of dirs) {
        if (seg in CANONICAL_SYNONYMS) {
          findings.push({
            ruleId: 'stray-artifacts',
            path: f.path,
            message: `use ${CANONICAL_SYNONYMS[seg]}/ (canonical) instead of ${seg}/`,
            fingerprintBasis: f.path,
          });
          break;
        }
      }
    }

    // --- 2. Symmetric pairs ---
    const parentDirs = new Map<string, Set<string>>();

    function collectDirsFromFs(dir: string, relParent: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const dirNames = new Set<string>();
      for (const e of entries) {
        if (e.isDirectory()) {
          dirNames.add(e.name);
        }
      }
      if (dirNames.size > 0) {
        const existing = parentDirs.get(relParent) ?? new Set<string>();
        for (const d of dirNames) existing.add(d);
        parentDirs.set(relParent, existing);
        // Recurse
        for (const d of dirNames) {
          collectDirsFromFs(path.join(dir, d), relParent ? `${relParent}/${d}` : d);
        }
      }
    }
    collectDirsFromFs(repoRoot, '');

    // Also derive dirs from all ctx.files entries (regardless of scope)
    for (const f of files) {
      const segments = f.path.split('/');
      for (let i = 0; i < segments.length - 1; i++) {
        const parent = segments.slice(0, i).join('/');
        const dirName = segments[i];
        const existing = parentDirs.get(parent) ?? new Set<string>();
        existing.add(dirName);
        parentDirs.set(parent, existing);
      }
    }

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
