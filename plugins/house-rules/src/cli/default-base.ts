import { spawnSync } from 'node:child_process';
import { forkPoint } from '../hooks/lib/work-scope.js';

export function defaultBase(repoRoot: string): string {
  const branch = spawnSync('git', ['-C', repoRoot, 'symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const fork = branch ? forkPoint(repoRoot, branch) : null;
  if (fork) return fork.ref;
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], { encoding: 'utf8' });
    if (r.status === 0) return ref;
  }
  return 'HEAD';
}
