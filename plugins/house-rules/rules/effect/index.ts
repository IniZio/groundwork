import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'effect',
  'Flags code that should use Effect idioms in added lines.',
  path.join(import.meta.dir, 'checks'),
);
