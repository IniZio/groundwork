// D-16: comment-density latency budget (5 ms cold, 1 ms warm per file)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';

const CORPUS = join(import.meta.dirname, '../fixtures/comment-density/corpus');

const COLD_BUDGET_MS = 5;
const WARM_BUDGET_MS = 1;

const COLD_SAMPLES = 20;
const WARM_SAMPLES = 30;
const WARMUP_PASSES = 5;

const P50 = 0.50;
const P95 = 0.95;
const COLD_P95_BUDGET_MS = COLD_BUDGET_MS * 2;
const WARM_P95_BUDGET_MS = WARM_BUDGET_MS * 3;

function readCorpus(name: string): string {
  return readFileSync(join(CORPUS, name), 'utf8');
}

/** Returns the p-th percentile of a sorted array of numbers (0–1 scale). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx]!;
}

function sortedCopy(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b);
}

const CORPUS_FILES = [
  'empty.ts', 'density_zero.ts', 'density_borderline.ts', 'density_high.ts',
  'sample.ts', 'tricky_ts_string.ts', 'tricky_ts_template.ts',
  'url_in_comment.ts', 'url_in_string.ts',
  'tricky_tsx.tsx',
  'sample.js', 'multiline_block.js', 'tricky_js_regex.js',
  'sample.go', 'go_generated.go', 'tricky_go_block.go',
  'sample.rs', 'tricky_rs_doc.rs',
  'sample.py', 'commented_out_code.py', 'tricky_py_docstring.py', 'tricky_py_string_hash.py',
  'sample.rb', 'tricky_rb_heredoc.rb',
  'sample.sh', 'tricky_sh_shebang.sh',
  'Sample.java', 'tricky_java_nested.java',
];

describe('comment-density bench: D-16 latency budget', () => {
  it('warm-cache p50 ≤ 1 ms and p95 ≤ 3 ms per file', () => {
    const entries = CORPUS_FILES.map(f => ({ file: f, content: readCorpus(f) }));

    for (let pass = 0; pass < WARMUP_PASSES; pass++) {
      for (const { file, content } of entries) {
        analyzeFile(file, content);
      }
    }

    const warmTimings: number[] = [];
    for (let s = 0; s < WARM_SAMPLES; s++) {
      for (const { file, content } of entries) {
        const t0 = performance.now();
        analyzeFile(file, content);
        warmTimings.push(performance.now() - t0);
      }
    }

    const sorted = sortedCopy(warmTimings);
    const p50ms = percentile(sorted, P50);
    const p95ms = percentile(sorted, P95);

    console.log(
      `[bench] warm  p50=${p50ms.toFixed(3)} ms  p95=${p95ms.toFixed(3)} ms` +
      `  (budget: p50≤${WARM_BUDGET_MS} ms, p95≤${WARM_P95_BUDGET_MS} ms,` +
      `  n=${warmTimings.length} calls across ${entries.length} files × ${WARM_SAMPLES} samples)`,
    );

    expect(p50ms, `warm p50 must be ≤ ${WARM_BUDGET_MS} ms`).toBeLessThanOrEqual(WARM_BUDGET_MS);
    expect(p95ms, `warm p95 must be ≤ ${WARM_P95_BUDGET_MS} ms`).toBeLessThanOrEqual(WARM_P95_BUDGET_MS);
  });

  it('cold-parse p50 ≤ 5 ms and p95 ≤ 10 ms per file', () => {
    const entries = CORPUS_FILES.map(f => ({ file: f, content: readCorpus(f) }));

    // Append unique suffix per call to guarantee cache misses (D-16 cold-parse test)
    const coldTimings: number[] = [];
    let serial = 0;
    for (let s = 0; s < COLD_SAMPLES; s++) {
      for (const { file, content } of entries) {
        const uniqueContent = `${content}\n// bench-cold-${serial++}`;
        const uniquePath = `bench-cold-${file}-${serial}`;
        const t0 = performance.now();
        analyzeFile(uniquePath, uniqueContent);
        coldTimings.push(performance.now() - t0);
      }
    }

    const sorted = sortedCopy(coldTimings);
    const p50ms = percentile(sorted, P50);
    const p95ms = percentile(sorted, P95);

    console.log(
      `[bench] cold  p50=${p50ms.toFixed(3)} ms  p95=${p95ms.toFixed(3)} ms` +
      `  (budget: p50≤${COLD_BUDGET_MS} ms, p95≤${COLD_P95_BUDGET_MS} ms,` +
      `  n=${coldTimings.length} calls across ${entries.length} files × ${COLD_SAMPLES} samples)`,
    );

    expect(p50ms, `cold p50 must be ≤ ${COLD_BUDGET_MS} ms`).toBeLessThanOrEqual(COLD_BUDGET_MS);
    expect(p95ms, `cold p95 must be ≤ ${COLD_P95_BUDGET_MS} ms`).toBeLessThanOrEqual(COLD_P95_BUDGET_MS);
  });
});
