import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNodeIndex, defineGroupedRule, loadGroupedCases, loadIsolatedCases } from '../../src/engine/grouped-rule.js';
import { createSourceFiles, getDefaultParserFactory } from '../../src/engine/source-file.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';
import type { ParserFactory } from '../../src/hooks/languages/parse.js';
import type { PendingEdit, RuleContext, ScopedFile } from '../../src/engine/types.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const CHECK_SRC = (id: string, tsOnly: boolean) => `import type { Node } from '../../../src/hooks/lib/tree-sitter.js';

export const id = '${id}';
export const upstream = 'https://example.com/${id}';
${tsOnly ? 'export const tsOnly = true;\n' : ''}
function walk(node: Node, out: Node[]): void {
  if (node.type === 'debugger_statement') out.push(node);
  for (const child of node.children) if (child) walk(child, out);
}

export function check(root: Node, _source: string): { node: Node; message: string }[] {
  const hits: Node[] = [];
  walk(root, hits);
  return hits.map((node) => ({ node, message: 'debugger statement left in code' }));
}
`;
const CASES_SRC = `import type { RuleCases } from '../../../src/engine/types.js';

export const cases: RuleCases = {
  valid: [{ why: 'no debugger', code: 'export const a = 1;\\n' }],
  invalid: [{ why: 'debugger flagged', code: 'debugger;\\n', findings: [{ message: '[no-debugger] debugger statement left in code' }] }],
};
`;

function makeChecksDir(opts: { withCases?: boolean; extra?: { id: string; tsOnly: boolean } } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grouped-rule-'));
  dirs.push(root);
  const dir = path.join(root, 'a', 'b', 'checks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'no-debugger.ts'), CHECK_SRC('no-debugger', false));
  if (opts.withCases !== false) fs.writeFileSync(path.join(dir, 'no-debugger.cases.ts'), CASES_SRC);
  if (opts.extra) {
    fs.writeFileSync(path.join(dir, `${opts.extra.id}.ts`), CHECK_SRC(opts.extra.id, opts.extra.tsOnly));
    fs.writeFileSync(path.join(dir, `${opts.extra.id}.cases.ts`), CASES_SRC);
  }
  return dir;
}

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

function ctxFor(files: ScopedFile[], sourceFile?: RuleContext['sourceFile']): RuleContext {
  return { repoRoot: '/tmp', mode: 'cli', files, sourceFile };
}

const SRC = `export function run(items: string[]): number {
  debugger;
  return items.length;
}
`;

describe('grouped-rule: discovery', () => {
  it('discovers checks and aggregates cases with sub-id prefix', async () => {
    const dir = makeChecksDir();
    const rule = defineGroupedRule('demo', 'demo rule', dir);
    expect(rule.id).toBe('demo');
    const cases = await loadGroupedCases(dir);
    expect(cases.valid.map((c) => c.why)).toEqual(['[no-debugger] no debugger']);
    expect(cases.invalid).toHaveLength(1);
  });

  it('throws naming the missing cases file', () => {
    const dir = makeChecksDir({ withCases: false });
    expect(() => defineGroupedRule('demo', 'demo rule', dir)).toThrow('no-debugger.cases.ts');
  });
});

describe('grouped-rule: check', () => {
  it('flags an added row with prefixed message and sub-id fingerprint', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const f = await rule.check(ctxFor([fileFor('src/run.ts', SRC)]));
    expect(f).toHaveLength(1);
    expect(f[0].message).toBe('[no-debugger] debugger statement left in code');
    expect(f[0].fingerprintBasis.startsWith('no-debugger')).toBe(true);
    expect(f[0].line).toBe(2);
    expect(f[0].ruleId).toBe('demo');
  });

  it('ignores a pre-existing debugger on an unchanged row', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const edited = SRC.replace('return items.length;', 'return items.length + 1;');
    const f = await rule.check(ctxFor([fileFor('src/run.ts', edited, SRC)]));
    expect(f).toHaveLength(0);
  });

  it('skips files without addedHunks', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const file = fileFor('src/run.ts', SRC);
    delete file.addedHunks;
    expect(await rule.check(ctxFor([file]))).toHaveLength(0);
  });

  it('produces nothing for rows inside parse errors', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const broken = `export function run(items: string[]): number {\n  debugger;\n  return items.length +;\n}\n`;
    const sf = createSourceFiles();
    const probe = await sf.get('typescript', broken, 'src/run.ts');
    if (!probe.ok) throw new Error('fixture must parse');
    const errRows = probe.source.errorRows;
    expect(errRows.size).toBeGreaterThan(0);
    const f = await rule.check(ctxFor([fileFor('src/run.ts', broken)]));
    const flaggedRow = f.map((x) => (x.line ?? 0) - 1);
    for (const r of flaggedRow) expect(errRows.has(r)).toBe(false);
    const onlyError = `debugger +;\n`;
    const sf2 = await sf.get('typescript', onlyError, 'src/e.ts');
    if (!sf2.ok) throw new Error('fixture must parse');
    if (sf2.source.errorRows.has(0)) {
      expect(await rule.check(ctxFor([fileFor('src/e.ts', onlyError)]))).toHaveLength(0);
    }
    sf.dispose();
  });

  it('skips tsOnly checks on js files but runs others', async () => {
    const dir = makeChecksDir({ extra: { id: 'ts-debugger', tsOnly: true } });
    const rule = defineGroupedRule('demo', 'd', dir);
    const js = await rule.check(ctxFor([fileFor('src/run.js', SRC)]));
    expect(js.map((f) => f.message.split(']')[0])).toEqual(['[no-debugger']);
    const ts = await rule.check(ctxFor([fileFor('src/run.ts', SRC)]));
    expect(ts.map((f) => f.message.split(']')[0]).sort()).toEqual(['[no-debugger', '[ts-debugger']);
  });

  it('ignores non-TS/JS files', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    expect(await rule.check(ctxFor([fileFor('src/run.py', SRC)]))).toHaveLength(0);
  });

  it('reuses the ctx.sourceFile tree without reparsing', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    let parses = 0;
    const base = getDefaultParserFactory();
    const factory: ParserFactory = async (lang, variant) => {
      const r = await base(lang, variant);
      if (!r.ok) return r;
      const parser = r.parser;
      const wrapped = Object.assign(Object.create(parser as object) as typeof parser, {
        parse(text: string) { parses++; return parser.parse(text); },
      });
      return { ...r, parser: wrapped };
    };
    const sfs = createSourceFiles(factory);
    const file = fileFor('src/run.ts', SRC);
    const sourceFile: RuleContext['sourceFile'] = (f) => sfs.get('typescript', f.text!, f.path);
    await sourceFile(file);
    expect(parses).toBe(1);
    const f = await rule.check(ctxFor([file], sourceFile));
    expect(f).toHaveLength(1);
    expect(parses).toBe(1);
    sfs.dispose();
  });

  it('scans the tree ctx.sourceFile supplies, not a fresh parse of file.text', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const sfs = createSourceFiles();
    const file = fileFor('src/run.ts', 'export const a = 1;\n');
    const f = await rule.check(ctxFor([file], () => sfs.get('typescript', 'debugger;\n', 'src/run.ts')));
    expect(f).toHaveLength(1);
    sfs.dispose();
  });
});

describe('grouped-rule: loadIsolatedCases', () => {
  const dir2 = () => makeChecksDir({ extra: { id: 'ts-debugger', tsOnly: false } });

  it('yields one entry per sub with only that sub\'s cases', async () => {
    const dir = dir2();
    const rule = defineGroupedRule('demo', 'd', dir);
    const iso = await loadIsolatedCases(rule, dir);
    expect(iso.map((e) => e.sub)).toEqual(['no-debugger', 'ts-debugger']);
    for (const e of iso) {
      expect(e.cases.valid.map((c) => c.why)).toEqual([`[${e.sub}] no debugger`]);
      expect(e.cases.invalid.map((c) => c.why)).toEqual([`[${e.sub}] debugger flagged`]);
      expect(e.rule.id).toBe('demo');
    }
  });

  it('view drops a sibling check finding on the same line; original keeps both', async () => {
    const dir = dir2();
    const rule = defineGroupedRule('demo', 'd', dir);
    const iso = await loadIsolatedCases(rule, dir);
    const ctx = ctxFor([fileFor('src/run.ts', SRC)]);
    expect((await rule.check(ctx)).map((f) => f.line)).toEqual([2, 2]);
    for (const e of iso) {
      const f = await e.rule.check(ctx);
      expect(f).toHaveLength(1);
      expect(f[0].message.startsWith(`[${e.sub}]`)).toBe(true);
    }
    const edit: PendingEdit = {
      path: '/repo/src/run.ts', tool: 'edit', lang: 'typescript', pre: SRC, post: SRC,
      changedRows: new Set([1]), session: null, repoRoot: null, cwd: null,
    };
    const sfs = createSourceFiles();
    const env = { sourceFile: () => sfs.get('typescript', SRC, edit.path), parserFactory: getDefaultParserFactory() };
    expect((await rule.editCheck!(edit, env)).findings).toHaveLength(2);
    const r = await iso[0].rule.editCheck!(edit, env);
    expect(r.findings.map((f) => f.message.split(']')[0])).toEqual(['[no-debugger']);
    sfs.dispose();
  });

  it('leaves the original rule unchanged', async () => {
    const dir = dir2();
    const rule = defineGroupedRule('demo', 'd', dir);
    const { check, editCheck } = rule;
    const iso = await loadIsolatedCases(rule, dir);
    expect(rule.check).toBe(check);
    expect(rule.editCheck).toBe(editCheck);
    expect(iso[0].rule).not.toBe(rule);
    expect(iso[0].rule.check).not.toBe(check);
  });

  it('view has no editCheck when the original has none', async () => {
    const dir = makeChecksDir();
    const base = defineGroupedRule('demo', 'd', dir);
    const bare = { ...base };
    delete bare.editCheck;
    const [e] = await loadIsolatedCases(bare, dir);
    expect(e.rule.editCheck).toBeUndefined();
  });
});

describe('grouped-rule: editCheck', () => {
  function pending(pre: string | null, post: string, changedRows: number[], p = '/repo/src/run.ts'): PendingEdit {
    return {
      path: p, tool: 'edit', lang: 'typescript', pre, post,
      changedRows: new Set(changedRows), session: null, repoRoot: null, cwd: null,
    };
  }
  const envFor = (post: string, p: string) => {
    const sfs = createSourceFiles();
    return { sourceFile: () => sfs.get('typescript', post, p), parserFactory: getDefaultParserFactory() };
  };

  it('reports only rows the edit adds, non-blocking shape', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const edit = pending(SRC, SRC, [1]);
    const r = await rule.editCheck!(edit, envFor(SRC, edit.path));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toBe('[no-debugger] debugger statement left in code');
    expect(r.edits).toBeUndefined();
  });

  it('stays silent when the debugger row was not changed', async () => {
    const rule = defineGroupedRule('demo', 'd', makeChecksDir());
    const edit = pending(SRC, SRC, [2]);
    const r = await rule.editCheck!(edit, envFor(SRC, edit.path));
    expect(r.findings).toHaveLength(0);
  });
});

describe('grouped-rule: buildNodeIndex', () => {
  const BIG = `import { a } from './a';
