import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ruleTester } from '../../src/engine/rule-tester.js';
import type { Rule } from '../../src/engine/types.js';

// ---------------------------------------------------------------------------
// Stub rules
// ---------------------------------------------------------------------------

/**
 * Flags files whose path matches the given name exactly.
 * All other files are clean.  Gives us both valid and invalid cases.
 */
function makeSelectiveRule(id: string, flaggedFilename: string): Rule {
  return {
    id,
    meta: { description: `flags ${flaggedFilename}` },
    vehicles: ['tree'],
    check: (ctx) =>
      (ctx.files ?? [])
        .filter((f) => f.path === flaggedFilename)
        .map((f) => ({
          ruleId: id,
          path: f.path,
          message: 'flagged by selective rule',
          fingerprintBasis: `${f.path}:flagged`,
        })),
  };
}

/** Flags any file whose path starts with "docs/" — tree-vehicle demonstration. */
const docsRule: Rule = {
  id: 'no-docs-dir',
  meta: { description: 'Disallow a docs/ directory in the tree' },
  vehicles: ['tree'],
  check: (ctx) =>
    (ctx.files ?? [])
      .filter((f) => f.path.startsWith('docs/'))
      .map((f) => ({
        ruleId: 'no-docs-dir',
        path: f.path,
        message: 'docs/ dir is not allowed',
        fingerprintBasis: `${f.path}:docs`,
      })),
};

// ---------------------------------------------------------------------------
// AC #2 — registration-time validation (throws, not a failing test)
// ---------------------------------------------------------------------------

describe('ruleTester — registration validation', () => {
  it('throws when valid cases array is empty', () => {
    expect(() =>
      ruleTester(makeSelectiveRule('stub-v', 'bad.ts'), {
        valid: [],
        invalid: [{ why: 'bad.ts is flagged', code: '', findings: [] }],
      }),
    ).toThrow(/empty valid cases/);
  });

  it('throws when invalid cases array is empty', () => {
    expect(() =>
      ruleTester(makeSelectiveRule('stub-i', 'bad.ts'), {
        valid: [{ why: 'good.ts is clean', code: '', filename: 'good.ts' }],
        invalid: [],
      }),
    ).toThrow(/empty invalid cases/);
  });

  it('throws when a valid case has an empty why', () => {
    expect(() =>
      ruleTester(makeSelectiveRule('stub-why-v', 'bad.ts'), {
        valid: [{ why: '', code: '' }],
        invalid: [{ why: 'bad.ts is flagged', code: '', findings: [] }],
      }),
    ).toThrow(/valid case at index 0.*missing.*why/i);
  });

  it('throws when an invalid case has an empty why', () => {
    expect(() =>
      ruleTester(makeSelectiveRule('stub-why-i', 'bad.ts'), {
        valid: [{ why: 'good.ts is clean', code: '', filename: 'good.ts' }],
        invalid: [{ why: '', code: '', findings: [] }],
      }),
    ).toThrow(/invalid case at index 0.*missing.*why/i);
  });

  it('throws naming the rule id in the error message', () => {
    expect(() =>
      ruleTester(makeSelectiveRule('my-rule-id', 'bad.ts'), {
        valid: [],
        invalid: [{ why: 'x', code: '', findings: [] }],
      }),
    ).toThrow(/my-rule-id/);
  });
});

// ---------------------------------------------------------------------------
// AC #1 + AC #4 (code) — one it() per case, titles prefixed valid:/invalid:
// ---------------------------------------------------------------------------

