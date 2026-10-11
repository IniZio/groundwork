import type { RuleCases } from '../../../src/engine/types.js';

const comparison = [{ message: '[no-manual-tag-comparison] Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.' }];
const switched = [{ message: '[no-manual-tag-comparison] Use Match.value(value).pipe(Match.tag/Match.tags/Match.tagsExhaustive) or the tagged enum `$match` helper instead of switching on `_tag`.' }];

export const cases: RuleCases = {
  valid: [
    { why: 'Predicate.isTagged call', code: 'Predicate.isTagged("Ready")(value);\n' },
    { why: 'Match.tag pipeline', code: 'Match.value(value).pipe(Match.tag("Ready", handleReady));\n' },
    { why: 'non-tag property comparison', code: 'if (value.status === "Ready") handleReady(value);\n' },
    { why: 'tag comparison inside Effect.catch handler', code: 'Effect.catch((error) => error._tag === "NotFound" ? recover : fail);\n' },
  ],
  invalid: [
    { why: 'dot tag compared to literal', code: 'value._tag === "Ready";\n', findings: comparison },
    { why: 'literal !== bracket tag', code: '"Ready" !== value["_tag"];\n', findings: comparison },
    { why: 'switch on tag', code: 'switch (value._tag) { case "Ready": handleReady(value); }\n', findings: switched },
  ],
};

// Other checks' case keys this check also fires on.
export const foreignHits: readonly string[] = [
  '[no-manual-effect-error-tag] tag comparison outside a handler',
  '[no-manual-effect-error-tag] tag comparison inside a catchTag callback',
];
