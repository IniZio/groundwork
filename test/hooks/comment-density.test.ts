import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  analyzeFile,
  analyzeFiles,
  isExcluded,
  FILE_CAP,
  AGGREGATE_CAP,
  LANGUAGE_TABLE,
} from '../../hooks/lib/comment-density.mjs';

const CORPUS = join(import.meta.dirname, '../fixtures/comment-density/corpus');
const EXCLUSIONS = join(import.meta.dirname, '../fixtures/comment-density/exclusions');

function readFixture(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}

describe('constants', () => {
  it('FILE_CAP is 5', () => expect(FILE_CAP).toBe(5));
  it('AGGREGATE_CAP is 2', () => expect(AGGREGATE_CAP).toBe(2));
  it('LANGUAGE_TABLE has required extensions', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.go', '.rs', '.java', '.py', '.rb', '.sh']) {
      expect(LANGUAGE_TABLE).toHaveProperty(ext);
    }
  });
});

describe('isExcluded – D-8 patterns', () => {
  it('*.pb.go excluded (generated)', () => {
    expect(isExcluded('src/foo.pb.go')).toBe(true);
  });
  it('*.gen.ts excluded (generated)', () => {
    expect(isExcluded('src/types.gen.ts')).toBe(true);
  });
  it('*.d.ts excluded (generated)', () => {
    expect(isExcluded('src/foo.d.ts')).toBe(true);
  });
  it('.d.mts NOT excluded', () => {
    expect(isExcluded('hooks/lib/comment-density.d.mts')).toBe(false);
  });
  it('node_modules/ excluded', () => {
    expect(isExcluded('node_modules/lodash/index.js')).toBe(true);
  });
  it('dist/ excluded', () => {
    expect(isExcluded('dist/bundle.js')).toBe(true);
  });
  it('migrations/ excluded', () => {
    expect(isExcluded('migrations/001_init.sql')).toBe(true);
  });
  it('.json excluded (data file)', () => {
    expect(isExcluded('config.json')).toBe(true);
  });
  it('.yaml excluded (data file)', () => {
    expect(isExcluded('config.yaml')).toBe(true);
  });
  it('.toml excluded (data file)', () => {
    expect(isExcluded('Cargo.toml')).toBe(true);
  });
  it('package-lock.json excluded (lockfile)', () => {
    expect(isExcluded('package-lock.json')).toBe(true);
  });
  it('regular .ts file NOT excluded', () => {
    expect(isExcluded('src/foo.ts')).toBe(false);
  });
  it('test .test.ts file NOT excluded (AC: test files are checked)', () => {
    expect(isExcluded('test/hooks/my.test.ts')).toBe(false);
  });
  it('linguist-generated=true in .gitattributes → excluded', () => {
    const gitattributesText = 'generated.ts linguist-generated=true\n';
    expect(isExcluded('generated.ts', { gitattributesText })).toBe(true);
  });
  it('linguist-generated only on OTHER file → not excluded', () => {
    const gitattributesText = 'other.ts linguist-generated=true\n';
    expect(isExcluded('generated.ts', { gitattributesText })).toBe(false);
  });
  it('test/fixtures/ path excluded (D-18 fixture corpus)', () => {
    expect(isExcluded('test/fixtures/comment-density/corpus/sample.ts')).toBe(true);
  });
  it('__fixtures__ path excluded (D-18 fixture corpus)', () => {
    expect(isExcluded('src/__fixtures__/helpers.ts')).toBe(true);
  });
});

describe('analyzeFile – excluded files', () => {
  it('*.d.ts yields excluded:true and zero commentLines', () => {
    const content = readFixture(EXCLUSIONS, 'types.d.ts');
    const result = analyzeFile('types.d.ts', content);
    expect(result.excluded).toBe(true);
    expect(result.commentLines).toBe(0);
    expect(result.lines).toHaveLength(0);
  });
  it('*.gen.ts yields excluded:true', () => {
    const content = readFixture(EXCLUSIONS, 'types.gen.ts');
    const result = analyzeFile('types.gen.ts', content);
    expect(result.excluded).toBe(true);
  });
  it('linguist-generated fixture yields excluded:true', () => {
    const content = readFixture(EXCLUSIONS, 'generated.ts');
    const gitattributesText = readFixture(EXCLUSIONS, '.gitattributes');
    const result = analyzeFile('generated.ts', content, { gitattributesText });
    expect(result.excluded).toBe(true);
    expect(result.excludedReason).toBe('linguist-generated');
  });
  it('test .test.ts file yields excluded:false (test files ARE checked)', () => {
    const content = readFixture(CORPUS, 'sample.ts');
    const result = analyzeFile('foo.test.ts', content);
    expect(result.excluded).toBe(false);
  });
  it('test/fixtures/ path yields excluded:true (D-18)', () => {
    const result = analyzeFile('test/fixtures/comment-density/corpus/sample.ts', 'export const fixture = true;\n');
    expect(result.excluded).toBe(true);
  });
  it('node_modules fixture (staged) yields excluded:true', () => {
    const nmPath = join(EXCLUSIONS, 'node_modules/foo/index.js');
    const content = readFileSync(nmPath, 'utf8');
    const result = analyzeFile(nmPath, content);
    expect(result.excluded).toBe(true);
    expect(result.excludedReason).toBe('node_modules');
  });
});

