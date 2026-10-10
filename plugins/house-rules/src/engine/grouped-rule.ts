import fs from 'node:fs';
import path from 'node:path';
import type { Node, Tree } from '../hooks/lib/tree-sitter.js';
import type { Finding, PendingEdit, EditCheckEnv, EditCheckResult, Rule, RuleCases, RuleContext, ScopedFile } from './types.js';
import { createSourceFiles, type SourceFileResult } from './source-file.js';

export interface CheckHit {
  node?: Node;
  /** 0-based row; used when no node is available. */
  row?: number;
  message: string;
}

export interface Check {
  id: string;
  upstream: string;
  tsOnly?: boolean;
  check(root: Node, source: string, index?: NodeIndex): CheckHit[];
}

export interface NodeIndex {
  byType(type: string): readonly Node[];
  readonly all: readonly Node[];
}

const NO_NODES: readonly Node[] = Object.freeze([]);

/** One cursor pass; `all` is pre-order over named and anonymous nodes, `byType` its per-type subsequences. */
export function buildNodeIndex(root: Node): NodeIndex {
  const all: Node[] = [];
  const groups = new Map<string, Node[]>();
  const cursor = root.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      const type = node.type;
      all.push(node);
      const group = groups.get(type);
      if (group) group.push(node);
      else groups.set(type, [node]);
      if (cursor.gotoFirstChild()) continue;
      while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) return { all, byType: (t) => groups.get(t) ?? NO_NODES };
    }
  } finally {
    cursor.delete();
  }
}

const indexByTree = new WeakMap<Tree, NodeIndex>();

/** One lazy index per parsed tree, shared by every grouped rule; built only when a check reads it. */
function sharedIndex(tree: Tree): NodeIndex {
  let shared = indexByTree.get(tree);
  if (!shared) {
    let built: NodeIndex | undefined;
    const get = (): NodeIndex => (built ??= buildNodeIndex(tree.rootNode));
    shared = { byType: (t) => get().byType(t), get all() { return get().all; } };
    indexByTree.set(tree, shared);
  }
  return shared;
}

const TS_EXT = new Set(['.ts', '.mts', '.cts', '.tsx']);
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);

function isScanned(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return TS_EXT.has(ext) || JS_EXT.has(ext);
}

function isJsOnly(file: string): boolean {
  return JS_EXT.has(path.extname(file).toLowerCase());
}

function discover(checksDir: string): string[] {
  const names = fs.readdirSync(checksDir)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.cases.ts') && !n.endsWith('.d.ts'))
    .map((n) => n.slice(0, -'.ts'.length))
    .sort();
  for (const sub of names) {
    const casesFile = path.join(checksDir, `${sub}.cases.ts`);
    if (!fs.existsSync(casesFile)) {
      throw new Error(`grouped rule: check "${sub}.ts" is missing its cases file ${casesFile}`);
    }
  }
  return names;
}

async function loadChecks(checksDir: string, names: string[]): Promise<Check[]> {
  const checks: Check[] = [];
  for (const sub of names) {
    const mod = (await import(path.join(checksDir, `${sub}.ts`))) as Check;
    if (mod.id !== sub) {
      throw new Error(`grouped rule: check id "${mod.id}" does not match file name "${sub}.ts"`);
    }
    checks.push({ id: mod.id, upstream: mod.upstream, tsOnly: mod.tsOnly, check: mod.check });
  }
  return checks;
}

