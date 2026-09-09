/** Parity test: comment-density engine vs. pilot counting rules.
 * Engine: hooks/lib/comment-density.mjs (analyzeFile API)
 * Pilot: test/hooks/pilot-count-comments.mjs (vendored from agentic-artifacts/scripts/check-comment-density.mjs)
 * Tolerance: ±1.0 per 100 after delta corrections; residual covers INLINE/LICENSE/TS_DIR. */

import { describe, it, expect } from 'vitest';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';
import { countComments as pilotCount } from './pilot-count-comments.mjs';

const DELTA_CLASSES = {
  SHEBANG: 'Engine counts #! on line 1 for shell-classified files; pilot skips unconditionally.',
  TS_DIR:  'Pilot skips //@ts- and // @ts- directives; engine counts them.',
  INLINE:  'Engine detects trailing // after code via string-aware scanner; pilot only counts lines whose trimmed form starts with //.',
  LICENSE: 'Pilot skips /* block opening within first 3 lines and closing by line 2 (0-based); engine counts it.',
  EXCL_SET: "Engine's D-8 exclusion list differs from pilot's AdonisJS-specific list.",
};
void DELTA_CLASSES;

function classifyEngineLines(
  engineLineNums: number[],
  rawLines: string[],
): { tsDirLines: number; inlineLines: number; licenseLines: number } {
  let tsDirLines = 0;
  let inlineLines = 0;
  let licenseLines = 0;
  for (const num of engineLineNums) {
    const lineIdx = num - 1;
    const raw = rawLines[lineIdx] ?? '';
    const t = raw.trim();
    if (t.startsWith('//@ts-') || t.startsWith('// @ts-')) {
      tsDirLines++;
    } else if ((t.startsWith('/*') || t.startsWith('{/*')) && lineIdx < 3) {
      const isJsx = t.startsWith('{/*');
      const closeIdx = t.indexOf('*/', isJsx ? 3 : 2);
      if (closeIdx !== -1) {
        licenseLines++;
      } else {
        let closesBy = -1;
        for (let j = lineIdx + 1; j < rawLines.length && j <= 2; j++) {
          if (rawLines[j].trim().includes('*/')) { closesBy = j; break; }
        }
        if (closesBy !== -1 && closesBy < 3) licenseLines++;
      }
    } else if (
      t.startsWith('//') || t.startsWith('/*') || t.startsWith('/**') ||
      t.startsWith('{/*') || t.startsWith('*')
    ) {
      // pure comment — pilot counts these too
    } else {
      inlineLines++;
    }
  }
  return { tsDirLines, inlineLines, licenseLines };
}

const FIXTURES: Array<{ name: string; relPath: string; content: string }> = [
  {
    name: 'plain-comments',
    relPath: 'src/utils/plain-comments.ts',
    content: [
      '// Pure comment one',
      'function greet(name: string): string {',
      "  // Pure comment two",
      "  const msg = 'hello ' + name;",
      '  return msg;',
      '}',
      '// Pure comment three',
      '',
    ].join('\n'),
  },
  {
    name: 'ts-directives',
    relPath: 'src/utils/ts-directives.ts',
    content: [
      '//@ts-ignore',
      'const val: unknown = {};',
      '// @ts-expect-error',
      'const result = (val as any).missing;',
      '// Regular comment',
      'function noop(): void {}',
      '',
    ].join('\n'),
  },
  {
    name: 'inline-trailing',
    relPath: 'src/utils/inline-trailing.ts',
    content: [
      'function calc(x: number): number {',
      '  const a = x * 2; // scale factor',
      '  const b = a + 1; // offset',
      '  // pure comment',
      '  return b;',
      '}',
      '',
    ].join('\n'),
  },
  {
    name: 'license-header',
    relPath: 'src/utils/license-header.ts',
    content: [
      '/** Module-level description comment. */',
      'function init(): void {',
      '  // startup comment',
      '  const ready = true;',
      '  void ready;',
      '}',
      '',
    ].join('\n'),
  },
];

