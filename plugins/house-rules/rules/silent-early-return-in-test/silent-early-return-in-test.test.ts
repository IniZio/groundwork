import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from './index.js';
import { loadRules } from '../../src/engine/registry.js';
import { loadGroupedCases, loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';

const CHECKS_DIR = path.join(import.meta.dir, 'checks');

function checkIds(dir: string): string[] {
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.cases.ts') && !n.endsWith('.d.ts'))
    .map((n) => n.slice(0, -'.ts'.length))
    .sort();
}

/** Sub-ids with no invalid case whose `why` carries the `[<sub>]` prefix added by loadGroupedCases. */
async function uncoveredChecks(dir: string): Promise<string[]> {
  const cases = await loadGroupedCases(dir);
  return checkIds(dir).filter((sub) => !cases.invalid.some((c) => c.why.startsWith(`[${sub}] `)));
}

for (const { rule: view, cases } of await loadIsolatedCases(rule, CHECKS_DIR)) ruleTester(view, cases);

describe('silent-early-return-in-test grouped rule', () => {
  it('loadRules loads id silent-early-return-in-test from the rules dir', async () => {
    const rules = await loadRules(path.resolve(import.meta.dir, '..'));
    expect(rules.some((r) => r.id === 'silent-early-return-in-test')).toBe(true);
  });

  it('discovers at least one check', () => {
    expect(checkIds(CHECKS_DIR).length).toBeGreaterThan(0);
  });

  it('every check has at least one invalid case', async () => {
    expect(await uncoveredChecks(CHECKS_DIR)).toEqual([]);
  });

  it('coverage guard bites on a check with no invalid case', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silent-early-return-in-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'fake.ts'), "export const id = 'fake';\nexport const upstream = 'x';\nexport function check() { return []; }\n");
      fs.writeFileSync(
        path.join(dir, 'fake.cases.ts'),
        "export const cases = { valid: [{ why: 'ok', code: 'const a = 1;' }], invalid: [] };\n",
      );
      expect(await uncoveredChecks(dir)).toEqual(['fake']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
