import path from 'node:path';
import { defineGroupedRule } from '../../src/engine/grouped-rule.js';

export default defineGroupedRule(
  'no-module-mocking',
  'Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.',
  path.join(import.meta.dir, 'checks'),
);
