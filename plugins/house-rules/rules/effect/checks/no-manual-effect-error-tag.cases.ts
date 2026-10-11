import type { RuleCases } from '../../../src/engine/types.js';

const tag = [{ message: '[no-manual-effect-error-tag] Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.' }];
const reason = [{ message: '[no-manual-effect-error-tag] Use Effect.catchReason or Effect.catchReasons instead of manually discriminating a tagged `reason` in a broad Effect catch handler.' }];

export const cases: RuleCases = {
  valid: [
    { why: 'tag comparison outside a handler', code: 'error._tag === "NotFound";\n' },
    { why: 'catchTag call without a callback', code: 'Effect.catchTag("NotFound", recover);\n' },
    { why: 'tag comparison inside a catchTag callback', code: 'Effect.catchTag("Wrapper", (error) => error.reason._tag === "Timeout" ? retry : fail);\n' },
  ],
  invalid: [
    { why: 'tag comparison in Effect.catch arrow', code: 'Effect.catch((error) => error._tag === "NotFound" ? recover : fail);\n', findings: tag },
    { why: 'reason tag comparison in Effect.catchAll function', code: 'Effect.catchAll(function (error) { return error.reason._tag === "Timeout" ? retry : fail; });\n', findings: reason },
    { why: 'tag switch in Effect.catchIf callback', code: 'Effect.catchIf(predicate, (error) => { switch (error._tag) { case "NotFound": return recover; } });\n', findings: tag },
  ],
};
