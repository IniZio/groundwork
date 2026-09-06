/** Parity test: comment-density engine vs. agentic-artifacts pilot script.
 * Engine: hooks/lib/comment-density.mjs (analyzeFile API)
 * Tolerance: ±1.0 per 100 after TS_DIR correction; residual covers INLINE/LICENSE. */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';

const DELTA_CLASSES = {
  SHEBANG: 'Engine counts #! on line 1 for shell-classified files; pilot skips unconditionally.',
  TS_DIR: 'Pilot skips //@ts- and // @ts- directives; engine counts them.',
  INLINE: 'Engine detects trailing // after code via string-aware scanner; pilot only counts lines whose trimmed form starts with //.',
  LICENSE: 'Pilot skips /* block opening within first 3 lines and closing by line 2 (0-based); engine counts it.',
  EXCL_SET: "Engine's D-8 exclusion list differs from pilot's AdonisJS-specific list.",
};

const PILOT_SCRIPT = '/home/newman/magic/agentic-artifacts/scripts/check-comment-density.mjs';
const PILOT_REPO   = '/home/newman/magic/agentic-artifacts';
const PILOT_DIRS   = ['server', 'cli', 'scripts'];

const PILOT_PRESENT = existsSync(PILOT_SCRIPT);
const SKIP_REASON   = PILOT_PRESENT
  ? ''
  : `${PILOT_SCRIPT} not found — ~/magic/agentic-artifacts repo absent`;

function parsePilotOutput(stdout: string): Map<string, { comments: number; total: number }> {
  const result = new Map<string, { comments: number; total: number }>();
  const re = /^\s+(.+?):\s+(\d+) comment lines \/ (\d+) total lines/;
  for (const line of stdout.split('\n')) {
    const m = line.match(re);
    if (m) {
      result.set(m[1].trim(), { comments: Number(m[2]), total: Number(m[3]) });
    }
  }
  return result;
}

function classifyEngineLines(
  engineLineNums: number[],
  rawLines: string[],
): { tsDirLines: number; inlineLines: number } {
  let tsDirLines = 0;
  let inlineLines = 0;
  for (const num of engineLineNums) {
    const raw = rawLines[num - 1] ?? '';
    const t = raw.trim();
    if (t.startsWith('//@ts-') || t.startsWith('// @ts-')) {
      tsDirLines++;
    } else if (
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('/**') ||
      t.startsWith('{/*') ||
      t.startsWith('*')
    ) {
      // Pure comment line (pilot counts these too).
    } else {
      inlineLines++;
    }
  }
  return { tsDirLines, inlineLines };
}

