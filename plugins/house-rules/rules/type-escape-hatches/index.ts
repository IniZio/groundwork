import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'type-escape-hatches',
  'Flags TypeScript type escape hatches in added lines.',
  path.join(import.meta.dir, 'checks'),
);
