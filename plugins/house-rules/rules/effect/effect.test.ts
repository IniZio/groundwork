import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from './index.js';
import { loadRules } from '../../src/engine/registry.js';
import { loadGroupedCases, loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import { BUILTIN_POLICY, policyForRoot } from '../../src/engine/policy.js';
import { runRules } from '../../src/engine/run.js';
import type { RuleContext } from '../../src/engine/types.js';

const checksDir = path.join(import.meta.dir, 'checks');
const cases = await loadGroupedCases(checksDir);
const tsOnlyIds = new Set<string>();
for (const name of fs.readdirSync(checksDir).filter((n) => n.endsWith('.ts') && !n.endsWith('.cases.ts'))) {
  const mod = (await import(path.join(checksDir, name))) as { id: string; tsOnly?: boolean };
  if (mod.tsOnly) tsOnlyIds.add(mod.id);
}

for (const { rule: view, cases: isolated } of await loadIsolatedCases(rule, checksDir)) ruleTester(view, isolated);

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

describe('effect registration', () => {
  it('is discovered by loadRules and is the index.ts default export', async () => {
    const rules = await loadRules(path.resolve(import.meta.dir, '..'));
    const found = rules.find((r) => r.id === 'effect');
    expect(found).toBeDefined();
    expect(found).toBe(rule);
  });
});

describe('effect language scope', () => {
  it('has at least one invalid case to exercise', () => {
    expect(cases.invalid.length).toBeGreaterThan(0);
  });

  for (const c of cases.invalid) {
    for (const ext of ['js', 'jsx']) {
      it(`${c.why}: no ts-only findings in x.${ext}`, async () => {
        const findings = await rule.check(ctxFor(`x.${ext}`, c.code ?? ''));
        expect(findings.filter((f) => tsOnlyIds.has(/^\[([^\]]+)\]/.exec(f.message)![1]))).toEqual([]);
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

describe('effect is off by default', () => {
  const code = cases.invalid[0]?.code ?? '';

  function withCleanEnv<T>(fn: () => Promise<T>): Promise<T> {
    const saved = process.env.CLAUDE_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
    return fn().finally(() => {
      if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved;
    });
  }

  it('default config yields no effect findings through the real policy path', async () => {
    await withCleanEnv(async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effect-off-'));
      try {
        expect(BUILTIN_POLICY.effect.severity).toBe('off');
        const policy = policyForRoot(dir);
        expect(policy.effect.severity).toBe('off');
        const findings = await runRules([rule], ctxFor('x.ts', code), policy);
        expect(findings.filter((f) => f.message.startsWith('[prefer-effect-match] '))).toEqual([]);
        expect(findings).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('positive control: same code with severity warn yields findings', async () => {
    await withCleanEnv(async () => {
      const policy = { ...BUILTIN_POLICY, effect: { severity: 'warn' as const, autofix: false } };
      const findings = await runRules([rule], ctxFor('x.ts', code), policy);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings.every((f) => f.severity === 'warn')).toBe(true);
    });
  });
});