describe('analyzeFile – D-18 fixture-corpus exclusion (C13)', () => {
  // analyzeFile caches by content hash only (path not in key), so each call
  // needs unique content to avoid returning a cached result from a prior path.
  // Tag is appended as a comment — 6 comment lines out of 8 total ≈ 75/100 > FILE_CAP (5).
  const overCap = (tag: string) =>
    `// c1\n// c2\n// c3\n// c4\n// c5\n// c6\nexport const x = 1; // ${tag}\n`;

  it('positive control: src/foo.ts is NOT excluded and is over cap', () => {
    const r = analyzeFile('src/foo.ts', overCap('pos'));
    expect(r.excluded).toBe(false);
    expect(r.commentsPer100).toBeGreaterThan(FILE_CAP);
  });

  it('test/fixtures/x/foo.ts → excluded:true, excludedReason:fixture-corpus', () => {
    const r = analyzeFile('test/fixtures/x/foo.ts', overCap('tf'));
    expect(r.excluded).toBe(true);
    expect(r.excludedReason).toBe('fixture-corpus');
  });

  it('pkg/__fixtures__/foo.ts → excluded:true, excludedReason:fixture-corpus', () => {
    const r = analyzeFile('pkg/__fixtures__/foo.ts', overCap('pf'));
    expect(r.excluded).toBe(true);
    expect(r.excludedReason).toBe('fixture-corpus');
  });

  it('near-miss test/fixturesx/foo.ts is NOT excluded (guards against widening)', () => {
    const r = analyzeFile('test/fixturesx/foo.ts', overCap('nm1'));
    expect(r.excluded).toBe(false);
  });

  it('near-miss src/fixtures/foo.ts is NOT excluded (guards against widening)', () => {
    const r = analyzeFile('src/fixtures/foo.ts', overCap('nm2'));
    expect(r.excluded).toBe(false);
  });
});

