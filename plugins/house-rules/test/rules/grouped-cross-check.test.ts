import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGroupedCases } from '../../src/engine/grouped-rule.js';
import type { Case, Rule, RuleContext, ScopedFile } from '../../src/engine/types.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';
import { languageForPath } from '../../src/hooks/languages/registry.js';

type OverlapMap = Record<string, string[]>;

const rulesRoot = path.resolve(import.meta.dir, '../../rules');
const KNOWN_DIRS = ['code-smells', 'no-module-mocking', 'type-escape-hatches'];

const groupedDirs = fs.readdirSync(rulesRoot)
  .filter((d) => fs.existsSync(path.join(rulesRoot, d, 'checks')) && fs.existsSync(path.join(rulesRoot, d, 'index.ts')))
  .sort();

async function loadRule(dir: string): Promise<Rule> {
  return (await import(path.join(rulesRoot, dir, 'index.ts'))).default as Rule;
}

async function declaredHits(dir: string): Promise<Record<string, string[]>> {
  const checksDir = path.join(rulesRoot, dir, 'checks');
  const declared: Record<string, string[]> = {};
  const subs = fs.readdirSync(checksDir).filter((n) => n.endsWith('.cases.ts')).map((n) => n.slice(0, -'.cases.ts'.length)).sort();
  for (const sub of subs) {
    const mod = await import(path.join(checksDir, `${sub}.cases.ts`));
    for (const key of (mod.foreignHits as readonly string[] | undefined) ?? []) (declared[key] ??= []).push(sub);
  }
  for (const key of Object.keys(declared)) declared[key].sort();
  return declared;
}

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
  it('discovers the grouped rule dirs', () => {
    expect(groupedDirs.length).toBeGreaterThanOrEqual(1);
    for (const known of KNOWN_DIRS) expect(groupedDirs).toContain(known);
  });

  for (const dir of groupedDirs) {
    it(`${dir}: foreign findings match the declared foreignHits`, async () => {
      const rule = await loadRule(dir);
      const declared = await declaredHits(dir);
      const cases = await loadGroupedCases(path.join(rulesRoot, dir, 'checks'));
      const whys = new Set([...cases.valid, ...cases.invalid].map((c) => c.why));
      const unknownKeys = Object.keys(declared).filter((k) => !whys.has(k)).map((k) => `foreignHits key names no case: ${k}`);
      expect(unknownKeys).toEqual([]);
      const actual = await actualOverlaps(rule, dir);
      expect(diffOverlaps(declared, actual)).toEqual([]);
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
