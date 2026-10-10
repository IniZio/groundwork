import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ruleTester } from '../../src/engine/rule-tester.js';
import rule from './index.js';
import { cases } from './cases.js';

ruleTester(rule, cases);

describe('batched git check-ignore', () => {
  it('skips ignored ctx files (space in name) when building synonym dirs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ignore-'));
    const git = (...a: string[]) => spawnSync('git', a, { cwd: dir });
    git('init', '-q');
    fs.mkdirSync(path.join(dir, 'doc'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'doc', 'a.md'), 'a');
    fs.writeFileSync(path.join(dir, 'docs', 'my file.md'), 'b');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'docs/\n');
    const file = (p: string) => ({ path: p, baseText: '', addedHunks: [], tracked: false, sessionCreated: true });
    const ignored = await rule.check({ repoRoot: dir, mode: 'guard', files: [file('docs/my file.md')] });
    expect(ignored).toEqual([]);
    fs.writeFileSync(path.join(dir, '.gitignore'), '');
    const visible = await rule.check({ repoRoot: dir, mode: 'guard', files: [file('docs/my file.md')] });
    expect(visible.length).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
