import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

const CONTENT = 'export function f(y: unknown) {\n  return (y as any).z;\n}\n';

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

function git(dir: string, ...args: string[]) {
  spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

describe('check --all on a TypeScript file named like a Dockerfile', () => {
  it('checks dockerfile.ts as TypeScript instead of reporting a parse failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-dockerfile-ts-'));
    try {
      git(dir, 'init', '-b', 'main');
      git(dir, 'config', 'user.email', 'test@example.com');
      git(dir, 'config', 'user.name', 'Test User');
      fs.writeFileSync(path.join(dir, 'dockerfile.ts'), CONTENT, 'utf8');
      git(dir, 'add', 'dockerfile.ts');
      git(dir, 'commit', '-m', 'add dockerfile.ts');

      const r = spawnSync(BIN, ['check', '--all'], { cwd: dir, encoding: 'utf8', env: childEnv() });

      expect(r.stdout).toContain(
        'dockerfile.ts:1 type-escape-hatches [no-unknown-parameters] Parameter `y` leaves input unparsed.',
      );
      expect(r.stdout).not.toContain('partially checked: dockerfile.ts');
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
