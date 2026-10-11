import { spawnSync } from 'node:child_process';

const MARKER = /@generated|DO NOT EDIT/;
const COMMENT_START = /^\s*(\/\/|\/\*|\*|#|<!--|--|;|%)/;
const HEADER_LINES = 5;

export function isGeneratedText(text: string): boolean {
  const lines = text.split('\n', HEADER_LINES);
  return lines.some((line) => COMMENT_START.test(line) && MARKER.test(line));
}

export function generatedPaths(repoRoot: string, paths: string[]): Set<string> {
  const out = new Set<string>();
  if (paths.length === 0) return out;
  const r = spawnSync('git', ['check-attr', '-z', '--stdin', 'linguist-generated', 'linguist-vendored'], {
    cwd: repoRoot,
    input: paths.join('\0') + '\0',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return out;
  const f = r.stdout.split('\0');
  for (let i = 0; i + 2 < f.length; i += 3) {
    if (f[i + 2] === 'set' || f[i + 2] === 'true') out.add(f[i]!);
  }
  return out;
}
