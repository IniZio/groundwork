import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CLI_MAIN = path.resolve(import.meta.dir, '../../src/cli/main.ts');
const RULES_DIR = path.resolve(import.meta.dir, '../../rules');

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

function checkSources(): string[] {
  return fs.readdirSync(RULES_DIR, { recursive: true, encoding: 'utf8' })
    .filter(rel => rel.split(path.sep).includes('checks') && rel.endsWith('.ts') && !rel.endsWith('.test.ts'));
}

describe('house-rules check sources', () => {
  it('parse without errors when checked from the repo root', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-own-checks-'));
    try {
      const sources = checkSources();
      expect(sources).toContain(path.join('type-escape-hatches', 'checks', 'no-object-parameters.ts'));
      for (const rel of sources) {
        const dest = path.join(repo, 'plugins', 'house-rules', 'rules', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(RULES_DIR, rel), dest);
      }
      spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
      spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' });

      const r = spawnSync('bun', [CLI_MAIN, 'check', '--all', 'plugins/house-rules/rules'], {
        cwd: repo, encoding: 'utf8', env: childEnv(),
      });
      const out = r.stdout + r.stderr;

      expect(out).toContain(`files=${sources.length}`);
      expect(out).not.toContain('partially checked');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});
