import type { RuleCases } from '../../../src/engine/types.js';

const finding = (line: number, name: string) => ({
  line,
  message: `[no-shape-in-symbol-names] Rename symbol "${name}" for its domain role; "shape" describes structure rather than ownership.`,
});

export const cases: RuleCases = {
  valid: [
    { why: 'borrowed member .shape read', code: 'declare const schema: ExternalSchema; const field = schema.shape.id;\n' },
    { why: 'borrowed nested member .shape', code: 'declare const outer: External; const value = outer.inner.shape;\n' },
    { why: 'borrowed member .shape in call chain', code: "declare const schema: ExternalSchema; schema.shape.id.parse('x');\n" },
    { why: 'unrelated names', code: 'const owner = { id: 1 }; const value = owner.id;\n' },
    { why: 'optional-chained borrowed member', code: 'declare const o: External; const v = o?.shape;\n' },
    {
      why: 'shape on an unchanged base line is not flagged',
      base: 'const shape = 1;\n',
      code: 'const shape = 1;\nconst b = 2;\n',
    },
  ],
  invalid: [
    { why: 'variable', code: 'const shape = 1;\n', findings: [finding(1, 'shape')] },
    { why: 'function name', code: 'function shapeOf() {}\n', findings: [finding(1, 'shapeOf')] },
    { why: 'type alias, case-insensitive', code: 'type PayloadShape = { id: string };\n', findings: [finding(1, 'PayloadShape')] },
    { why: 'type property key', code: 'type Payload = { shape: string };\n', findings: [finding(1, 'shape')] },
    {
      why: 'declaration and computed use both flagged',
      code: "declare const owner: External; const shape = 'field'; const value = owner[shape];\n",
      findings: [finding(1, 'shape'), finding(1, 'shape')],
    },
    { why: 'parameter', code: 'function f(shapeP: number) {}\n', findings: [finding(1, 'shapeP')] },
    { why: 'private field', code: 'class C { #shape = 1; }\n', findings: [finding(1, '#shape')] },
    { why: 'JSX member tag', filename: 'a.tsx', code: 'const a = <b.Shape />;\n', findings: [finding(1, 'Shape')] },
    { why: 'fires on a .js file', filename: 'util.js', code: 'const shape = 1;\n', findings: [finding(1, 'shape')] },
  ],
};
