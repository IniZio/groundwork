import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE =
  '[no-conditional-empty-object-spread] This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.';
const finding = (line: number) => ({ line, message: MESSAGE });

export const cases: RuleCases = {
  valid: [
    { why: 'plain shorthand property', code: 'const result = { value };\n' },
    { why: 'plain spread', code: 'const result = { ...values };\n' },
    { why: 'conditional outside a spread', code: 'const result = condition ? { value } : {};\n' },
    { why: 'conditional spread without empty object branch', code: 'const result = { ...(c ? { a } : { b }) };\n' },
    { why: 'array spread of conditional empty object is not an object spread', code: 'const result = [...(c ? {} : x)];\n' },
    {
      why: 'unchanged base line is not flagged',
      base: 'const a = { ...(c ? { v } : {}) };\n',
      code: 'const a = { ...(c ? { v } : {}) };\nconst b = 1;\n',
    },
  ],
  invalid: [
    { why: 'empty alternate', code: 'const result = { ...(value !== undefined ? { value } : {}) };\n', findings: [finding(1)] },
    { why: 'empty consequent', code: 'const result = { ...(condition ? {} : { value }) };\n', findings: [finding(1)] },
    { why: 'unparenthesized ternary', code: 'const result = { ...condition ? { value } : {} };\n', findings: [finding(1)] },
    { why: 'double parentheses', code: 'const result = { ...((c ? { v } : {})) };\n', findings: [finding(1)] },
    { why: 'fires on a .js file', filename: 'util.js', code: 'const result = { ...(c ? { v } : {}) };\n', findings: [finding(1)] },
  ],
};