export class K<T> extends Base implements I {
  private x: number = 1;
  async m(p: T, ...rest: number[]): Promise<void> {
    const o = { ...p, k: [1, ...rest], 'q': \`t\${p}\` };
    for (const i of rest) { if (i > 1) continue; else break; }
    // comment
    return void (await fetch(\`u\`)) as never;
  }
}
`;
  const rec = (n: any, out: any[]) => { out.push(n); for (const c of n.children) if (c) rec(c, out); return out; };

  it('all equals recursive children pre-order and byType preserves it', async () => {
    const sfs = createSourceFiles();
    try {
      const r = await sfs.get('typescript', BIG, 'src/big.ts');
      if (!r || !r.ok) throw new Error('parse failed');
      const root = r.source.tree.rootNode;
      const expected = rec(root, []);
      const index = buildNodeIndex(root);
      const key = (n: any) => `${n.id}:${n.type}`;
      expect(index.all.map(key)).toEqual(expected.map(key));
      expect(index.all.length).toBeGreaterThan(50);
      expect(index.all.some((n) => !n.isNamed)).toBe(true);
      for (const t of new Set(expected.map((n: any) => n.type))) {
        expect(index.byType(t as string).map(key)).toEqual(expected.filter((n: any) => n.type === t).map(key));
      }
      expect(index.byType('no_such_type')).toEqual([]);
      const sp = index.byType('spread_element')[0];
      const twin = expected.find((n: any) => n.id === sp.id);
      expect(sp.parent?.id).toBe(twin.parent?.id);
      expect(sp.text).toBe(twin.text);
      expect(sp.startPosition).toEqual(twin.startPosition);
      expect(index.all[0].id).toBe(root.id);
    } finally {
      sfs.dispose();
    }
  });
});

describe('grouped-rule: shared node index', () => {
  function probeDir(seen: unknown[], touch: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-probe-'));
    dirs.push(dir);
    const checks = path.join(dir, 'rules', 'g', 'checks');
    fs.mkdirSync(checks, { recursive: true });
    (globalThis as any).__seen = seen;
    fs.writeFileSync(path.join(checks, 'probe.ts'), `export const id = 'probe';
export const upstream = 'u';
export function check(_r: unknown, _s: string, index: any): never[] {
  (globalThis as any).__seen.push(index);
  ${touch ? 'index.byType("program");' : ''}
  return [];
}
`);
    fs.writeFileSync(path.join(checks, 'probe.cases.ts'), CASES_SRC);
    return checks;
  }

  it('two grouped rules over one tree share an index; another tree gets a fresh one', async () => {
    const seen: any[] = [];
    const a = defineGroupedRule('a', 'd', probeDir(seen, false));
    const b = defineGroupedRule('b', 'd', probeDir(seen, false));
    const sfs = createSourceFiles();
    try {
      const f1 = fileFor('src/one.ts', 'const x = 1;\n');
      const f2 = fileFor('src/two.ts', 'const y = 2;\n');
      const sourceFile: RuleContext['sourceFile'] = (f) => sfs.get('typescript', f.text!, f.path);
      await a.check(ctxFor([f1, f2], sourceFile));
      await b.check(ctxFor([f1, f2], sourceFile));
      expect(seen).toHaveLength(4);
      expect(seen[0]).toBe(seen[2]);
      expect(seen[1]).toBe(seen[3]);
      expect(seen[0]).not.toBe(seen[1]);
    } finally {
      sfs.dispose();
    }
  });

  it('serves correct nodes lazily through the shared index', async () => {
    const seen: any[] = [];
    const a = defineGroupedRule('a', 'd', probeDir(seen, true));
    const sfs = createSourceFiles();
    try {
      const f1 = fileFor('src/one.ts', 'const x = 1;\n');
      await a.check(ctxFor([f1], (f) => sfs.get('typescript', f.text!, f.path)));
      expect(seen[0].byType('program')).toHaveLength(1);
      expect(seen[0].all.length).toBeGreaterThan(3);
    } finally {
      sfs.dispose();
    }
  });
});