function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function collect(
  checks: Check[],
  result: SourceFileResult,
  filePath: string,
  ruleId: string,
  isAdded: (row: number) => boolean,
): Finding[] {
  if (!result.ok) return [];
  const { tree, text, errorRows } = result.source;
  const lines = text.split('\n');
  const jsFile = isJsOnly(filePath);
  const findings: Finding[] = [];
  const index = sharedIndex(tree);
  for (const c of checks) {
    if (c.tsOnly && jsFile) continue;
    for (const hit of c.check(tree.rootNode, text, index)) {
      const row = hit.node ? hit.node.startPosition.row : hit.row;
      if (row === undefined || errorRows.has(row) || !isAdded(row)) continue;
      findings.push({
        ruleId,
        path: filePath,
        line: row + 1,
        message: `[${c.id}] ${hit.message}`,
        fingerprintBasis: `${c.id}\n${norm(lines[row] ?? '')}`,
      });
    }
  }
  return findings;
}

/** Discovery runs now so a missing cases pair fails at load; check modules import lazily on first use. */
export function defineGroupedRule(id: string, description: string, checksDir: string): Rule {
  const names = discover(checksDir);
  let loaded: Promise<Check[]> | undefined;
  const checks = () => (loaded ??= loadChecks(checksDir, names));

  return {
    id,
    meta: { description },
    languages: ['typescript'],

    async check(ctx: RuleContext): Promise<Finding[]> {
      const active = await checks();
      const own = ctx.sourceFile ? null : createSourceFiles();
      const findings: Finding[] = [];
      try {
        for (const file of ctx.files ?? []) {
          if (!file.addedHunks || !file.text || !isScanned(file.path)) continue;
          const added = new Set(file.addedHunks.flatMap((h) => h.added.map((n) => n - 1)));
          if (added.size === 0) continue;
          const result = ctx.sourceFile
            ? await ctx.sourceFile(file as ScopedFile)
            : await own!.get('typescript', file.text, file.path);
          if (!result) continue;
          findings.push(...collect(active, result, file.path, id, (r) => added.has(r)));
        }
      } finally {
        own?.dispose();
      }
      return findings;
    },

    async editCheck(edit: PendingEdit, env: EditCheckEnv): Promise<EditCheckResult> {
      if (edit.lang === null || !isScanned(edit.path) || edit.changedRows.size === 0) return { findings: [] };
      const result = await env.sourceFile();
      if (!result) return { findings: [] };
      const active = await checks();
      return { findings: collect(active, result, edit.path, id, (r) => edit.changedRows.has(r)) };
    },
  };
}

async function loadSubCases(checksDir: string, sub: string): Promise<RuleCases> {
  const mod = (await import(path.join(checksDir, `${sub}.cases.ts`))) as { cases: RuleCases };
  return {
    valid: mod.cases.valid.map((c) => ({ ...c, why: `[${sub}] ${c.why}` })),
    invalid: mod.cases.invalid.map((c) => ({ ...c, why: `[${sub}] ${c.why}` })),
  };
}

export async function loadGroupedCases(checksDir: string): Promise<RuleCases> {
  const cases: RuleCases = { valid: [], invalid: [] };
  for (const sub of discover(checksDir)) {
    const one = await loadSubCases(checksDir, sub);
    cases.valid.push(...one.valid);
    cases.invalid.push(...one.invalid);
  }
  return cases;
}

export interface IsolatedCheckCases { sub: string; rule: Rule; cases: RuleCases }

/** One entry per check: a view of `rule` reporting only that check's findings, with that check's cases. */
export async function loadIsolatedCases(rule: Rule, checksDir: string): Promise<IsolatedCheckCases[]> {
  const out: IsolatedCheckCases[] = [];
  for (const sub of discover(checksDir)) {
    const own = (f: Finding) => f.fingerprintBasis.startsWith(`${sub}\n`);
    const view: Rule = {
      ...rule,
      check: async (ctx) => (await rule.check(ctx)).filter(own),
    };
    if (rule.editCheck) {
      const edit = rule.editCheck.bind(rule);
      view.editCheck = async (e, env) => {
        const r = await edit(e, env);
        return { ...r, findings: r.findings.filter(own) };
      };
    } else {
      delete view.editCheck;
    }
    out.push({ sub, rule: view, cases: await loadSubCases(checksDir, sub) });
  }
  return out;
}
