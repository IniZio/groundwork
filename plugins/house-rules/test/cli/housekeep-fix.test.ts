import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function mktemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-hkfix-'));
  dirs.push(d);
  return d;
}

function initRepo(dir: string): string {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
    'commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' }).stdout.trim();
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

describe('housekeep fix writes file to disk', () => {
  it('comment-density housekeep fixes file content AND re-check exits 0', () => {
    const repoDir = mktemp();
    const baseSha = initRepo(repoDir);

    const fileContent = [
      '// remove me 1',
      '// remove me 2',
      '// remove me 3',
      '// remove me 4',
      '// remove me 5',
      '// remove me 6',
      'export const a = 1;',
      'export const b = 2;',
      'export const c = 3;',
      'export const d = 4;',
      'export const e = 5;',
    ].join('\n') + '\n';

    const filePath = path.join(repoDir, 'dense.ts');
    fs.writeFileSync(filePath, fileContent);
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
      'add', 'dense.ts'], { cwd: repoDir });
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
      'commit', '-m', 'add dense'], { cwd: repoDir });

    spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    const afterContent = fs.readFileSync(filePath, 'utf8');
    expect(afterContent, 'file content must change after housekeep').not.toBe(fileContent);

    const check = spawnSync(BIN, ['check', '--base', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });
    expect(check.status, 'check must exit 0 after housekeep fix').toBe(0);
  });
});
