import type { RuleCases } from '../../src/engine/types.js';

// Helper to build code lines
function codeLines(n: number, prefix = 'export const v'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i};`).join('\n');
}

export const cases: RuleCases = {
  valid: [
    {
      why: '1 comment in 40 code lines stays under cap',
      filename: 'comment-density.ts',
      // 1 comment + 39 code lines = 1/40 = 2.5/100 < 5
      code: `// single rationale for this module\n${codeLines(39)}`,
    },
    {
      why: 'reworded pre-existing comment via base is not net-new',
      filename: 'comment-density.ts',
      // base has a comment; post rewrites it — comment pairs as reword, net-new = 0
      base: `// old explanation\n${codeLines(20)}`,
      code: `// new explanation\n${codeLines(20)}`,
    },
    {
      why: 'new comment above reword with extra new code keeps ratio under cap',
      filename: 'comment-density.ts',
      // base: 1 comment + 39 code lines
      // post: 1 new comment + reworded comment (pairs) + 39 same code + 21 new code
      // diff adds: 2 comment lines + 21 new code lines = 23 added
      // net-new comments = 1 (new intro note); reword pairs
      // ratio = 1/23 * 100 = 4.35% < 5
      base: `// original note\n${codeLines(39)}`,
      code: `// new intro note\n// original note reworded\n${codeLines(39)}\n${codeLines(21, 'export const extra')}`,
    },
    {
      why: 'exempt @ts-ignore directive is not counted',
      filename: 'comment-density.ts',
      // @ts-ignore is exempt; should not count toward density
      code: `// @ts-ignore\n${codeLines(19)}`,
    },
  ],
  invalid: [
    {
      why: 'dense new comments over cap',
      filename: 'comment-density.ts',
      // 10 comments + 10 code = 50/100 >> 5
      code: `${Array.from({ length: 10 }, (_, i) => `// comment line ${i}`).join('\n')}\n${codeLines(10)}`,
      findings: [{ ruleId: 'comment-density' }],
    },
    {
      why: 'reword plus several new narration lines pushes over cap',
      filename: 'comment-density.ts',
      // base: 1 comment + 40 code lines
      // post: reworded comment (pairs) + 5 new narration comments + 40 code lines
      // net-new = 5 comments in ~46 added lines ≈ 10.9/100 > 5
      base: `// base comment\n${codeLines(40)}`,
      code: `// base comment reworded\n// narration 1\n// narration 2\n// narration 3\n// narration 4\n// narration 5\n${codeLines(40)}`,
      findings: [{ ruleId: 'comment-density', line: 2, fingerprintBasis: '// narration 1\n// narration 2\n// narration 3\n// narration 4\n// narration 5' }],
    },
    {
      why: 'narration inserted above reworded comment still flags with correct line',
      filename: 'comment-density.ts',
      // base: 1 comment (// why old) + 5 code lines
      // post: 3 narrations + reworded comment (pairs with // why old) + 5 code lines
      // diff: removed base line 1; added post lines 1-4
      // greedy pairing: // why old reworded (post line 4) pairs with // why old (base line 1)
      // net-new = 3 (lines 1,2,3: narration a/b/c); 3/4*100 = 75% > 5
      // line must be 1 (first unpaired = narration a, NOT the reworded line 4)
      base: `// why old\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;`,
      code: `// narration a\n// narration b\n// narration c\n// why old reworded\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;`,
      findings: [{ ruleId: 'comment-density', line: 1, fingerprintBasis: '// narration a\n// narration b\n// narration c' }],
    },
    {
      why: 'python hash comments over cap',
      filename: 'over-cap.py',
      // 10 # comments + 10 code lines = 50/100 >> 5
      code: `${Array.from({ length: 10 }, (_, i) => `# python comment ${i}`).join('\n')}\n${Array.from({ length: 10 }, (_, i) => `x_${i} = ${i}`).join('\n')}`,
      findings: [{ ruleId: 'comment-density' }],
    },
  ],
};
