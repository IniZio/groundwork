import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import rule from './index.js';
import { loadRules } from '../../src/engine/registry.js';
import { loadGroupedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import type { RuleContext } from '../../src/engine/types.js';

const checksDir = path.join(import.meta.dir, 'checks');
const cases = await loadGroupedCases(checksDir);

ruleTester(rule, cases);

function ctxFor(filePath: string, code: string): RuleContext {
  const lines = code.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return {
    repoRoot: '/tmp',
    mode: 'cli',
    files: [{
      path: filePath,
      text: code,
      lang: 'typescript',
      addedHunks: [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }],
    }],
  };
}

describe('type-escape-hatches registration', () => {
  it('is discovered by loadRules and is the index.ts default export', async () => {
    const rules = await loadRules(path.resolve(import.meta.dir, '..'));
    const found = rules.find((r) => r.id === 'type-escape-hatches');
    expect(found).toBeDefined();
    expect(found).toBe(rule);
  });
});

describe('type-escape-hatches language scope', () => {
  it('has at least one invalid case to exercise', () => {
    expect(cases.invalid.length).toBeGreaterThan(0);
  });

  for (const c of cases.invalid) {
    for (const ext of ['js', 'jsx']) {
      it(`${c.why}: no findings in x.${ext}`, async () => {
        expect(await rule.check(ctxFor(`x.${ext}`, c.code ?? ''))).toEqual([]);
      });
    }

    it(`${c.why}: positive control, x.ts flags with [check-id] prefix`, async () => {
      const findings = await rule.check(ctxFor('x.ts', c.code ?? ''));
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const id = /^\[([^\]]+)\]/.exec(c.why)![1];
      expect(findings.some((f) => f.message.startsWith(`[${id}] `))).toBe(true);
    });
  }
});
