import type { RuleCases } from '../../../src/engine/types.js';

const message = '[prefer-effect-match] Use Match from Effect instead of a chained literal ternary.';
const one = [{ message }];

export const cases: RuleCases = {
  valid: [
    { why: 'single literal ternary', code: 'kind === "a" ? first : fallback;\n' },
    { why: 'second arm compares a different value', code: 'kind === "a" ? first : other === "b" ? second : fallback;\n' },
    { why: 'non-literal conditions', code: 'condition ? first : otherCondition ? second : fallback;\n' },
    { why: 'non-equality comparison', code: 'kind < 1 ? first : kind < 2 ? second : fallback;\n' },
    { why: 'template with substitution is not a literal', code: 'kind === `a${x}` ? first : kind === `b${x}` ? second : fallback;\n' },
    { why: 'single literal ternary in a javascript file', filename: 'x.js', code: 'kind === "a" ? first : fallback;\n' },
  ],
  invalid: [
    { why: 'two string literal arms', code: 'kind === "a" ? first : kind === "b" ? second : fallback;\n', findings: one },
    { why: 'template literals with reversed operands', code: '`a` !== kind ? first : `b` === kind ? second : fallback;\n', findings: one },
    { why: 'three-arm chain', code: 'kind === "a" ? 1 : kind === "b" ? 2 : kind === "c" ? 3 : 0;\n', findings: one },
    { why: 'number literals', code: 'code === 1 ? first : code === 2 ? second : fallback;\n', findings: one },
    { why: 'parenthesized test', code: '(kind === "a") ? first : (kind === "b") ? second : fallback;\n', findings: one },
    { why: 'javascript file', filename: 'x.js', code: 'kind === "a" ? first : kind === "b" ? second : fallback;\n', findings: one },
  ],
};
