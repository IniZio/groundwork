import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

const SOURCE = [
  'export function isString(value: unknown): value is string {',
  '  return typeof value === "string";',
  '}',
  '',
  'export function parse(value: unknown): string {',
  '  if (typeof value !== "string") throw new Error("no");',
  '  return value;',
  '}',
  '',
].join('\n');
const GUARD_LINE = 2;
const PLAIN_LINE = 6;

function makeRepo(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-type-guards-'));
  spawnSync('git', ['init', '-b', 'main', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/guard.ts'), SOURCE, 'utf8');
  fs.writeFileSync(path.join(dir, '.house-rules.json'), JSON.stringify({ rules: config }), 'utf8');
  spawnSync('git', ['-C', dir, 'add', '.'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', 'add guard'], { encoding: 'utf8' });
  return dir;
}

interface Row { path: string; line: number; message: string }

function typeofRows(dir: string): Row[] {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(BIN, ['check', '--all', '--format', 'json', '--repo', dir], { cwd: dir, encoding: 'utf8', env });
  const report = JSON.parse(r.stdout) as { findings: Row[] };
  return report.findings.filter((f) => f.message.includes('[no-runtime-typeof]'));
}

describe('type-escape-hatches allowInTypeGuards (CLI)', () => {
  it('option on: guard line is not reported, non-guard typeof still is', () => {
    const dir = makeRepo({ 'type-escape-hatches': ['warn', { allowInTypeGuards: true }] });
    try {
      const rows = typeofRows(dir);
      expect(rows.map((r) => [r.path, r.line])).toEqual([['src/guard.ts', PLAIN_LINE]]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('option off: guard line and non-guard line are both reported', () => {
    const dir = makeRepo({ 'type-escape-hatches': 'warn' });
    try {
      const rows = typeofRows(dir);
      expect(rows.map((r) => [r.path, r.line])).toEqual([
        ['src/guard.ts', GUARD_LINE],
        ['src/guard.ts', PLAIN_LINE],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
