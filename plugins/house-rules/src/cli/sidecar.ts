import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serializeReport, type Report } from './report.js';

export const SIDECAR_REL = '.groundwork/house-rules/check-report.json';
const EXCLUDE_LINE = '.groundwork/';

function excludeFile(repoRoot: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  return path.resolve(repoRoot, r.stdout.trim());
}

function upsertExclude(file: string): void {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur.split('\n').some(l => l.trim() === EXCLUDE_LINE)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = cur === '' || cur.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, cur + sep + EXCLUDE_LINE + '\n');
}

/** Write the full JSON report under .groundwork/ and git-exclude that dir; returns the sidecar path. */
export function writeSidecar(repoRoot: string, report: Report): string {
  const target = path.join(repoRoot, SIDECAR_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeReport(report) + '\n');
  const ex = excludeFile(repoRoot);
  if (ex) upsertExclude(ex);
  return target;
}
