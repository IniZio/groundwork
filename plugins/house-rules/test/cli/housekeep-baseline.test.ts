import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  return env;
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-baseline-test-'));
  spawnSync('git', ['init', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  spawnSync('git', ['-C', dir, 'add', '.gitkeep'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', 'init'], { encoding: 'utf8' });
  return dir;
}

// 6 comment lines / 10 total = 60/100, well above the 5/100 cap.
const VIOLATION_CONTENT = [
  '// comment one',
  '// comment two',
  '// comment three',
  '// comment four',
  '// comment five',
  '// comment six',
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
].join('\n') + '\n';

describe('housekeep --baseline: comment-density fix and entry pruning', () => {
  test('fixes violation and prunes the baseline entry', () => {
    const tmpDir = makeTempRepo();
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'foo.ts');
      fs.writeFileSync(filePath, VIOLATION_CONTENT, 'utf8');
      spawnSync('git', ['-C', tmpDir, 'add', 'src/foo.ts'], { encoding: 'utf8' });
      spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'add foo with violations'], { encoding: 'utf8' });

      // Generate baseline: diff vs HEAD~1 so foo.ts is fully "added"
      const baselineR = spawnSync(BIN, ['baseline', '--repo', tmpDir, '--base', 'HEAD~1'], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(baselineR.status).toBe(0);

      const baselinePath = path.join(tmpDir, '.house-rules', 'baseline.json');
      expect(fs.existsSync(baselinePath)).toBe(true);

      const baselineBefore = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const cdEntry = baselineBefore.entries.find((e: { rule: string }) => e.rule === 'comment-density');
      expect(cdEntry).toBeDefined();
      const entryFingerprint: string = cdEntry.fingerprint;

      // Run housekeep --baseline (no --since: uses empty tree, all lines added)
      const hkR = spawnSync(BIN, ['housekeep', '--baseline', '--repo', tmpDir], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(hkR.status).toBe(0);

      // File content must have changed (comments removed by autofix)
      const afterContent = fs.readFileSync(filePath, 'utf8');
      expect(afterContent).not.toBe(VIOLATION_CONTENT);

      const baselineAfter = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const entryStillPresent = baselineAfter.entries.some(
        (e: { fingerprint: string }) => e.fingerprint === entryFingerprint,
      );
      expect(entryStillPresent).toBe(false);

      const checkR = spawnSync(BIN, ['check', '--repo', tmpDir, '--base', 'HEAD~1'], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(checkR.status).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
