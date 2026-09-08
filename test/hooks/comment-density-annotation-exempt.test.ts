import { describe, it, expect } from 'vitest';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';

const FAKE_PATH = '/tmp/gw-test-exempt.ts';

function lines(...chunks: string[]): string {
  return chunks.join('\n');
}

describe('effective density — exempt categories', () => {
  it('JSDoc block lines are exempt from effective count', () => {
    const content = lines(
      '/**',
      ' * @param x - the value',
      ' * @returns transformed value',
      ' */',
      'function transform(x: number) {',
      '  return x * 2',
      '}',
      ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(4);
    expect(r.effectiveCommentLines).toBe(0);
    expect(r.effectiveCommentsPer100).toBe(0);
  });

  it('inline comment lines (code before //) are exempt', () => {
    const content = lines(
      'const x = 1 // provenance: AC-7',
      'const y = 2 // $6.00 — verified ratio',
      'const z = 3 // inline note',
      ...Array.from({ length: 44 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(3);
    expect(r.effectiveCommentLines).toBe(0);
  });

  it('section-divider comments (// ────) are exempt', () => {
    const content = lines(
      '// ────────────────────────────────',
      '// ================================',
      '// -------- section header -------',
      ...Array.from({ length: 44 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(3);
    expect(r.effectiveCommentLines).toBe(0);
  });

  it('// @tag annotation lines are exempt', () => {
    const content = lines(
      '// @verifies AC-4',
      '// @ts-ignore',
      '// @type {string}',
      ...Array.from({ length: 44 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(3);
    expect(r.effectiveCommentLines).toBe(0);
  });

  it('URL-only lines (// https://...) are exempt', () => {
    const content = lines(
      '// https://docs.anthropic.com/en/api',
      '// https://example.com/reference',
      ...Array.from({ length: 45 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(2);
    expect(r.effectiveCommentLines).toBe(0);
  });

  it('pure // narration lines are NOT exempt — gate bites', () => {
    const narration = [
      '// This is a narration comment about what the code does',
      '// Here we multiply the value',
      '// And return the result',
    ];
    const content = lines(
      ...narration,
      ...Array.from({ length: 37 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(3);
    expect(r.effectiveCommentLines).toBe(3);
    expect(r.effectiveCommentsPer100).toBeGreaterThan(5);
  });

  it('mixed: JSDoc + narration — only narration counted in effective', () => {
    const content = lines(
      '/**',
      ' * @param x - value',
      ' */',
      'function go(x: number) { return x }',
      '// this explains what go does',
      ...Array.from({ length: 42 }, (_, i) => `const v${i} = ${i}`),
    );
    const r = analyzeFile(FAKE_PATH, content);
    expect(r.commentLines).toBe(4);
    expect(r.effectiveCommentLines).toBe(1);
    expect(r.effectiveLines).toEqual(
      expect.arrayContaining([5]),
    );
  });

  it('three flagged files have effective density ≤5/100 each', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '../..');
    const files = [
      'hooks/token-meter.mjs',
      'test/hooks/prose-guard-helpers-parity.test.ts',
      'test/hooks/token-meter.test.ts',
    ];
    for (const rel of files) {
      const abs = join(root, rel);
      const content = readFileSync(abs, 'utf8');
      const r = analyzeFile(abs, content);
      expect(r.effectiveCommentsPer100, `${rel} effectiveCommentsPer100`).toBeLessThanOrEqual(5);
      expect(r.commentsPer100, `${rel} commentsPer100 (raw) exceeds 5 — guard still needed`).toBeGreaterThan(5);
    }
  });
});