describe('analyzeFile – nine language fixtures', () => {
  it('TypeScript (sample.ts): 10/17 = 58.82 per 100', () => {
    const content = readFixture(CORPUS, 'sample.ts');
    const r = analyzeFile('sample.ts', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(17);
    expect(r.commentLines).toBe(10);
    expect(r.lines).toContain(1);
    expect(r.lines).toContain(2);
    expect(r.lines).toContain(3);
    expect(r.commentsPer100).toBeCloseTo(58.82, 1);
  });

  it('TSX (tricky_tsx.tsx): 4/14 = 28.57 per 100', () => {
    const content = readFixture(CORPUS, 'tricky_tsx.tsx');
    const r = analyzeFile('tricky_tsx.tsx', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(14);
    expect(r.commentLines).toBe(4);
    expect(r.lines).toContain(6);  // {/* JSX comment */}
    expect(r.lines).toContain(8);  // {/* another JSX comment */}
    expect(r.commentsPer100).toBeCloseTo(28.57, 1);
  });

  it('JavaScript (sample.js): 4/9 = 44.44 per 100', () => {
    const content = readFixture(CORPUS, 'sample.js');
    const r = analyzeFile('sample.js', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(9);
    expect(r.commentLines).toBe(4);
    expect(r.commentsPer100).toBeCloseTo(44.44, 1);
  });

  it('Go (sample.go): 5/16 = 31.25 per 100', () => {
    const content = readFixture(CORPUS, 'sample.go');
    const r = analyzeFile('sample.go', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(16);
    expect(r.commentLines).toBe(5);
    expect(r.commentsPer100).toBeCloseTo(31.25, 1);
  });

  it('Rust (sample.rs): 7/13 = 53.85 per 100 — including //! and /// (accuracy gap fix)', () => {
    const content = readFixture(CORPUS, 'sample.rs');
    const r = analyzeFile('sample.rs', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(13);
    expect(r.commentLines).toBe(7);
    expect(r.lines).toContain(3);  // //! module doc
    expect(r.commentsPer100).toBeCloseTo(53.85, 1);
  });

  it('Python (sample.py): 10/15 = 66.67 per 100 — docstrings counted (accuracy gap fix)', () => {
    const content = readFixture(CORPUS, 'sample.py');
    const r = analyzeFile('sample.py', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(15);
    expect(r.commentLines).toBe(10);
    expect(r.lines).toContain(5);   // """ open
    expect(r.lines).toContain(10);  // """ close
    expect(r.commentsPer100).toBeCloseTo(66.67, 1);
  });

  it('Ruby (sample.rb): 5/11 = 45.45 per 100', () => {
    const content = readFixture(CORPUS, 'sample.rb');
    const r = analyzeFile('sample.rb', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(11);
    expect(r.commentLines).toBe(5);
    expect(r.lines).toContain(7);  // "Hello, #{name}" # inline
    expect(r.commentsPer100).toBeCloseTo(45.45, 1);
  });

  it('Shell (sample.sh): 5/12 = 41.67 per 100', () => {
    const content = readFixture(CORPUS, 'sample.sh');
    const r = analyzeFile('sample.sh', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(12);
    expect(r.commentLines).toBe(5);
    expect(r.lines).toContain(1);
    expect(r.lines).toContain(7);
    expect(r.commentsPer100).toBeCloseTo(41.67, 1);
  });

  it('Java (Sample.java): 8/18 = 44.44 per 100', () => {
    const content = readFixture(CORPUS, 'Sample.java');
    const r = analyzeFile('Sample.java', content);
    expect(r.excluded).toBe(false);
    expect(r.totalLines).toBe(18);
    expect(r.commentLines).toBe(8);
    expect(r.lines).toContain(4);   // /** Javadoc
    expect(r.lines).toContain(15);
    expect(r.commentsPer100).toBeCloseTo(44.44, 1);
  });
});

describe('analyzeFile – tricky cases', () => {
  it('// inside a string is NOT a comment (tricky_ts_string.ts)', () => {
    const content = readFixture(CORPUS, 'tricky_ts_string.ts');
    const r = analyzeFile('tricky_ts_string.ts', content);
    expect(r.lines).toContain(7);
    expect(r.lines).not.toContain(1);  // "// not a comment"
    expect(r.lines).not.toContain(2);  // '// also not'
    expect(r.lines).not.toContain(3);
  });

  it('JSX {/* */} counted in tsx', () => {
    const content = readFixture(CORPUS, 'tricky_tsx.tsx');
    const r = analyzeFile('tricky_tsx.tsx', content);
    expect(r.lines).toContain(6);
    expect(r.lines).toContain(8);
  });

  it('Python single-line docstring counted (tricky_py_docstring.py)', () => {
    const content = readFixture(CORPUS, 'tricky_py_docstring.py');
    const r = analyzeFile('tricky_py_docstring.py', content);
    expect(r.lines).toContain(2);   // """Single line docstring"""
    expect(r.lines).toContain(11);
    expect(r.lines).not.toContain(10);  // x = "# not a comment"
  });

  it('Rust //! and /// counted (tricky_rs_doc.rs)', () => {
    const content = readFixture(CORPUS, 'tricky_rs_doc.rs');
    const r = analyzeFile('tricky_rs_doc.rs', content);
    expect(r.lines).toContain(1);   // ///
    expect(r.lines).toContain(9);   // //!
    expect(r.lines).toContain(11);
  });

  it('empty file: 0 comments, 0 or 1 total lines, 0 per 100', () => {
    const content = readFixture(CORPUS, 'empty.ts');
    const r = analyzeFile('empty.ts', content);
    expect(r.commentLines).toBe(0);
    expect(r.commentsPer100).toBe(0);
    expect(r.excluded).toBe(false);
  });
});

describe('analyzeFiles', () => {
  it('aggregatePer100 is sum of comments / sum of total lines * 100 for non-excluded', () => {
    const entries = [
      { path: 'a.ts', content: '// comment\nconst x = 1;' },
      { path: 'b.ts', content: 'const y = 2;\nconst z = 3;' },
    ];
    const result = analyzeFiles(entries);
    expect(result.files).toHaveLength(2);
    expect(result.aggregatePer100).toBeCloseTo(25, 1);
  });

  it('excluded files contribute 0 to aggregate denominator', () => {
    const entries = [
      { path: 'a.ts', content: '// comment\nconst x = 1;' },
      { path: 'types.d.ts', content: '// auto-generated\nexport type Foo = string;' },
    ];
    const result = analyzeFiles(entries);
    const nonExcluded = result.files.filter(f => !f.excluded);
    expect(nonExcluded).toHaveLength(1);
    expect(result.aggregatePer100).toBeCloseTo(50, 1);
  });

  it('SHA-1 cache: same content twice returns same result (fromCache on second call)', () => {
    const content = '// comment\nconst x = 1;\n';
    const r1 = analyzeFile('cached.ts', content);
    const r2 = analyzeFile('cached2.ts', content);
    expect(r1.commentLines).toBe(r2.commentLines);
    expect(r2.fromCache).toBe(true);
  });
});

describe('analyzeFile – unknown extension', () => {
  it('unknown extension: returns result with excluded:false and 0 commentLines (no parser)', () => {
    const result = analyzeFile('Makefile', '# target\nall: foo\n');
    expect(result).toHaveProperty('totalLines');
    expect(result).toHaveProperty('commentLines');
    expect(result).toHaveProperty('commentsPer100');
    expect(result.excluded).toBe(false);
  });
});
