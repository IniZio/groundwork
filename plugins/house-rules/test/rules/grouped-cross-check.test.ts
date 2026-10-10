import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGroupedCases } from '../../src/engine/grouped-rule.js';
import type { Case, Rule, RuleContext, ScopedFile } from '../../src/engine/types.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';
import { languageForPath } from '../../src/hooks/languages/registry.js';
import escapeHatches from '../../rules/type-escape-hatches/index.js';
import codeSmells from '../../rules/code-smells/index.js';
import noModuleMocking from '../../rules/no-module-mocking/index.js';

type OverlapMap = Record<string, string[]>;

const EXPECTED: Record<string, OverlapMap> = {
  'type-escape-hatches': {
    '[no-unknown-returns] unresolved alias declaration to unknown is not a return': ['no-unknown-type-aliases'],
    '[no-unknown-returns] generic parameter shadows alias': ['no-unknown-type-aliases'],
    '[no-unknown-returns] mapped type key shadows alias': ['no-unknown-type-aliases'],
    '[no-unknown-returns] infer binding shadows alias in true branch': ['no-unknown-type-aliases'],
    '[no-unknown-returns] inner alias shadows outer unknown': ['no-unknown-type-aliases'],
    '[no-unknown-returns] alias resolving to unknown': ['no-unknown-type-aliases'],
    '[no-unknown-returns] infer name is not bound in the false branch': ['no-unknown-type-aliases'],
    '[no-unknown-returns] alias scoped inside a function body': ['no-unknown-type-aliases'],
    '[no-unsafe-dictionary-type] record of alias for unknown': ['no-unknown-type-aliases'],
  },
  'code-smells': {
    '[no-reflect-apply] other Reflect method': ['no-reflect-get'],
    '[no-reduce-accumulator-copy] items.reduce((acc, item) => [...acc, item], []);': ['no-accumulator-spread'],
    '[no-reduce-accumulator-copy] items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});': ['no-accumulator-spread'],
  },
  'no-module-mocking': {},
};

const RULES: { rule: Rule; dir: string }[] = [
  { rule: escapeHatches, dir: 'type-escape-hatches' },
  { rule: codeSmells, dir: 'code-smells' },
  { rule: noModuleMocking, dir: 'no-module-mocking' },
];

export function diffOverlaps(expected: OverlapMap, actual: OverlapMap): string[] {
  const diffs: string[] = [];
  for (const why of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const want = new Set(expected[why] ?? []);
    const got = new Set(actual[why] ?? []);
    for (const sub of [...got].sort()) if (!want.has(sub)) diffs.push(`${why}: unexpected foreign [${sub}]`);
    for (const sub of [...want].sort()) if (!got.has(sub)) diffs.push(`${why}: missing foreign [${sub}]`);
  }
  return diffs;
}

function buildContext(rule: Rule, c: Case, tmpDirs: string[]): RuleContext {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rules-cross-'));
  tmpDirs.push(tmp);
  if (c.tree) {
    const files: ScopedFile[] = [];
    for (const [filePath, text] of Object.entries(c.tree)) {
      const absPath = path.join(tmp, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, text);
      files.push({ path: filePath, text, lang: languageForPath(filePath) ?? undefined, tracked: true, sessionCreated: false });
    }
    return { repoRoot: tmp, mode: 'cli', files };
  }
  const filename = c.filename ?? `${rule.id}.ts`;
  const text = c.code ?? '';
  fs.mkdirSync(path.dirname(path.join(tmp, filename)), { recursive: true });
  fs.writeFileSync(path.join(tmp, filename), text);
  let addedHunks: ScopedFile['addedHunks'];
  if (c.base !== undefined) {
    addedHunks = diffTextToHunks(c.base, text);
  } else {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    addedHunks = lines.length > 0 ? [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }] : [];
  }
  const file: ScopedFile = {
    path: filename,
    text,
    lang: languageForPath(filename) ?? undefined,
    tracked: true,
    ...(c.base !== undefined ? { baseText: c.base } : {}),
    addedHunks,
  };
  return { repoRoot: tmp, mode: 'cli', files: [file] };
}

function subOf(finding: { message: string; fingerprintBasis?: string }): string | undefined {
  const fromBasis = finding.fingerprintBasis?.split('\n')[0];
  if (fromBasis) return fromBasis;
  return /^\[([^\]]+)\]/.exec(finding.message)?.[1];
}

async function actualOverlaps(rule: Rule, dir: string): Promise<OverlapMap> {
  const checksDir = path.resolve(import.meta.dir, '../../rules', dir, 'checks');
  const cases = await loadGroupedCases(checksDir);
  const tmpDirs: string[] = [];
  const map: OverlapMap = {};
  try {
    for (const c of [...cases.valid, ...cases.invalid]) {
      const own = /^\[([^\]]+)\]/.exec(c.why)![1];
      const findings = await rule.check(buildContext(rule, c, tmpDirs));
      const foreign = new Set<string>();
      for (const f of findings) {
        const sub = subOf(f);
        if (sub && sub !== own) foreign.add(sub);
      }
      if (foreign.size > 0) map[c.why] = [...foreign].sort();
    }
  } finally {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  }
  return map;
}

describe('grouped rule cross-check overlaps', () => {
  for (const { rule, dir } of RULES) {
    it(`${rule.id}: foreign findings match the pinned overlap map`, async () => {
      const actual = await actualOverlaps(rule, dir);
      expect(diffOverlaps(EXPECTED[rule.id] ?? {}, actual)).toEqual([]);
    });
  }

  it('guard sensitivity: an extra overlap yields a named diff string', () => {
    const expected: OverlapMap = { '[no-unknown-returns] type alias': ['no-unknown-type-aliases'] };
    const actual: OverlapMap = {
      '[no-unknown-returns] type alias': ['no-unknown-type-aliases', 'no-unsafe-dictionary-type'],
    };
    expect(diffOverlaps(expected, actual)).toEqual([
      '[no-unknown-returns] type alias: unexpected foreign [no-unsafe-dictionary-type]',
    ]);
    expect(diffOverlaps(actual, expected)).toEqual([
      '[no-unknown-returns] type alias: missing foreign [no-unsafe-dictionary-type]',
    ]);
  });
});
