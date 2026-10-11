import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'require-safety-comment-for-type-assertion',
  'Type assertions (as / <T>x, not as const) must be preceded by a SAFETY: comment stating the checked invariant.',
  path.join(import.meta.dir, 'checks'),
);
