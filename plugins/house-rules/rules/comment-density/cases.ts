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
      code: `// single rationale for this module\n${codeLines(39)}`,
    },
    {
      why: 'reworded pre-existing comment via base is not net-new',
      filename: 'comment-density.ts',
      base: `// old explanation\n${codeLines(20)}`,
      code: `// new explanation\n${codeLines(20)}`,
    },
    {
      why: 'new comment above reword with extra new code keeps ratio under cap',
      filename: 'comment-density.ts',
      base: `// original note\n${codeLines(39)}`,
      code: `// new intro note\n// original note reworded\n${codeLines(39)}\n${codeLines(21, 'export const extra')}`,
    },
    {
      why: 'exempt @ts-ignore directive is not counted',
      filename: 'comment-density.ts',
      code: `// @ts-ignore\n${codeLines(19)}`,
    },
  ],
  invalid: [
    {
      why: 'dense new comments over cap',
      filename: 'comment-density.ts',
      code: `${Array.from({ length: 10 }, (_, i) => `// comment line ${i}`).join('\n')}\n${codeLines(10)}`,
      findings: [{ ruleId: 'comment-density' }],
    },
    {
      why: 'reword plus several new narration lines pushes over cap',
      filename: 'comment-density.ts',
      base: `// base comment\n${codeLines(40)}`,
      code: `// base comment reworded\n// narration 1\n// narration 2\n// narration 3\n// narration 4\n// narration 5\n${codeLines(40)}`,
      findings: [{ ruleId: 'comment-density', line: 2, fingerprintBasis: '// narration 1\n// narration 2\n// narration 3\n// narration 4\n// narration 5' }],
    },
    {
      why: 'narration inserted above reworded comment still flags with correct line',
      filename: 'comment-density.ts',
      base: `// why old\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;`,
      code: `// narration a\n// narration b\n// narration c\n// why old reworded\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;`,
      findings: [{ ruleId: 'comment-density', line: 1, fingerprintBasis: '// narration a\n// narration b\n// narration c' }],
    },
    {
      why: 'python hash comments over cap',
      filename: 'over-cap.py',
      code: `${Array.from({ length: 10 }, (_, i) => `# python comment ${i}`).join('\n')}\n${Array.from({ length: 10 }, (_, i) => `x_${i} = ${i}`).join('\n')}`,
      findings: [{ ruleId: 'comment-density' }],
    },
  ],
};
