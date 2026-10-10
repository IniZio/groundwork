import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'code-smells',
  'Flags common AI-slop code smells in added TypeScript/JavaScript lines.',
  path.join(import.meta.dir, 'checks'),
);
