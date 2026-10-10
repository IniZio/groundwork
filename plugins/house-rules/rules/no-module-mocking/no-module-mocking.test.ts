import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule from './index.js';
import { loadRules } from '../../src/engine/registry.js';
import { loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { createSourceFiles, getDefaultParserFactory } from '../../src/engine/source-file.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';
import type { PendingEdit, ScopedFile } from '../../src/engine/types.js';

const CHECKS_DIR = path.join(import.meta.dir, 'checks');
const MSG = '[no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.';

for (const { rule: view, cases } of await loadIsolatedCases(rule, CHECKS_DIR)) ruleTester(view, cases);

function fileFor(p: string, text: string, base?: string): ScopedFile {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return {
    path: p,
    text,
    lang: 'typescript',
    addedHunks: base !== undefined
      ? diffTextToHunks(base, text)
      : [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }],
  };
}

const run = (files: ScopedFile[]) => rule.check({ repoRoot: '/tmp', mode: 'cli', files });
const ids = (f: { line?: number; message: string }[]) => f.map((x) => ({ line: x.line, message: x.message }));

describe('no-module-mocking behaviour', () => {
  for (const ext of ['ts', 'tsx', 'js', 'mjs']) {
    it(`flags vi.mock in .${ext}`, async () => {
      const f = await run([fileFor(`src/a.${ext}`, "const a = 1;\nvi.mock('./x');\n")]);
      expect(ids(f)).toEqual([{ line: 2, message: MSG }]);
      expect(f[0].ruleId).toBe('no-module-mocking');
    });
  }

  it('does not flag vi.fn or vi.spyOn', async () => {
    const src = "const f = vi.fn();\nconst s = vi.spyOn(a, 'b');\n";
    expect(await run([fileFor('src/a.ts', src)])).toHaveLength(0);
  });

  it('ignores an unchanged base vi.mock but flags a newly added jest.mock', async () => {
    const base = "vi.mock('./x');\nconst a = 1;\n";
    const post = "vi.mock('./x');\nconst a = 1;\njest.mock('./y');\n";
    const f = await run([fileFor('src/a.ts', post, base)]);
    expect(ids(f)).toEqual([{ line: 3, message: MSG }]);
  });

  it('is discoverable through the registry with its id', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmm-registry-'));
    try {
      const dir = path.join(root, 'no-module-mocking');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'index.ts'), `export { default } from '${path.join(import.meta.dir, 'index.ts')}';\n`);
      const rules = await loadRules(root);
      expect(rules.map((r) => r.id)).toEqual(['no-module-mocking']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('editCheck reports only changed rows', async () => {
    const post = "vi.mock('./x');\njest.mock('./y');\n";
    const edit: PendingEdit = {
      path: '/repo/src/a.ts', tool: 'edit', lang: 'typescript', pre: "vi.mock('./x');\n", post,
      changedRows: new Set([1]), session: null, repoRoot: null, cwd: null,
    };
    const sfs = createSourceFiles();
    const r = await rule.editCheck!(edit, { sourceFile: () => sfs.get('typescript', post, edit.path), parserFactory: getDefaultParserFactory() });
    sfs.dispose();
    expect(ids(r.findings)).toEqual([{ line: 2, message: MSG }]);
  });
});
