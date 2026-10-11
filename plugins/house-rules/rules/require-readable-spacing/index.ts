import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'require-readable-spacing',
  'Require readable spacing between declarations and logical statement groups.',
  path.join(import.meta.dir, 'checks'),
);
