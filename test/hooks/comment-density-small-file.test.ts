import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildManifest } from '../../src/gw/cli/commands/comment-density.js';
import { SMALL_FILE_MIN_LINES } from '../../hooks/lib/comment-density.mjs';

describe('SMALL_FILE_MIN_LINES constant', () => {
  it('is 40', () => expect(SMALL_FILE_MIN_LINES).toBe(40));
});

describe('SMALL_FILE_MIN_LINES floor', () => {
  it('small file (<40 lines, ratio > FILE_CAP) NOT flagged as over-cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-density-test-'));
    const lines = [
      '// comment 1',
      '// comment 2',
      '// comment 3',
      '// comment 4',
      '// comment 5',
      '// comment 6',
      'export function foo() { return 1; }',
      'export function bar() { return 2; }',
      'export function baz() { return 3; }',
      'export function qux() { return 4; }',
      'export function quux() { return 5; }',
      'export function a() { return 6; }',
      'export function b() { return 7; }',
      'export function c() { return 8; }',
      'export function d() { return 9; }',
    ];
    writeFileSync(join(dir, 'small.ts'), lines.join('\n'));
    const manifest = await buildManifest(['small.ts'], dir);
    const flagged = manifest.files.find(f => f.path.endsWith('small.ts'));
    const overCap = flagged?.reasons.find(r => r.kind === 'over-cap');
    expect(
      overCap,
      `expected commentsPer100 40.0 not to be over-cap for 15-line file (totalLines < SMALL_FILE_MIN_LINES=${SMALL_FILE_MIN_LINES})`,
    ).toBeUndefined();
  });

  it('large file (>=40 lines, ratio > FILE_CAP) IS flagged as over-cap (positive control)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gw-density-test-'));
    const commentLines = Array.from({ length: 10 }, (_, i) => `// comment ${i}`);
    const codeLines = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`);
    writeFileSync(join(dir, 'large.ts'), [...commentLines, ...codeLines].join('\n'));
    const manifest = await buildManifest(['large.ts'], dir);
    const flagged = manifest.files.find(f => f.path.endsWith('large.ts'));
    const overCap = flagged?.reasons.find(r => r.kind === 'over-cap');
    expect(
      overCap,
      `expected large.ts (50 lines, 20/100) to be flagged as over-cap when totalLines >= SMALL_FILE_MIN_LINES(${SMALL_FILE_MIN_LINES})`,
    ).toBeDefined();
  });
});
