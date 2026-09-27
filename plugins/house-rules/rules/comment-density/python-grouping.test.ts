import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from './index.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'py-grp-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { }
  }
  tmpDirs = [];
});

// ─── file layout (25 lines, all added) ────────────────────────────────────────
//
//  Budget: maxAllowedRows = floor(0.05 × 25) = 1 comment row allowed.
//
//
//

const RUN_1 = '# first run line';
const RUN_2 = '# second run line';
const RUN_3 = '# third run line';
const SINGLE = '# single comment';

const PYTHON_LINES = [
  RUN_1,         // row 0  ─┐
  RUN_2,         // row 1   │  3-line adjacent run
  RUN_3,         // row 2  ─┘
  'def foo():', // row 3
  '    pass',
  'def bar():',
  '    pass',
  'def baz():',
  '    pass',
  'def qux():',
  '    pass',
  'def a1():',
  '    pass',
  'def a2():',
  '    pass',
  SINGLE,
  'def a3():',
  '    pass',
  'def a4():',
  '    pass',
  'def a5():',
  '    pass',
  'def a6():',
  '    pass',
  'def a7():',
];

const BASE_TEXT = '';
const POST_TEXT = PYTHON_LINES.join('\n') + '\n';

const EXPECTED_AFTER = [
  'def foo():', '    pass',
  'def bar():', '    pass',
  'def baz():', '    pass',
  'def qux():', '    pass',
  'def a1():', '    pass',
  'def a2():', '    pass',
  SINGLE,
  'def a3():', '    pass',
  'def a4():', '    pass',
  'def a5():', '    pass',
  'def a6():', '    pass',
  'def a7():',
].join('\n') + '\n';

describe('python grouping: adjacent # run removed or kept as whole unit', () => {
  it('3-line # run removed entirely when over budget; single comment kept', async () => {
    const repoDir = makeTmpDir();
    const ledgerDir = makeTmpDir();
    const shadowDir = makeTmpDir();

    const fname = 'module.py';
    writeFileSync(path.join(repoDir, fname), POST_TEXT);

    const hunks = diffTextToHunks(BASE_TEXT, POST_TEXT);
    expect(hunks.length).toBeGreaterThan(0);

    const result = await rule.fix!({
      repoRoot: repoDir,
      mode: 'gate',
      files: [{ path: fname, text: POST_TEXT, baseText: BASE_TEXT, addedHunks: hunks }],
    }, {
      caller: {
        source: 'gate',
        sessionId: 'py-grouping-test',
        event: 'Stop',
        ledgerDir,
        shadowDir,
      },
      testOnly: { testOnly_forceWrite: true },
    });

    const fileResult = result.files.find(f => f.path === fname);
    expect(fileResult).toBeDefined();
    expect(fileResult!.status).toBe('fixed');

    expect(fileResult!.after).toBe(EXPECTED_AFTER);

    expect(fileResult!.after).not.toContain(RUN_1);
    expect(fileResult!.after).not.toContain(RUN_2);
    expect(fileResult!.after).not.toContain(RUN_3);

    expect(fileResult!.after).toContain(SINGLE);
  });
});
