import fs from 'node:fs';
import path from 'node:path';
import { isManifest } from './generated/project-deps-validators.mjs';

export interface ProjectFacts {
  /** Names in `dependencies` and `devDependencies` of the nearest package.json at or above the file, up to the repo root. */
  dependencies: ReadonlySet<string>;
}

const NO_DEPENDENCIES: ProjectFacts = Object.freeze({ dependencies: new Set<string>() });
const factsByDir = new Map<string, ProjectFacts>();

function readManifest(file: string): ProjectFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return NO_DEPENDENCIES;
  }
  if (!isManifest(parsed)) return NO_DEPENDENCIES;
  return { dependencies: new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]) };
}

/** Facts for the package that owns `filePath`; cached per directory, so each package.json is read once per process. */
export function projectFacts(repoRoot: string | null, filePath: string): ProjectFacts {
  if (!repoRoot) return NO_DEPENDENCIES;
  const root = path.resolve(repoRoot);
  const visited: string[] = [];
  let facts = NO_DEPENDENCIES;
  for (let dir = path.dirname(path.resolve(root, filePath)); ; dir = path.dirname(dir)) {
    const cached = factsByDir.get(dir);
    if (cached) { facts = cached; break; }
    visited.push(dir);
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) { facts = readManifest(manifest); break; }
    if (dir === root || !dir.startsWith(root + path.sep)) break;
  }
  for (const dir of visited) factsByDir.set(dir, facts);
  return facts;
}
