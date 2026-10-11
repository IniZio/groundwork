import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'silent-early-return-in-test',
  'Flags `if (cond) return;` in a test body with no preceding expect on the condition, which passes vacuously.',
  path.join(import.meta.dir, 'checks'),
);
