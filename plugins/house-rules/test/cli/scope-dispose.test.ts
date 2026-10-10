import { describe, it, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAllTrackedContext } from '../../src/cli/scope.js';

describe('buildAllTrackedContext dispose', () => {
  it('deletes parsed trees when disposed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-dispose-'));
    try {
      execFileSync('git', ['-C', dir, 'init', '-q']);
      fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
      execFileSync('git', ['-C', dir, 'add', 'a.ts']);
      const ctx = buildAllTrackedContext(dir);
      const file = ctx.files![0]!;
      const res = await ctx.sourceFile!(file);
      if (!res || !res.ok) throw new Error('parse failed');
      const tree = res.source.tree;
      expect(() => tree.rootNode.type).not.toThrow();
      ctx.dispose();
      await new Promise(r => setTimeout(r, 0));
      expect(() => tree.rootNode.type).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