describe('ruleTester — code cases', () => {
  // selective-code rule: flags "bad.ts", ignores everything else
  ruleTester(makeSelectiveRule('selective-code', 'bad.ts'), {
    valid: [
      { why: 'good.ts is not flagged', code: 'export const ok = true;', filename: 'good.ts' },
      { why: 'file with no filename defaults to rule id extension', code: '' },
    ],
    invalid: [
      {
        why: 'bad.ts is flagged',
        code: 'const x = 1;',
        filename: 'bad.ts',
        findings: [
          {
            ruleId: 'selective-code',
            path: 'bad.ts',
            message: 'flagged by selective rule',
          },
        ],
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// AC #4 (tree) — tree cases, incl. docs/ stub rule
// ---------------------------------------------------------------------------

describe('ruleTester — tree cases', () => {
  ruleTester(docsRule, {
    valid: [
      {
        why: 'no docs/ dir in tree produces no findings',
        tree: {
          'src/index.ts': 'export {}',
          'README.md': '# hi',
        },
      },
    ],
    invalid: [
      {
        why: 'a file under docs/ is flagged',
        tree: {
          'src/index.ts': 'export {}',
          'docs/guide.md': '# guide',
        },
        findings: [
          {
            ruleId: 'no-docs-dir',
            path: 'docs/guide.md',
            message: 'docs/ dir is not allowed',
          },
        ],
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// AC #3 — deliberately wrong finding causes a named (fail) line
// ---------------------------------------------------------------------------

describe('ruleTester — fail output for wrong finding', () => {
  let tmpFile: string | undefined;

  afterAll(() => {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('spawning bun test with a wrong expected finding produces a (fail) line with the case title', () => {
    const srcDir = path.resolve(import.meta.dir, '../../src/engine');
    const ruleTesterPath = path.join(srcDir, 'rule-tester.ts');
    const typesPath = path.join(srcDir, 'types.ts');

    const src = `
import { ruleTester } from ${JSON.stringify(ruleTesterPath)};
import type { Rule } from ${JSON.stringify(typesPath)};

// Rule fires only on files named "bad.ts"; clean for any other filename.
const rule: Rule = {
  id: 'wrong-msg-rule',
  meta: { description: 'produces a finding on bad.ts' },
  vehicles: ['tree'],
  check: (ctx) =>
    (ctx.files ?? [])
      .filter((f) => f.path === 'bad.ts')
      .map((f) => ({
        ruleId: 'wrong-msg-rule',
        path: f.path,
        message: 'actual message',
        fingerprintBasis: f.path + ':actual',
      })),
};

ruleTester(rule, {
  valid: [{ why: 'good.ts produces no findings', code: '', filename: 'good.ts' }],
  invalid: [
    {
      why: 'wrong expected message triggers fail',
      code: 'x',
      filename: 'bad.ts',
      findings: [{ message: 'WRONG expected message' }],
    },
  ],
});
`;

    tmpFile = path.join(os.tmpdir(), `hr-fail-test-${Date.now()}.test.ts`);
    fs.writeFileSync(tmpFile, src, 'utf8');

    const result = spawnSync('bun', ['test', tmpFile], {
      encoding: 'utf8',
      timeout: 30_000,
    });

    const rawOutput = (result.stdout ?? '') + (result.stderr ?? '');
    // Strip ANSI escape codes, then normalise bun's "✗" failure marker to "(fail)"
    // so the assertion works regardless of terminal colour support.
    const output = rawOutput
      .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/✗/g, '(fail)');

    // Exit code must be non-zero
    expect(result.status).not.toBe(0);

    // Must contain a (fail) line that includes the case title (not a load error)
    expect(output).toMatch(/\(fail\).*wrong expected message triggers fail/);
  });
});

// ---------------------------------------------------------------------------
// AC — code case with base: baseText and addedHunks passed through
// ---------------------------------------------------------------------------

describe('ruleTester — code case with base field', () => {
  // Rule that checks whether baseText and addedHunks are properly populated.
  // Returns a finding if baseText is undefined (means no base was passed),
  // or if addedHunks is absent/empty (means diff was not computed).
  const baseCheckRule: Rule = {
    id: 'base-check-rule',
    meta: { description: 'asserts baseText and addedHunks are populated from Case.base' },
    vehicles: ['diff'],
    check: (ctx) => {
      const f = (ctx.files ?? [])[0];
      if (!f) return [];
      const out: import('../../src/engine/types.js').Finding[] = [];
      if (f.baseText === undefined) {
        out.push({
          ruleId: 'base-check-rule',
          path: f.path,
          message: 'missing baseText',
          fingerprintBasis: 'no-baseText',
        });
      }
      if (!f.addedHunks || f.addedHunks.length === 0) {
        out.push({
          ruleId: 'base-check-rule',
          path: f.path,
          message: 'missing addedHunks',
          fingerprintBasis: 'no-addedHunks',
        });
      }
      return out;
    },
  };

  ruleTester(baseCheckRule, {
    valid: [
      {
        why: 'base provided: baseText is set and addedHunks shows the diff',
        code: 'const x = 2;\n',
        filename: 'evolving.ts',
        base: 'const x = 1;\n',
      },
    ],
    invalid: [
      {
        why: 'no base: baseText is absent so rule flags missing baseText',
        code: 'const x = 1;\n',
        filename: 'fresh.ts',
        // no base → baseText undefined; addedHunks = all lines (present)
        findings: [{ ruleId: 'base-check-rule', message: 'missing baseText' }],
      },
    ],
  });
});
