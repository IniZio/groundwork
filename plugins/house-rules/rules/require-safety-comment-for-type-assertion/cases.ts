import path from 'node:path';
import type { RuleCases } from '../../src/engine/types.js';
import { loadGroupedCases } from '../../src/engine/grouped-rule.js';

export const cases: RuleCases = await loadGroupedCases(path.join(import.meta.dir, 'checks'));
