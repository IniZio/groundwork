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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-bmod-'));
  spawnSync('git', ['init', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  spawnSync('git', ['-C', dir, 'add', '.gitkeep'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'commit', '-m', 'init'], { encoding: 'utf8' });
  return dir;
}

// Pre-existing header comment (1 line), then 40 code lines.
// After commit, we'll add 6 more comments to trigger comment-density.
const HEADER = '// file-level header comment — keep me\n';
const CODE_40 = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

const SIX_COMMENTS = Array.from({ length: 6 }, (_, i) => `// added comment ${i}`).join('\n') + '\n';

describe('housekeep --baseline (modified file, no --since)', () => {
  test('AC3: baseline base recorded; housekeep --baseline without --since fixes and prunes', () => {
    const tmpDir = makeTempRepo();
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'target.ts');

      // Commit 1: header + 40 code lines (no violation)
      fs.writeFileSync(filePath, HEADER + CODE_40, 'utf8');
      spawnSync('git', ['-C', tmpDir, 'add', 'src/target.ts'], { encoding: 'utf8' });
      spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'base commit'], { encoding: 'utf8' });

      // Commit 2: add 6 comments (now violates comment-density)
      const violationContent = HEADER + SIX_COMMENTS + CODE_40;
      fs.writeFileSync(filePath, violationContent, 'utf8');
      spawnSync('git', ['-C', tmpDir, 'add', 'src/target.ts'], { encoding: 'utf8' });
      spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'add comments'], { encoding: 'utf8' });

      // Record baseline: diff vs HEAD~1 (sees only the 6 added comment lines)
      const blR = spawnSync(BIN, ['baseline', '--repo', tmpDir, '--base', 'HEAD~1'], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(blR.status).toBe(0);

      const baselinePath = path.join(tmpDir, '.house-rules', 'baseline.json');
      expect(fs.existsSync(baselinePath)).toBe(true);

      const blJson = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      // AC1: base SHA is recorded
      expect(typeof blJson.base).toBe('string');
      expect(blJson.base).toHaveLength(40);

      const cdEntry = blJson.entries.find((e: { rule: string }) => e.rule === 'comment-density');
      expect(cdEntry).toBeDefined();
      const entryFp: string = cdEntry.fingerprint;

      const hkR = spawnSync(BIN, ['housekeep', '--baseline', '--repo', tmpDir], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(hkR.status).toBe(0);

      const afterContent = fs.readFileSync(filePath, 'utf8');
      expect(afterContent).not.toBe(violationContent);

      expect(afterContent).toContain('// file-level header comment — keep me');

      const blAfter = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const entryStill = blAfter.entries.some((e: { fingerprint: string }) => e.fingerprint === entryFp);
      expect(entryStill).toBe(false);

      const checkR = spawnSync(BIN, ['check', '--repo', tmpDir, '--base', 'HEAD~1'], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(checkR.status).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('AC3 second: unmatched baseline entry appears in "needs manual fix" output', () => {
    const tmpDir = makeTempRepo();
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      const filePath = path.join(tmpDir, 'src', 'clean.ts');

      const violationContent = Array.from({ length: 6 }, (_, i) => `// comment ${i}`).join('\n') +
        '\n' + Array.from({ length: 4 }, (_, i) => `export const x${i} = ${i};`).join('\n') + '\n';
      fs.writeFileSync(filePath, violationContent, 'utf8');
      spawnSync('git', ['-C', tmpDir, 'add', 'src/clean.ts'], { encoding: 'utf8' });
      spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'violating file'], { encoding: 'utf8' });

      const blR = spawnSync(BIN, ['baseline', '--repo', tmpDir, '--base', 'HEAD~1'], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(blR.status).toBe(0);

      const baselinePath = path.join(tmpDir, '.house-rules', 'baseline.json');
      const blBefore = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      expect(blBefore.entries.length).toBeGreaterThan(0);

      fs.writeFileSync(filePath, 'export const x = 1;\n', 'utf8');
      spawnSync('git', ['-C', tmpDir, 'add', 'src/clean.ts'], { encoding: 'utf8' });
      spawnSync('git', ['-C', tmpDir, 'commit', '-m', 'fix file'], { encoding: 'utf8' });

      const hkR = spawnSync(BIN, ['housekeep', '--baseline', '--repo', tmpDir], {
        encoding: 'utf8',
        env: childEnv(),
      });
      expect(hkR.status).toBe(0);

      const combined = hkR.stdout + hkR.stderr;
      expect(combined).toContain('need manual fix');
      expect(combined).toContain('src/clean.ts');
      expect(combined).toContain('baseline entry, no matching violation found');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