describe('comment-density pilot parity — ~/magic/agentic-artifacts', () => {
  it.skipIf(!PILOT_PRESENT)(
    SKIP_REASON || 'per-file engine numbers within ±1.0 of pilot (or explained delta)',
    () => {
      const result = spawnSync('node', [PILOT_SCRIPT, ...PILOT_DIRS], {
        cwd: PILOT_REPO,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.error).toBeUndefined();
      const pilotMap = parsePilotOutput(result.stdout);
      expect(pilotMap.size).toBeGreaterThan(0);
      type Row = {
        file: string;
        pilotComments: number;
        pilotTotal: number;
        pilotPer100: number;
        engineComments: number;
        engineTotal: number;
        enginePer100: number;
        delta: number;         // engine - pilot (per 100)
        tsDirLines: number;
        inlineLines: number;
        explanation: string;
        status: 'match' | 'explained' | 'unexplained';
      };

      const rows: Row[] = [];
      const unexplained: Row[] = [];

      for (const [relPath, { comments: pilotComments, total: pilotTotal }] of pilotMap) {
        const absPath = join(PILOT_REPO, relPath);
        let content: string;
        try {
          content = readFileSync(absPath, 'utf8');
        } catch {
          continue;
        }

        const engineResult = analyzeFile(relPath, content);
        if (engineResult.excluded) continue;

        const rawLines     = content.split('\n');
        const pilotPer100  = pilotTotal === 0 ? 0 : (pilotComments / pilotTotal) * 100;
        const enginePer100 = engineResult.commentsPer100;
        const delta        = enginePer100 - pilotPer100;

        const { tsDirLines, inlineLines } = classifyEngineLines(engineResult.lines, rawLines);
        const explainedLines  = tsDirLines + inlineLines;
        const explainedDelta  = pilotTotal === 0 ? 0 : (explainedLines / pilotTotal) * 100;
        const residualDelta   = delta - explainedDelta;

        let explanation: string;
        let status: Row['status'];

        if (explainedLines > 0 && Math.abs(residualDelta) <= 1.0) {
          // TS_DIR and/or INLINE fully explain the divergence
          const parts: string[] = [];
          if (tsDirLines > 0)  parts.push(`ts-dir=${tsDirLines}`);
          if (inlineLines > 0) parts.push(`inline=${inlineLines}`);
          explanation = parts.join(' ');
          status = 'explained';
        } else if (Math.abs(delta) <= 1.0) {
          explanation = delta === 0 ? 'exact' : 'within tolerance';
          status = 'match';
        } else {
          explanation = `UNEXPLAINED: delta=${delta.toFixed(2)}, ts-dir=${tsDirLines}, inline=${inlineLines}, residual=${residualDelta.toFixed(2)}`;
          status = 'unexplained';
        }

        const row: Row = {
          file: relPath,
          pilotComments,
          pilotTotal,
          pilotPer100,
          engineComments: engineResult.commentLines,
          engineTotal: engineResult.totalLines,
          enginePer100,
          delta,
          tsDirLines,
          inlineLines,
          explanation,
          status,
        };

        rows.push(row);
        if (status === 'unexplained') unexplained.push(row);
      }

      const divider = '─'.repeat(120);
      console.log('\n' + divider);
      console.log(
        `${'FILE'.padEnd(65)} ${'PILOT'.padStart(6)} ${'ENGINE'.padStart(7)} ${'Δ/100'.padStart(7)}  EXPLANATION`
      );
      console.log(divider);

      for (const r of rows) {
        const tag = r.status === 'unexplained' ? '❌' : r.status === 'explained' ? '✓ exp' : '✓';
        const file = r.file.length > 64 ? '…' + r.file.slice(-63) : r.file;
        console.log(
          `${file.padEnd(65)} ${r.pilotPer100.toFixed(1).padStart(6)} ${r.enginePer100.toFixed(1).padStart(7)} ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2).padStart(6)}  ${tag} ${r.explanation}`
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
          : ((r.pilotComments + r.tsDirLines + r.inlineLines) / r.pilotTotal) * 100;
        expect(
          Math.abs(r.enginePer100 - expectedPer100),
          `${r.file}: expected=${expectedPer100.toFixed(2)} engine=${r.enginePer100.toFixed(2)} (after ts-dir correction)`
        ).toBeLessThanOrEqual(1.0);
      }

      if (unexplained.length > 0) {
        const lines = unexplained.map(
          r => `  ${r.file}: pilot=${r.pilotPer100.toFixed(2)} engine=${r.enginePer100.toFixed(2)} Δ=${r.delta.toFixed(2)} ts-dir=${r.tsDirLines} inline=${r.inlineLines}`
        );
        throw new Error(
          `${unexplained.length} file(s) have unexplained delta > ±1.0 per 100:\n${lines.join('\n')}\n` +
          `Acceptable explanations: TS_DIR (//@ts- directives), INLINE (trailing //), LICENSE (leading block skip), EXCL_SET (one tool excludes the file).\n` +
          `Do NOT widen the tolerance — pin the file as a documented divergence row instead.`
        );
      }
    }
  );

  it.skipIf(PILOT_PRESENT)(
    'skips with a stated reason when the pilot repo is absent',
    () => {
      expect(SKIP_REASON).toBeTruthy();
    }
  );
});
