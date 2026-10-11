import type { RuleCases } from '../../../src/engine/types.js';

const construction = [{ message: '[no-manual-tagged-construction] Use the existing Schema tagged `.make`, tagged class/error constructor, or Data.taggedEnum variant constructor instead of writing a literal `_tag` object.' }];

export const cases: RuleCases = {
  valid: [
    { why: 'tag object in Match.when', code: 'Match.when({ _tag: "Ready" }, handleReady);\n' },
    { why: 'quoted tag object in Match.not', code: 'Match.not({ "_tag": "Pending" });\n' },
    { why: 'Schema tagged make', code: 'Ready.make({ value });\n' },
    { why: 'tagged class constructor', code: 'new NotFound({ id });\n' },
    { why: 'dynamic tag value', code: '({ _tag: tag, value });\n' },
  ],
  invalid: [
    { why: 'object literal with tag', code: 'const value = { _tag: "Ready", payload };\n', findings: construction },
    { why: 'object literal with computed string tag', code: 'const value = { ["_tag"]: "Ready" };\n', findings: construction },
  ],
};