describe('comment-density pilot parity — in-repo fixtures', () => {
  it('per-file engine numbers within ±1.0 of pilot (or explained delta)', () => {
    type Row = {
      file: string;
      pilotComments: number;
      pilotTotal: number;
      pilotPer100: number;
      engineComments: number;
      engineTotal: number;
      enginePer100: number;
      delta: number;
      tsDirLines: number;
      inlineLines: number;
      licenseLines: number;
      explanation: string;
      status: 'match' | 'explained' | 'unexplained';
    };

    const rows: Row[] = [];
    const unexplained: Row[] = [];

    for (const { name, relPath, content } of FIXTURES) {
      const { comments: pilotComments, total: pilotTotal } = pilotCount(content);
      const engineResult = analyzeFile(relPath, content);
      if (engineResult.excluded) continue;

      const rawLines    = content.split('\n');
      const pilotPer100 = pilotTotal === 0 ? 0 : (pilotComments / pilotTotal) * 100;
      const enginePer100 = engineResult.commentsPer100;
      const delta        = enginePer100 - pilotPer100;

      const { tsDirLines, inlineLines, licenseLines } =
        classifyEngineLines(engineResult.lines, rawLines);
      const explainedLines  = tsDirLines + inlineLines + licenseLines;
      const explainedDelta  = pilotTotal === 0 ? 0 : (explainedLines / pilotTotal) * 100;
      const residualDelta   = delta - explainedDelta;

      let explanation: string;
      let status: Row['status'];

      if (explainedLines > 0 && Math.abs(residualDelta) <= 1.0) {
        const parts: string[] = [];
        if (tsDirLines > 0)   parts.push(`ts-dir=${tsDirLines}`);
        if (inlineLines > 0)  parts.push(`inline=${inlineLines}`);
        if (licenseLines > 0) parts.push(`license=${licenseLines}`);
        explanation = parts.join(' ');
        status = 'explained';
      } else if (Math.abs(delta) <= 1.0) {
        explanation = delta === 0 ? 'exact' : 'within tolerance';
        status = 'match';
      } else {
        explanation = `UNEXPLAINED: delta=${delta.toFixed(2)}, ts-dir=${tsDirLines}, inline=${inlineLines}, license=${licenseLines}, residual=${residualDelta.toFixed(2)}`;
        status = 'unexplained';
      }

      const row: Row = {
        file: name,
        pilotComments,
        pilotTotal,
        pilotPer100,
        engineComments: engineResult.commentLines,
        engineTotal: engineResult.totalLines,
        enginePer100,
        delta,
        tsDirLines,
        inlineLines,
        licenseLines,
        explanation,
        status,
      };
      rows.push(row);
      if (status === 'unexplained') unexplained.push(row);
    }

    const divider = '─'.repeat(120);
    console.log('\n' + divider);
    console.log(
      `${'FILE'.padEnd(35)} ${'PILOT'.padStart(6)} ${'ENGINE'.padStart(7)} ${'Δ/100'.padStart(7)}  EXPLANATION`
    );
    console.log(divider);

    for (const r of rows) {
      const tag = r.status === 'unexplained' ? '❌' : r.status === 'explained' ? '✓ exp' : '✓';
      console.log(
        `${r.file.padEnd(35)} ${r.pilotPer100.toFixed(1).padStart(6)} ${r.enginePer100.toFixed(1).padStart(7)} ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2).padStart(6)}  ${tag} ${r.explanation}`
      );
    }

    console.log(divider);
    console.log(
      `Files compared: ${rows.length}  |  exact/match: ${rows.filter(r => r.status === 'match').length}  |  explained: ${rows.filter(r => r.status === 'explained').length}  |  unexplained: ${unexplained.length}`
    );
    console.log(divider + '\n');

    for (const r of rows.filter(r => r.status === 'match')) {
      expect(
        Math.abs(r.delta),
        `${r.file}: pilot=${r.pilotPer100.toFixed(2)} engine=${r.enginePer100.toFixed(2)} delta=${r.delta.toFixed(2)}`
      ).toBeLessThanOrEqual(1.0);
    }

    for (const r of rows.filter(r => r.status === 'explained')) {
      const expectedPer100 = r.pilotTotal === 0
        ? 0
        : ((r.pilotComments + r.tsDirLines + r.inlineLines + r.licenseLines) / r.pilotTotal) * 100;
      expect(
        Math.abs(r.enginePer100 - expectedPer100),
        `${r.file}: expected=${expectedPer100.toFixed(2)} engine=${r.enginePer100.toFixed(2)} (after correction)`
      ).toBeLessThanOrEqual(1.0);
    }

    expect(rows.length).toBeGreaterThan(0);

    if (unexplained.length > 0) {
      const lines = unexplained.map(
        r => `  ${r.file}: pilot=${r.pilotPer100.toFixed(2)} engine=${r.enginePer100.toFixed(2)} Δ=${r.delta.toFixed(2)} ts-dir=${r.tsDirLines} inline=${r.inlineLines} license=${r.licenseLines}`
      );
      throw new Error(
        `${unexplained.length} fixture(s) have unexplained delta > ±1.0 per 100:\n${lines.join('\n')}\n` +
        `Acceptable explanations: TS_DIR (//@ts- directives), INLINE (trailing //), LICENSE (leading block skip), EXCL_SET.\n` +
        `Do NOT widen the tolerance — pin the file as a documented divergence row instead.`
      );
    }
  });
});
