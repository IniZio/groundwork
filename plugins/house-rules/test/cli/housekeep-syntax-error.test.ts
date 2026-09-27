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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-hkse-'));
  dirs.push(d);
  return d;
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

function git(dir: string, args: string[]): string {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
}

function initRepo(dir: string): string {
  git(dir, ['init']);
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'init']);
  return git(dir, ['rev-parse', 'HEAD']);
}

function addAndCommit(dir: string, files: string[], msg: string): string {
  for (const f of files) {
    git(dir, ['add', f]);
  }
  git(dir, ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', msg]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// 20 lines alternating comments/code + syntax error on line 21
const FIXTURE_WITH_ERROR =
  [...Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// r${i}` : `const x${i} = ${i};`), 'const broken = ;'].join('\n') + '\n';

// Same fixture without the broken line (fixable)
const FIXTURE_CLEAN =
  [...Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// r${i}` : `const x${i} = ${i};`)].join('\n') + '\n';

describe('housekeep syntax-error guard', () => {
  it('housekeep does not rewrite a file with syntax errors and prints declined reason', () => {
    const repoDir = mktemp();
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'bad.ts'), FIXTURE_WITH_ERROR);
    addAndCommit(repoDir, ['bad.ts'], 'add over-budget file with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    const afterContent = fs.readFileSync(path.join(repoDir, 'bad.ts'), 'utf8');
    expect(afterContent).toBe(FIXTURE_WITH_ERROR);

    expect(r.stdout).toContain('syntax errors on rows ');
    expect(r.stdout).toContain('; not autofixed');
    expect(r.stdout).toContain('syntax errors on rows 21; not autofixed');
  });

  it('housekeep --dry-run does not rewrite a file with syntax errors and prints declined reason', () => {
    const repoDir = mktemp();
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'bad.ts'), FIXTURE_WITH_ERROR);
    addAndCommit(repoDir, ['bad.ts'], 'add over-budget file with syntax error');

    const r = spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir, '--dry-run'], {
      encoding: 'utf8',
      env: childEnv(),
    });

    const afterContent = fs.readFileSync(path.join(repoDir, 'bad.ts'), 'utf8');
    expect(afterContent).toBe(FIXTURE_WITH_ERROR);

    expect(r.stdout).toContain('syntax errors on rows 21; not autofixed');
  });

  it('housekeep fixes the same fixture without the syntax error (positive control)', () => {
    const repoDir = mktemp();
    const baseSha = initRepo(repoDir);

    fs.writeFileSync(path.join(repoDir, 'good.ts'), FIXTURE_CLEAN);
    addAndCommit(repoDir, ['good.ts'], 'add over-budget file without syntax error');

    spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(),
    });

    const afterContent = fs.readFileSync(path.join(repoDir, 'good.ts'), 'utf8');
    expect(afterContent).not.toBe(FIXTURE_CLEAN);
  });
});
