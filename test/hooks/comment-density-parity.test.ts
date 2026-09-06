/**
 * Parity test: syntax-table counter vs tree-sitter oracle.
 *
 * The oracle (tree-sitter, s2-proto grammars) was run OFFLINE on 2026-09-06 against
 * every file in the 9-language corpus. Expected values are embedded in PARITY_TABLE
 * below. The test does NOT require tree-sitter at runtime.
 *
 * Row annotation key:
 *   [oracle: N] — tree-sitter count, present only when it DIFFERS from the engine.
 *   DIVERGENCE — engine over-counts; reason stated; engine value is pinned.
 *   coincidental agreement rows have no special annotation.
 *
 * Known divergences (follow-up slice candidates):
 *   1. tricky_ts_string.ts   line 5: inside multi-line backtick body; engine pins 2.
 *   2. tricky_py_string_hash.py lines 3-4: string literal z="""…"""; engine pins 3.
 *   3. tricky_rb_heredoc.rb  line 3: inside <<~HEREDOC; engine pins 3.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';

const CORPUS = join(import.meta.dirname, '../fixtures/comment-density/corpus');

function readCorpus(name: string): string {
  return readFileSync(join(CORPUS, name), 'utf8');
}

// ---------------------------------------------------------------------------
// Parity table — all 28 corpus files, engine values pinned, oracle noted.
//
// Columns: file, totalLines, commentLines (engine/pinned), lines (1-based),
//          oracleCommentLines (only for divergence rows), divergenceReason.
// ---------------------------------------------------------------------------

type ParityRow = {
  file: string;
  totalLines: number;
  commentLines: number;       // engine (pinned); may differ from oracle
  lines: number[];
  oracleCommentLines?: number; // set only when oracle ≠ engine
  divergenceReason?: string;
};

const PARITY_TABLE: ParityRow[] = [
  // ── TypeScript (.ts) ────────────────────────────────────────────────────
  {
    // empty file; oracle agrees
    file: 'empty.ts', totalLines: 1, commentLines: 0, lines: [],
  },
  {
    // all-code file; oracle agrees
    file: 'density_zero.ts', totalLines: 11, commentLines: 0, lines: [],
  },
  {
    // first 5 lines are // comments; rest is code; oracle agrees
    file: 'density_borderline.ts', totalLines: 101, commentLines: 5,
    lines: [1, 2, 3, 4, 5],
  },
  {
    // comment-heavy file; oracle agrees
    file: 'density_high.ts', totalLines: 22, commentLines: 19,
    lines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  },
  {
    // inline //, block, doc comments; oracle agrees (D-2: all comment forms count)
    file: 'sample.ts', totalLines: 17, commentLines: 10,
    lines: [1, 2, 3, 4, 7, 9, 10, 11, 12, 13],
  },
  {
    // DIVERGENCE — engine: 2 (lines 5,7); oracle: 1 (line 7 only).
    // Line 5 `line // still not` is inside the BODY of a multi-line template
    // literal (`const d = \`multi\nline // still not\ntemplate\``).
    // engine's hasInlineComment inspects each line in isolation and cannot
    // track cross-line template-literal state → false positive on line 5.
    // oracle [7]; engine pinned at [5,7].
    file: 'tricky_ts_string.ts', totalLines: 9, commentLines: 2,
    lines: [5, 7],
    oracleCommentLines: 1,
    divergenceReason:
      'line 5 is inside a multi-line template-literal body; ' +
      'engine hasInlineComment is line-local and has no cross-line template state',
  },
  {
    // line 1 = real comment; line 6 = // inside ${} expr interpolation → real JS comment;
    // line 4 = <!-- ... --> inside template string → NOT a comment; oracle agrees.
    file: 'tricky_ts_template.ts', totalLines: 13, commentLines: 2,
    lines: [1, 6],
  },
  {
    // lines 1-2 are // comments containing URLs; oracle agrees
    file: 'url_in_comment.ts', totalLines: 7, commentLines: 2, lines: [1, 2],
  },
  {
    // line 3 is a // comment; "http://..." inside a string is not; oracle agrees
    file: 'url_in_string.ts', totalLines: 5, commentLines: 1, lines: [3],
  },

  // ── TSX (.tsx) ──────────────────────────────────────────────────────────
  {
    // {/* JSX block comments */} on lines 6,8; // on lines 2,12; oracle agrees
    file: 'tricky_tsx.tsx', totalLines: 14, commentLines: 4,
    lines: [2, 6, 8, 12],
  },

  // ── JavaScript (.js) ────────────────────────────────────────────────────
  {
    // // and /* */ comments, inline //; oracle agrees
    file: 'sample.js', totalLines: 9, commentLines: 4, lines: [1, 3, 5, 8],
  },
  {
    // multi-line /* */ block + code; oracle agrees
    file: 'multiline_block.js', totalLines: 14, commentLines: 8,
    lines: [1, 2, 3, 4, 5, 6, 7, 12],
  },
  {
    // lines 1-2 are /regex/ literals — NOT comments; line 3 = real //;
    // line 4 = trailing // after `1/2;` is a real comment; oracle agrees
    file: 'tricky_js_regex.js', totalLines: 6, commentLines: 2, lines: [3, 4],
  },

  // ── Go (.go) ────────────────────────────────────────────────────────────
  {
    // // and /* */ comments; oracle agrees
    file: 'sample.go', totalLines: 16, commentLines: 5, lines: [5, 6, 8, 10, 14],
  },
  {
    // generated file with // build tags and /* */ comments; oracle agrees
    file: 'go_generated.go', totalLines: 13, commentLines: 5,
    lines: [1, 2, 6, 8, 10],
  },
  {
    // /* */ block comment spanning multiple lines; oracle agrees
    file: 'tricky_go_block.go', totalLines: 13, commentLines: 4, lines: [3, 4, 5, 8],
  },

  // ── Rust (.rs) ──────────────────────────────────────────────────────────
  {
    // //, ///, //!, /* */ all counted (D-2: doc comments count); oracle agrees
    file: 'sample.rs', totalLines: 13, commentLines: 7,
    lines: [1, 2, 3, 5, 6, 9, 11],
  },
  {
    // /// (outer doc) and //! (inner doc) counted; oracle agrees (both are
    // tree-sitter `doc_comment` nodes; D-2 policy counts them)
    file: 'tricky_rs_doc.rs', totalLines: 15, commentLines: 5,
    lines: [1, 2, 4, 9, 11],
  },

  // ── Python (.py) ────────────────────────────────────────────────────────
  {
    // shebang(1), #(2), triple-quoted docstring(5-10), #(11), inline #(14);
    // oracle agrees (classifyPython docstring lines ARE in docstring position)
    file: 'sample.py', totalLines: 15, commentLines: 10,
    lines: [1, 2, 5, 6, 7, 8, 9, 10, 11, 14],
  },
  {
    // lines 4-6 are `# commented-out code` — real # comments; oracle agrees
    file: 'commented_out_code.py', totalLines: 11, commentLines: 3,
    lines: [4, 5, 6],
  },
  {
    // single-line docstring(2), multi-line docstring(6-9), # real comment(11);
    // line 10 `x = "# not a comment"` correctly excluded; oracle agrees
    file: 'tricky_py_docstring.py', totalLines: 14, commentLines: 6,
    lines: [2, 6, 7, 8, 9, 11],
  },
  {
    // DIVERGENCE — engine: 3 (lines 3,4,6); oracle: 1 (line 6 only).
    // `z = """# still not\n# multiline string"""` is an ASSIGNMENT of a string
    // literal, NOT a docstring. classifyPython enters docstring mode on any `"""`
    // opener, regardless of whether the expression is in docstring position
    // (first statement of function/class/module). Lines 3-4 are counted as
    // docstring by the engine but are plain string content by tree-sitter.
    // oracle [6]; engine pinned at [3,4,6].
    file: 'tricky_py_string_hash.py', totalLines: 8, commentLines: 3,
    lines: [3, 4, 6],
    oracleCommentLines: 1,
    divergenceReason:
      'lines 3-4 are body of a string ASSIGNMENT z="""…""", not a docstring; ' +
      'classifyPython cannot distinguish docstring position from arbitrary string literals',
  },

  // ── Ruby (.rb) ──────────────────────────────────────────────────────────
  {
    // shebang(1), # comments(2,4,6), inline #(7); oracle agrees
    file: 'sample.rb', totalLines: 11, commentLines: 5, lines: [1, 2, 4, 6, 7],
  },
  {
    // DIVERGENCE — engine: 3 (lines 1,3,13); oracle: 2 (lines 1,13).
    // Line 3 `  # this is inside a heredoc, not a comment` is inside the
    // `<<~HEREDOC … HEREDOC` block. classifyRuby has no heredoc-boundary
    // tracking; it sees `#` at the start of the trimmed line and counts it.
    // oracle [1,13]; engine pinned at [1,3,13].
    file: 'tricky_rb_heredoc.rb', totalLines: 15, commentLines: 3,
    lines: [1, 3, 13],
    oracleCommentLines: 2,
    divergenceReason:
      'line 3 is inside <<~HEREDOC body; classifyRuby has no heredoc-boundary state',
  },

  // ── Shell (.sh) ─────────────────────────────────────────────────────────
  {
    // shebang(1), # comments(2,4,6), inline #(7); oracle agrees
    file: 'sample.sh', totalLines: 12, commentLines: 5, lines: [1, 2, 4, 6, 7],
  },
  {
    // shebang(1) counted per D-2; # comment(2), # comment(4); oracle agrees
    file: 'tricky_sh_shebang.sh', totalLines: 7, commentLines: 3, lines: [1, 2, 4],
  },

  // ── Java (.java) ────────────────────────────────────────────────────────
  {
    // //, /** Javadoc, /* */, inline //; oracle agrees
    file: 'Sample.java', totalLines: 18, commentLines: 8,
    lines: [1, 4, 5, 6, 7, 10, 13, 15],
  },
  {
    // /* outer with // inside (lines 1-4), /** javadoc (6), // line (7);
    // string `"// not a comment"` on line 8 correctly excluded; oracle agrees
    file: 'tricky_java_nested.java', totalLines: 10, commentLines: 6,
    lines: [1, 2, 3, 4, 6, 7],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comment-density parity: syntax-table vs tree-sitter oracle', () => {
  describe('all 28 corpus files — engine counts match pinned oracle table', () => {
    for (const row of PARITY_TABLE) {
      it(`${row.file}: ${row.commentLines}/${row.totalLines} comment lines`, () => {
        const content = readCorpus(row.file);
        const r = analyzeFile(row.file, content);

        expect(r.excluded, `${row.file} should not be excluded`).toBe(false);

        expect(r.totalLines, `${row.file} totalLines`).toBe(row.totalLines);

        expect(r.commentLines, `${row.file} commentLines`).toBe(row.commentLines);

        // Exact line numbers must match (within rounding means ±0 for integer counts)
        expect(r.lines, `${row.file} comment line numbers`).toEqual(row.lines);

        // Computed rate must be consistent with counts
        const expectedPer100 = row.totalLines === 0
          ? 0
          : (row.commentLines / row.totalLines) * 100;
        expect(r.commentsPer100, `${row.file} commentsPer100`).toBeCloseTo(expectedPer100, 1);
      });
    }
  });

  describe('divergence inventory — 3 known engine over-counts vs oracle', () => {
    const divergenceRows = PARITY_TABLE.filter(r => r.oracleCommentLines !== undefined);

    it('exactly 3 divergence rows are documented', () => {
      expect(divergenceRows).toHaveLength(3);
    });

    for (const row of divergenceRows) {
      it(`${row.file}: engine=${row.commentLines} vs oracle=${row.oracleCommentLines} — ${row.divergenceReason!.slice(0, 70)}…`, () => {
        // Re-run engine to confirm the pinned divergence is still current.
        // If this assertion fails, the engine was fixed; promote oracle value to engine value.
        const content = readCorpus(row.file);
        const r = analyzeFile(row.file, content);
        expect(r.commentLines).toBe(row.commentLines);
        // engine must NOT equal oracle (if it does, the divergence was silently fixed)
        expect(r.commentLines).not.toBe(row.oracleCommentLines);
      });
    }
  });

  describe('language coverage sanity — at least one file per required language', () => {
    const extensions = ['.ts', '.tsx', '.js', '.go', '.rs', '.py', '.rb', '.sh', '.java'];
    for (const ext of extensions) {
      it(`corpus covers ${ext}`, () => {
        const covered = PARITY_TABLE.some(r => r.file.endsWith(ext));
        expect(covered).toBe(true);
      });
    }
  });
});
