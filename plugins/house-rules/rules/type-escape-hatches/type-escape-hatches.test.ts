import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from './index.js';
import { loadRules } from '../../src/engine/registry.js';
import { loadGroupedCases, loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import type { RuleContext } from '../../src/engine/types.js';

const checksDir = path.join(import.meta.dir, 'checks');
const cases = await loadGroupedCases(checksDir);
const tsOnlyIds = new Set<string>();
const allIds: string[] = [];
for (const name of fs.readdirSync(checksDir).filter((n) => n.endsWith('.ts') && !n.endsWith('.cases.ts'))) {
  const mod = (await import(path.join(checksDir, name))) as { id: string; tsOnly?: boolean };
  allIds.push(mod.id);
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

describe('type-escape-hatches registration', () => {
  it('is discovered by loadRules and is the index.ts default export', async () => {
    const rules = await loadRules(path.resolve(import.meta.dir, '..'));
    const found = rules.find((r) => r.id === 'type-escape-hatches');
    expect(found).toBeDefined();
    expect(found).toBe(rule);
  });
});

describe('type-escape-hatches language scope', () => {
  it('pins the checks that run on JS to exactly no-runtime-typeof', () => {
    expect(allIds.filter((id) => !tsOnlyIds.has(id)).sort()).toEqual(['no-runtime-typeof']);
  });

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

describe('type-escape-hatches names the validator the project depends on', () => {
  const code = 'export function read(raw: string) {\n  return typeof raw;\n}\nexport function load(): unknown {\n  return 1;\n}\n';
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  async function messagesIn(files: Record<string, string>, checked = 'src/x.ts'): Promise<string[]> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teh-validators-'));
    dirs.push(root);
    for (const [rel, text] of Object.entries({ ...files, [checked]: code })) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const ctx = ctxFor(checked, code);
    return (await rule.check({ ...ctx, repoRoot: root })).map((f) => f.message);
  }

  const typeofWith = (names: string) =>
    `[no-runtime-typeof] A \`typeof\` check is hand-written shape testing, not parsing, even at the I/O boundary. Parse the input once with ${names}, which this project already depends on, then branch on the typed result.`;
  const typeofNone =
    '[no-runtime-typeof] A `typeof` check is hand-written shape testing, not parsing, even at the I/O boundary. Add a validator (ajv is a common choice) or a single named parse function, then branch on the typed result.';
  const returnsWith = (phrase: string) =>
    `[no-unknown-returns] This function returns \`unknown\`, so every caller must check the value again. Parse it here with ${phrase} and return the named domain type; moving the \`typeof\` checks to callers is the same defect.`;

  it('names ajv when package.json depends on ajv', async () => {
    const messages = await messagesIn({ 'package.json': JSON.stringify({ dependencies: { ajv: '8.20.0' } }) });
    expect(messages).toContain(typeofWith('ajv'));
    expect(messages).toContain(returnsWith('ajv (this project already depends on it)'));
  });

  it('names zod when devDependencies has zod', async () => {
    const messages = await messagesIn({ 'package.json': JSON.stringify({ devDependencies: { zod: '^3.0.0', react: '^19.0.0' } }) });
    expect(messages).toContain(typeofWith('zod'));
  });

  it('lists every recognised validator in a fixed order', async () => {
    const messages = await messagesIn({ 'package.json': JSON.stringify({ dependencies: { zod: '1', ajv: '1' } }) });
    expect(messages).toContain(typeofWith('ajv or zod'));
    expect(messages).toContain(returnsWith('ajv or zod (this project already depends on them)'));
  });

  it('uses the package.json nearest the checked file', async () => {
    const messages = await messagesIn({
      'package.json': JSON.stringify({ dependencies: { ajv: '1' } }),
      'packages/web/package.json': JSON.stringify({ dependencies: { valibot: '1' } }),
    }, 'packages/web/src/x.ts');
    expect(messages).toContain(typeofWith('valibot'));
  });

  it('asks for a validator when package.json has none', async () => {
    const messages = await messagesIn({ 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }) });
    expect(messages).toContain(typeofNone);
    expect(messages).toContain(returnsWith('a validator (add one if this project has none; ajv is a common choice)'));
  });

  it('asks for a validator without failing when there is no package.json', async () => {
    const messages = await messagesIn({ 'go.mod': 'module example.com/x\n' });
    expect(messages).toContain(typeofNone);
  });

  it('asks for a validator without failing when package.json is malformed', async () => {
    const messages = await messagesIn({ 'package.json': '{ "dependencies": [' });
    expect(messages).toContain(typeofNone);
  });
});
