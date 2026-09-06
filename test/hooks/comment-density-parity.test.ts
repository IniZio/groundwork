// Parity test: syntax-table counter vs tree-sitter oracle (2026-09-06).
// Each row includes a `note` string explaining why the oracle value was assigned.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeFile } from '../../hooks/lib/comment-density.mjs';

const CORPUS = join(import.meta.dirname, '../fixtures/comment-density/corpus');

function readCorpus(name: string): string {
  return readFileSync(join(CORPUS, name), 'utf8');
}

type ParityRow = {
  file: string;
  totalLines: number;
  commentLines: number;
  lines: number[];
  note: string;
};

const PARITY_TABLE: ParityRow[] = [
  { file: 'empty.ts', totalLines: 1, commentLines: 0, lines: [], note: 'empty file; oracle agrees' },
  { file: 'density_zero.ts', totalLines: 11, commentLines: 0, lines: [], note: 'all-code file; oracle agrees' },
  { file: 'density_borderline.ts', totalLines: 101, commentLines: 5, lines: [1, 2, 3, 4, 5], note: 'first 5 lines are // comments; rest is code; oracle agrees' },
  { file: 'density_high.ts', totalLines: 22, commentLines: 19, lines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20], note: 'comment-heavy file; oracle agrees' },
  { file: 'sample.ts', totalLines: 17, commentLines: 10, lines: [1, 2, 3, 4, 7, 9, 10, 11, 12, 13], note: 'inline //, block, doc comments; oracle agrees (D-2: all comment forms count)' },
  { file: 'tricky_ts_string.ts', totalLines: 9, commentLines: 1, lines: [7], note: 'line 7 is the only comment; lines 4-6 are a multi-line template literal body. engine now tracks cross-line template-literal state (S11 fix); oracle agrees.' },
  { file: 'tricky_ts_template.ts', totalLines: 13, commentLines: 2, lines: [1, 6], note: 'line 1 = real comment; line 6 = // inside ${} expr interpolation → real JS comment; line 4 = <!-- ... --> inside template string → NOT a comment; oracle agrees.' },
  { file: 'url_in_comment.ts', totalLines: 7, commentLines: 2, lines: [1, 2], note: 'lines 1-2 are // comments containing URLs; oracle agrees' },
  { file: 'url_in_string.ts', totalLines: 5, commentLines: 1, lines: [3], note: 'line 3 is a // comment; "http://..." inside a string is not; oracle agrees' },
  { file: 'tricky_tsx.tsx', totalLines: 14, commentLines: 4, lines: [2, 6, 8, 12], note: '{/* JSX block comments */} on lines 6,8; // on lines 2,12; oracle agrees' },
  { file: 'sample.js', totalLines: 9, commentLines: 4, lines: [1, 3, 5, 8], note: '// and /* */ comments, inline //; oracle agrees' },
  { file: 'multiline_block.js', totalLines: 14, commentLines: 8, lines: [1, 2, 3, 4, 5, 6, 7, 12], note: 'multi-line /* */ block + code; oracle agrees' },
  { file: 'tricky_js_regex.js', totalLines: 6, commentLines: 2, lines: [3, 4], note: 'lines 1-2 are /regex/ literals — NOT comments; line 3 = real //; line 4 = trailing // after `1/2;` is a real comment; oracle agrees' },
  { file: 'sample.go', totalLines: 16, commentLines: 5, lines: [5, 6, 8, 10, 14], note: '// and /* */ comments; oracle agrees' },
  { file: 'go_generated.go', totalLines: 13, commentLines: 5, lines: [1, 2, 6, 8, 10], note: 'generated file with // build tags and /* */ comments; oracle agrees' },
  { file: 'tricky_go_block.go', totalLines: 13, commentLines: 4, lines: [3, 4, 5, 8], note: '/* */ block comment spanning multiple lines; oracle agrees' },
  { file: 'sample.rs', totalLines: 13, commentLines: 7, lines: [1, 2, 3, 5, 6, 9, 11], note: '//, ///, //!, /* */ all counted (D-2: doc comments count); oracle agrees' },
  { file: 'tricky_rs_doc.rs', totalLines: 15, commentLines: 5, lines: [1, 2, 4, 9, 11], note: '/// (outer doc) and //! (inner doc) counted; oracle agrees (both are tree-sitter `doc_comment` nodes; D-2 policy counts them)' },
  { file: 'sample.py', totalLines: 15, commentLines: 10, lines: [1, 2, 5, 6, 7, 8, 9, 10, 11, 14], note: 'shebang(1), #(2), triple-quoted docstring(5-10), #(11), inline #(14); oracle agrees (classifyPython docstring lines ARE in docstring position)' },
  { file: 'commented_out_code.py', totalLines: 11, commentLines: 3, lines: [4, 5, 6], note: 'lines 4-6 are `# commented-out code` — real # comments; oracle agrees' },
  { file: 'tricky_py_docstring.py', totalLines: 14, commentLines: 6, lines: [2, 6, 7, 8, 9, 11], note: 'single-line docstring(2), multi-line docstring(6-9), # real comment(11); line 10 `x = "# not a comment"` correctly excluded; oracle agrees' },
  { file: 'tricky_py_string_hash.py', totalLines: 8, commentLines: 1, lines: [6], note: 'line 6 is the only comment; lines 3-4 are body of `z = """…"""` which is a string assignment, not a docstring. engine now checks docstring position (first stmt after def/class/top-of-file) before entering triple-quote mode (S11 fix); oracle agrees.' },
  { file: 'sample.rb', totalLines: 11, commentLines: 5, lines: [1, 2, 4, 6, 7], note: 'shebang(1), # comments(2,4,6), inline #(7); oracle agrees' },
  { file: 'tricky_rb_heredoc.rb', totalLines: 15, commentLines: 2, lines: [1, 13], note: 'lines 1 and 13 are real # comments; line 3 is inside <<~HEREDOC body. engine now tracks heredoc terminators (S11 fix); oracle agrees.' },
  { file: 'sample.sh', totalLines: 12, commentLines: 5, lines: [1, 2, 4, 6, 7], note: 'shebang(1), # comments(2,4,6), inline #(7); oracle agrees' },
  { file: 'tricky_sh_shebang.sh', totalLines: 7, commentLines: 3, lines: [1, 2, 4], note: 'shebang(1) counted per D-2; # comment(2), # comment(4); oracle agrees' },
  { file: 'Sample.java', totalLines: 18, commentLines: 8, lines: [1, 4, 5, 6, 7, 10, 13, 15], note: '//, /** Javadoc, /* */, inline //; oracle agrees' },
  { file: 'tricky_java_nested.java', totalLines: 10, commentLines: 6, lines: [1, 2, 3, 4, 6, 7], note: '/* outer with // inside (lines 1-4), /** javadoc (6), // line (7); string `"// not a comment"` on line 8 correctly excluded; oracle agrees' },
];

describe('comment-density parity: syntax-table vs tree-sitter oracle', () => {
  describe('all 28 corpus files — engine counts match pinned oracle table', () => {
    for (const row of PARITY_TABLE) {
      it(`${row.file}: ${row.commentLines}/${row.totalLines} comment lines`, () => {
        const content = readCorpus(row.file);
        const r = analyzeFile(`virtual/${row.file}`, content);

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
