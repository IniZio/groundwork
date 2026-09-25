import { spawnSync } from 'node:child_process';

export function defaultBase(repoRoot: string): string {
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], { encoding: 'utf8' });
    if (r.status === 0) return ref;
  }
  return 'HEAD';
}
